import { BedrockModel } from '@strands-agents/sdk';
import {
  BeforeNodeCallEvent,
  type MultiAgentResult,
} from '@strands-agents/sdk/multiagent';
import { createRouterGraph, classifiedLabel } from './graph.js';
import { ALL_BRANCHES } from './branches.js';

// The router deployable: a Strands Graph (intake → conditional branch →
// summarize) behind the shared /ping+/invocations wrapper. Mirrors the
// supervisor's shape — local model factory (packages/common stays SDK-agnostic),
// fresh orchestrator per request, opt-in delegation logging — but the
// orchestration primitive is an explicit Graph with conditional edges, not
// agent-as-tool.

const DEFAULT_MODEL_ID = 'global.anthropic.claude-haiku-4-5-20251001-v1:0';

let model: BedrockModel | null = null;

function getModel(): BedrockModel {
  return (model ??= new BedrockModel({
    modelId: process.env.MODEL_ID ?? DEFAULT_MODEL_ID,
    region: process.env.AWS_REGION ?? 'us-east-1',
    // Low temperature: the intake node must classify deterministically.
    temperature: 0.2,
  }));
}

// Build a fresh router Graph per request (graph nodes are stateful Agents — see
// graph.ts). Opt-in LOG_DELEGATION logs which branch the graph routed to, derived
// from intake's classification, as each node starts — the Graph analogue of the
// supervisor's tool-delegation log, and proof the conditional edges fired.
export function createRouter() {
  const graph = createRouterGraph(getModel());

  if (process.env.LOG_DELEGATION === 'true') {
    graph.addHook(BeforeNodeCallEvent, (event) => {
      const label = classifiedLabel(event.state);
      console.log(`router → node ${event.nodeId} (classified: ${label})`);
    });
  }

  return graph;
}

function resultText(result: MultiAgentResult): string {
  return result.content
    .map((b) => ('text' in b && typeof b.text === 'string' ? b.text : ''))
    .join('')
    .trim();
}

// The invoke callback handed to the shared server wrapper: run one prompt through
// a fresh graph and return the summarize node's text (the graph's terminus).
export async function invokeRouter(prompt: string): Promise<string> {
  const graph = createRouter();
  const result = await graph.invoke(prompt);
  return resultText(result);
}

// Boot-time log so container logs show which branches are wired.
export function logBranches(): void {
  const names = ALL_BRANCHES.map((b) => b.id).join(', ');
  console.log(
    `router: ${ALL_BRANCHES.length} branches wired (intake → conditional → summarize) — ${names}`,
  );
}
