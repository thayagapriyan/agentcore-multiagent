import {
  Agent,
  BedrockModel,
  type AgentResult,
  type ContentBlock,
} from '@strands-agents/sdk';

// Critic / reflection loop (iter 7). The third multi-agent pattern in the repo:
//
//   generate ─▶ critique ─(REVISE: feedback)─▶ generate (revise) ─▶ critique ─▶ …
//                        └─(APPROVED)──────────▶ done
//
// Unlike the supervisor (a model picks a tool) and the router (an explicit Graph
// with conditional edges), refinement here is an EXPLICIT CODE LOOP: a generator
// agent drafts, a critic agent reviews, and the loop feeds the critique back into
// the next draft until the critic approves OR a max-iterations cap is hit.
//
// Why a code loop, not a cyclic Graph back-edge: the SDK's Graph snapshots/restores
// agent nodes (stateless across executions) and uses AND-semantics, so a revisited
// node wouldn't accumulate the prior draft + critique — we'd have to thread that
// state through the prompt anyway. The loop does that directly, and the termination
// condition is a PURE function (parseVerdict), so it's unit-testable with no Bedrock.

const GENERATOR_PROMPT =
  'You are a careful writer. Produce the best possible answer to the user’s ' +
  'request. If you are given reviewer feedback on a previous draft, revise the ' +
  'draft to address every point of that feedback. Return only the improved ' +
  'answer — no preamble, no notes about what you changed.';

// The critic must lead with a single verdict token so the loop can parse it
// deterministically. Everything after the token is actionable feedback fed into the
// next draft.
const CRITIC_PROMPT =
  'You are a strict but fair reviewer. You are given a user request and a draft ' +
  'answer to it. Decide whether the draft is correct, complete, and clear enough ' +
  'to send to the user.\n\n' +
  'Respond in this exact format:\n' +
  'On the FIRST line write a single word — "APPROVED" if the draft is good enough ' +
  'to send as-is, or "REVISE" if it needs improvement.\n' +
  'If you wrote REVISE, on the following lines give specific, actionable feedback ' +
  'the writer should apply. If you wrote APPROVED, write nothing else.';

const APPROVED_TOKEN = 'approved';
const REVISE_TOKEN = 'revise';

export interface Verdict {
  /** True iff the critic approved the draft as-is. */
  approved: boolean;
  /** Actionable feedback for the next draft (empty when approved). */
  feedback: string;
}

// Pure verdict parser: map the critic's raw text to {approved, feedback}. Exported
// so the loop's control flow is unit-testable without calling Bedrock (mirrors the
// router's labelFromText seam). Detection rules, in order:
//   - the first non-empty line leads with APPROVED  → approved, no feedback
//   - the first non-empty line leads with REVISE     → not approved, rest is feedback
//   - APPROVED appears as a standalone word anywhere → approved (chatty model)
//   - otherwise                                      → NOT approved (fail safe: never
//     approve slop by accident), whole text as feedback
export function parseVerdict(raw: string): Verdict {
  const text = (raw ?? '').trim();
  const lines = text.split('\n');
  const firstLine = (lines.find((l) => l.trim() !== '') ?? '').trim().toLowerCase();

  if (new RegExp(`^${APPROVED_TOKEN}\\b`).test(firstLine)) {
    return { approved: true, feedback: '' };
  }
  if (new RegExp(`^${REVISE_TOKEN}\\b`).test(firstLine)) {
    return { approved: false, feedback: feedbackAfterToken(text) };
  }
  // No leading token: approve only if APPROVED stands alone somewhere AND REVISE
  // doesn't — otherwise default to revise so an ambiguous verdict never ships.
  const hasApproved = new RegExp(`\\b${APPROVED_TOKEN}\\b`, 'i').test(text);
  const hasRevise = new RegExp(`\\b${REVISE_TOKEN}\\b`, 'i').test(text);
  if (hasApproved && !hasRevise) return { approved: true, feedback: '' };
  return { approved: false, feedback: text };
}

// Strip the leading REVISE token and return the remaining feedback body. The token
// may sit on its own line (feedback follows on later lines) OR lead a line whose
// remainder is feedback (e.g. "REVISE: be more specific") — handle both.
function feedbackAfterToken(text: string): string {
  const lines = text.split('\n');
  const firstIdx = lines.findIndex((l) => l.trim() !== '');
  const firstLine = lines[firstIdx] ?? '';
  // Drop the token (and any immediately-following ":" / "-" / whitespace) from the
  // first line; keep whatever's left, then append the subsequent lines.
  const sameLineRest = firstLine
    .trim()
    .replace(new RegExp(`^${REVISE_TOKEN}\\b[\\s:.\\-]*`, 'i'), '');
  return [sameLineRest, ...lines.slice(firstIdx + 1)].join('\n').trim();
}

export interface LoopConfig {
  /** Hard cap on generate→critique rounds. Guarantees termination. */
  maxIterations: number;
  /** Optional per-round logger (round, verdict). */
  onRound?: (round: number, verdict: Verdict) => void;
}

export interface LoopResult {
  /** The final (best-effort) answer returned to the caller. */
  answer: string;
  /** How many generate→critique rounds ran. */
  rounds: number;
  /** True iff the critic approved before the cap was hit. */
  approved: boolean;
}

// Build the two role agents. Both share the loop's model — same dependency-free,
// in-process POC shape as the supervisor's specialists and the router's branches.
// id/name are stable so logs and any future card skills line up.
function buildGenerator(model: BedrockModel): Agent {
  return new Agent({
    id: 'generator',
    name: 'generator',
    model,
    systemPrompt: GENERATOR_PROMPT,
    tools: [],
    printer: false,
  });
}

function buildCritic(model: BedrockModel): Agent {
  return new Agent({
    id: 'critic',
    name: 'critic',
    model,
    systemPrompt: CRITIC_PROMPT,
    tools: [],
    printer: false,
  });
}

// Flatten an AgentResult's final message to plain text (text blocks only).
function agentText(result: AgentResult): string {
  const blocks = (result.lastMessage?.content ?? []) as ContentBlock[];
  return blocks
    .map((b) => ('text' in b && typeof b.text === 'string' ? b.text : ''))
    .join('')
    .trim();
}

// Produce a draft for the request given optional prior feedback + draft.
export type Generate = (prompt: string, feedback: string, prevDraft: string) => Promise<string>;
// Review a draft and return the critic's raw verdict text.
export type Critique = (prompt: string, draft: string) => Promise<string>;

// The pure reflection loop, decoupled from the SDK: it only needs a `generate` and
// a `critique` callback. Exported so the loop's control flow + termination — the
// part that must never run forever — is unit-testable with stub callbacks and no
// Bedrock (mirrors the router's labelFromText seam). Always returns the latest
// draft, even if never approved (always-green: /invocations must answer), and the
// round count never exceeds the cap (the termination guarantee).
export async function reflect(
  prompt: string,
  generate: Generate,
  critique: Critique,
  config: LoopConfig,
): Promise<LoopResult> {
  const maxIterations = Math.max(1, config.maxIterations);
  let draft = '';
  let feedback = '';
  let approved = false;
  let rounds = 0;

  for (let round = 1; round <= maxIterations; round++) {
    rounds = round;
    draft = await generate(prompt, feedback, draft);

    const verdict = parseVerdict(await critique(prompt, draft));
    config.onRound?.(round, verdict);

    if (verdict.approved) {
      approved = true;
      break;
    }
    feedback = verdict.feedback;
  }

  return { answer: draft, rounds, approved };
}

// The reflection loop wired to real Strands agents. Fresh agents per call (Strands
// Agents carry an invocation lock + history — a shared instance would serialize and
// bleed state across concurrent requests, exactly like the supervisor/router).
export async function runCriticLoop(
  model: BedrockModel,
  prompt: string,
  config: LoopConfig,
): Promise<LoopResult> {
  const generator = buildGenerator(model);
  const critic = buildCritic(model);

  const generate: Generate = async (req, feedback, prevDraft) => {
    const input =
      feedback === ''
        ? req
        : `User request:\n${req}\n\nReviewer feedback on your previous draft:\n${feedback}\n\nYour previous draft:\n${prevDraft}`;
    return agentText(await generator.invoke(input));
  };

  const critique: Critique = async (req, draft) =>
    agentText(await critic.invoke(`User request:\n${req}\n\nDraft answer:\n${draft}`));

  return reflect(prompt, generate, critique, config);
}
