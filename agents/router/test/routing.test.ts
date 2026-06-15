import { describe, it, expect } from 'vitest';
import { labelFromText } from '../src/graph.js';
import {
  ALL_BRANCHES,
  FALLBACK_BRANCH_ID,
  billingBranch,
  techBranch,
  generalBranch,
} from '../src/branches.js';

// Deterministic routing-contract tests (no Bedrock). These lock the behavior the
// conditional Graph edges depend on: intake emits a label string, labelFromText
// normalizes it to exactly one branch id, and the graph stays TOTAL (every input
// resolves to a branch). A future iteration that changes shared code can't silently
// break routing without turning these red.

describe('labelFromText — exact matches', () => {
  for (const branch of ALL_BRANCHES) {
    it(`maps the exact label "${branch.id}" to ${branch.id}`, () => {
      expect(labelFromText(branch.id)).toBe(branch.id);
    });
  }
});

describe('labelFromText — normalization', () => {
  it('is case-insensitive', () => {
    expect(labelFromText('BILLING')).toBe('billing');
    expect(labelFromText('Tech')).toBe('tech');
  });

  it('trims surrounding whitespace/newlines (model output is often padded)', () => {
    expect(labelFromText('  billing\n')).toBe('billing');
  });

  it('matches a label wrapped in stray text via word boundary', () => {
    expect(labelFromText('The category is tech.')).toBe('tech');
    expect(labelFromText('I think this is a billing question')).toBe('billing');
  });
});

describe('labelFromText — fallback keeps the graph total', () => {
  it('falls back to general for an unrecognized label', () => {
    expect(labelFromText('nonsense')).toBe(FALLBACK_BRANCH_ID);
    expect(labelFromText('')).toBe(FALLBACK_BRANCH_ID);
  });

  it('the fallback id is general', () => {
    expect(FALLBACK_BRANCH_ID).toBe('general');
  });

  it('does NOT substring-match inside a larger word (word boundary, not includes)', () => {
    // "technician" contains "tech" but not as a standalone word → should fall back,
    // not route to tech. Guards against a naive .includes() regression.
    expect(labelFromText('technicianxyz')).toBe(FALLBACK_BRANCH_ID);
  });
});

describe('branch registry invariants — the routing contract', () => {
  it('every branch id is unique (ids double as graph node ids)', () => {
    const ids = ALL_BRANCHES.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every branch resolves from its own id (round-trip)', () => {
    for (const branch of ALL_BRANCHES) {
      expect(labelFromText(branch.id)).toBe(branch.id);
    }
  });

  it('the fallback branch is a member of the registry', () => {
    expect(ALL_BRANCHES.some((b) => b.id === FALLBACK_BRANCH_ID)).toBe(true);
  });

  it('the three expected branches are present', () => {
    expect(ALL_BRANCHES).toContain(billingBranch);
    expect(ALL_BRANCHES).toContain(techBranch);
    expect(ALL_BRANCHES).toContain(generalBranch);
  });

  it('every branch has a non-empty description (used in intake prompt + card)', () => {
    for (const branch of ALL_BRANCHES) {
      expect(branch.description.trim().length).toBeGreaterThan(0);
    }
  });
});
