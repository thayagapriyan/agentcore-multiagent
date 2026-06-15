import {
  Agent,
  BedrockModel,
  type ContentBlock,
} from '@strands-agents/sdk';
import {
  Graph,
  type MultiAgentState,
  type EdgeHandler,
} from '@strands-agents/sdk/multiagent';
import {
  ALL_BRANCHES,
  FALLBACK_BRANCH_ID,
  type Branch,
} from './branches.js';

// Conditional Graph router (iter 5). Unlike the supervisor's agent-as-tool
// pattern (a model picks a tool), routing here is an EXPLICIT directed graph:
//
//   intake ──(label == "billing")──▶ billing ──┐
//          ──(label == "tech")─────▶ tech ─────┤──▶ summarize
//          ──(else / "general")────▶ general ──┘
//
// The intake node classifies the request into exactly one branch label; the edge
// handlers read that label off the graph state and traverse a single branch; the
// summarize node turns the branch's answer into the final customer-facing reply.
// AND-semantics on summarize's incoming edges don't apply because only one branch
// edge is ever satisfied — the branch that didn't run stays PENDING, so its edge
// to summarize is never the gate (summarize fires off the one branch that ran).

const INTAKE_ID = 'intake';
const SUMMARIZE_ID = 'summarize';

const VALID_LABELS = ALL_BRANCHES.map((b) => b.id);

// Intake's only job is to output a single label, nothing else — the edge handlers
// do an exact, case-insensitive match against it. The branch catalog is injected
// so adding a branch updates the prompt automatically.
function intakePrompt(): string {
  const menu = ALL_BRANCHES.map((b) => `- ${b.id}: ${b.description}`).join('\n');
  return (
    'You are a request classifier for a customer-support router. Read the user ' +
    'request and respond with EXACTLY ONE of these category labels and nothing ' +
    `else (no punctuation, no explanation):\n${menu}\n\n` +
    `If it fits none well, answer "${FALLBACK_BRANCH_ID}".`
  );
}

const SUMMARIZE_PROMPT =
  'You are the final responder for a support router. You are given a specialist ' +
  'branch’s answer to the user’s request. Return a single, polished, ' +
  'customer-ready reply based on it. Do not mention routing, branches, or that ' +
  'you are summarizing.';

// Flatten a node's most-recent content blocks to plain text. Branch/intake agents
// emit text blocks; we read them straight off MultiAgentState (no model call).
function nodeText(state: MultiAgentState, nodeId: string): string {
  const blocks = (state.node(nodeId)?.content ?? []) as ContentBlock[];
  return blocks
    .map((b) => ('text' in b && typeof b.text === 'string' ? b.text : ''))
    .join(' ')
    .trim();
}

// The classification intake produced, normalized to a known label (or the
// fallback). Centralized so every edge handler and the log hook agree.
export function classifiedLabel(state: MultiAgentState): string {
  const raw = nodeText(state, INTAKE_ID).toLowerCase();
  // Prefer an exact word match; fall back to substring so a chatty model that
  // wraps the label in stray text still routes. Unknown → fallback branch.
  const exact = VALID_LABELS.find((l) => raw === l);
  if (exact) return exact;
  const contained = VALID_LABELS.find((l) => new RegExp(`\\b${l}\\b`).test(raw));
  return contained ?? FALLBACK_BRANCH_ID;
}

// One edge handler per branch: traverse iff intake classified into this branch.
// The fallback branch also catches any unrecognized label, so the graph is total.
function routeTo(branchId: string): EdgeHandler {
  return (state) => classifiedLabel(state) === branchId;
}

function buildIntake(model: BedrockModel): Agent {
  return new Agent({
    id: INTAKE_ID,
    name: 'intake_classifier',
    model,
    systemPrompt: intakePrompt(),
    tools: [],
    printer: false,
  });
}

function buildSummarize(model: BedrockModel): Agent {
  return new Agent({
    id: SUMMARIZE_ID,
    name: 'summarizer',
    model,
    systemPrompt: SUMMARIZE_PROMPT,
    tools: [],
    printer: false,
  });
}

// Build a fresh Graph per invocation. Each Agent node carries an invocation lock +
// history, so (exactly like the supervisor) a shared graph would serialize and
// bleed state across concurrent requests. The model is memoized (stateless).
export function createRouterGraph(model: BedrockModel): Graph {
  const intake = buildIntake(model);
  const summarize = buildSummarize(model);
  const branches = ALL_BRANCHES.map((b: Branch) => b.build(model));

  return new Graph({
    id: 'support-router',
    nodes: [intake, ...branches, summarize],
    edges: [
      // intake → each branch, gated by the classification label
      ...ALL_BRANCHES.map((b) => ({
        source: INTAKE_ID,
        target: b.id,
        handler: routeTo(b.id),
      })),
      // each branch → summarize (the branch that ran is summarize's only satisfied
      // dependency; the others stay PENDING so they don't gate it)
      ...ALL_BRANCHES.map((b) => ({ source: b.id, target: SUMMARIZE_ID })),
    ],
    // A linear classify→branch→summarize path is 3 steps; cap well above that so a
    // misconfigured cycle can't run forever, but a healthy run never hits it.
    maxSteps: 10,
  });
}

export const ROUTER_GRAPH_NODE_IDS = {
  intake: INTAKE_ID,
  summarize: SUMMARIZE_ID,
} as const;
