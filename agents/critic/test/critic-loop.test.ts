import { describe, it, expect } from 'vitest';
import {
  parseVerdict,
  reflect,
  type Generate,
  type Critique,
} from '../src/critic-loop.js';

// Deterministic critic-loop tests (no Bedrock). These lock two contracts:
//   1. parseVerdict — the critic's raw text → {approved, feedback}, the control-flow
//      seam the loop branches on (mirrors the router's labelFromText).
//   2. reflect — the loop ALWAYS terminates (rounds never exceed the cap), stops
//      early on approval, threads feedback into the next draft, and always returns a
//      best-effort answer. The "no infinite loop" guarantee is the plan's explicit
//      test requirement; here it's enforced without any model calls.

describe('parseVerdict — leading token', () => {
  it('approves on a leading APPROVED token, with no feedback', () => {
    const v = parseVerdict('APPROVED');
    expect(v.approved).toBe(true);
    expect(v.feedback).toBe('');
  });

  it('is case-insensitive and tolerates surrounding whitespace', () => {
    expect(parseVerdict('  approved\n').approved).toBe(true);
    expect(parseVerdict('Approved').approved).toBe(true);
  });

  it('does not approve when APPROVED is only a prefix of a larger word', () => {
    // "Approvedish" is not the verdict; word-boundary guards a naive startsWith.
    expect(parseVerdict('Approvedish, but fix the tone').approved).toBe(false);
  });

  it('rejects on a leading REVISE token and returns the rest as feedback', () => {
    const v = parseVerdict('REVISE\nTighten the second paragraph.\nAdd a citation.');
    expect(v.approved).toBe(false);
    expect(v.feedback).toBe('Tighten the second paragraph.\nAdd a citation.');
  });

  it('REVISE with feedback on the same logical block still strips the token line', () => {
    const v = parseVerdict('revise\n\n- too vague');
    expect(v.approved).toBe(false);
    expect(v.feedback).toBe('- too vague');
  });
});

describe('parseVerdict — no leading token (chatty / ambiguous)', () => {
  it('approves only if APPROVED stands alone and REVISE is absent', () => {
    expect(parseVerdict('I think this is APPROVED now.').approved).toBe(true);
  });

  it('defaults to NOT approved when both tokens appear (ambiguous → fail safe)', () => {
    expect(parseVerdict('Could be APPROVED but I would REVISE the intro.').approved).toBe(false);
  });

  it('defaults to NOT approved for unrelated text (never ships slop by accident)', () => {
    const v = parseVerdict('The draft is okay-ish.');
    expect(v.approved).toBe(false);
    expect(v.feedback).toBe('The draft is okay-ish.');
  });

  it('treats empty / whitespace as not approved', () => {
    expect(parseVerdict('').approved).toBe(false);
    expect(parseVerdict('   \n  ').approved).toBe(false);
  });
});

// Stub callbacks: the generator just numbers its drafts; the critic verdict is
// scripted per test so we can drive every termination path deterministically.
const numberedGenerator: Generate = async (_prompt, _feedback, prevDraft) =>
  prevDraft === '' ? 'draft-1' : `revised-after:${prevDraft}`;

function scriptedCritic(verdicts: string[]): { critique: Critique; calls: () => number } {
  let i = 0;
  return {
    critique: async () => verdicts[Math.min(i++, verdicts.length - 1)],
    calls: () => i,
  };
}

describe('reflect — termination guarantee', () => {
  it('stops at the cap when the critic never approves (no infinite loop)', async () => {
    const critic = scriptedCritic(['REVISE more', 'REVISE again', 'REVISE still']);
    const result = await reflect('do a thing', numberedGenerator, critic.critique, {
      maxIterations: 3,
    });
    expect(result.rounds).toBe(3);
    expect(result.approved).toBe(false);
    expect(result.answer).not.toBe(''); // best-effort answer always returned
  });

  it('never exceeds the cap even if the critic always says REVISE', async () => {
    const critic = scriptedCritic(['REVISE']);
    for (const cap of [1, 2, 5]) {
      const result = await reflect('x', numberedGenerator, critic.critique, { maxIterations: cap });
      expect(result.rounds).toBe(cap);
      expect(result.approved).toBe(false);
    }
  });

  it('clamps a non-positive cap up to 1 (always runs at least one round)', async () => {
    const critic = scriptedCritic(['REVISE']);
    const result = await reflect('x', numberedGenerator, critic.critique, { maxIterations: 0 });
    expect(result.rounds).toBe(1);
    expect(result.answer).toBe('draft-1');
  });
});

describe('reflect — early approval', () => {
  it('stops on the first approval and reports the round it approved on', async () => {
    const critic = scriptedCritic(['REVISE fix it', 'APPROVED']);
    const result = await reflect('x', numberedGenerator, critic.critique, { maxIterations: 5 });
    expect(result.approved).toBe(true);
    expect(result.rounds).toBe(2);
    // round 2 revised round 1's draft (feedback was threaded through)
    expect(result.answer).toBe('revised-after:draft-1');
  });

  it('approves on the first round when the first draft is already good', async () => {
    const critic = scriptedCritic(['APPROVED']);
    const result = await reflect('x', numberedGenerator, critic.critique, { maxIterations: 5 });
    expect(result.approved).toBe(true);
    expect(result.rounds).toBe(1);
    expect(result.answer).toBe('draft-1');
  });
});

describe('reflect — feedback threading & round hook', () => {
  it('feeds the critic feedback into the next generate call', async () => {
    const seen: Array<{ feedback: string; prevDraft: string }> = [];
    const recordingGenerator: Generate = async (_p, feedback, prevDraft) => {
      seen.push({ feedback, prevDraft });
      return prevDraft === '' ? 'd1' : 'd2';
    };
    const critic = scriptedCritic(['REVISE be more specific', 'APPROVED']);
    await reflect('x', recordingGenerator, critic.critique, { maxIterations: 3 });
    expect(seen[0]).toEqual({ feedback: '', prevDraft: '' });
    expect(seen[1]).toEqual({ feedback: 'be more specific', prevDraft: 'd1' });
  });

  it('invokes onRound once per round with the parsed verdict', async () => {
    const rounds: Array<{ round: number; approved: boolean }> = [];
    const critic = scriptedCritic(['REVISE x', 'APPROVED']);
    await reflect('x', numberedGenerator, critic.critique, {
      maxIterations: 5,
      onRound: (round, verdict) => rounds.push({ round, approved: verdict.approved }),
    });
    expect(rounds).toEqual([
      { round: 1, approved: false },
      { round: 2, approved: true },
    ]);
  });
});
