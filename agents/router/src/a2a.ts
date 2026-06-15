import express from 'express';
import {
  AgentResult,
  Message,
  TextBlock,
  type StreamEvent,
} from '@strands-agents/sdk';
import { A2AExpressServer } from '@strands-agents/sdk/a2a/express';
import type { A2AServerConfig } from '@strands-agents/sdk/a2a';
import type { AgentSkill } from '@a2a-js/sdk';
import { invokeRouter } from './agent.js';
import { ALL_BRANCHES } from './branches.js';

// The router's public A2A door (Agent Card + JSON-RPC), opt-in via A2A_ENABLED, on
// its own port (default 9000 — AgentCore's A2A port) so the 8080 /ping+/invocations
// contract is untouched. Mirrors the supervisor's a2a.ts; the difference is the
// facade runs a Graph, not an agent-as-tool supervisor.

type InvokableAgent = A2AServerConfig['agent'];

const AGENT_NAME = 'Multi-Agent Router';
const AGENT_DESCRIPTION =
  'A conditional-graph router that classifies each support request (intake) and ' +
  'routes it through the right branch (billing, tech, general), then returns a ' +
  'single polished reply.';

// One card skill per branch, derived from the same registry the graph routes with
// — adding a branch updates the card automatically.
function branchSkills(): AgentSkill[] {
  return ALL_BRANCHES.map((b) => ({
    id: b.id,
    name: `${b.id}_branch`,
    description: b.description,
    tags: ['router', b.id],
  }));
}

// The A2A executor holds a single agent for the server's lifetime and consumes the
// stream's final value via .toString(). A Graph returns a MultiAgentResult (no
// useful toString) and isn't an InvokableAgent, so this facade runs a fresh graph
// per call (isolation, same as /invocations) and adapts its text to an AgentResult.
const graphAsInvokableAgent: InvokableAgent = {
  id: 'multiagent-router',
  name: AGENT_NAME,
  description: AGENT_DESCRIPTION,
  invoke: async (args) => toAgentResult(await invokeRouter(promptOf(args))),
  // Non-streaming: yield nothing, return the final result. The executor publishes
  // the returned value's text as the single artifact chunk.
  stream: async function* (args): AsyncGenerator<StreamEvent, AgentResult, undefined> {
    return toAgentResult(await invokeRouter(promptOf(args)));
  },
};

// The A2A executor passes content blocks as the invoke args; flatten them to the
// prompt string our graph's intake node expects.
function promptOf(args: unknown): string {
  if (typeof args === 'string') return args;
  if (Array.isArray(args)) {
    return args
      .map((b) => (b && typeof b === 'object' && 'text' in b ? String((b as { text: unknown }).text) : ''))
      .join(' ')
      .trim();
  }
  return String(args ?? '');
}

function toAgentResult(text: string): AgentResult {
  return new AgentResult({
    stopReason: 'endTurn',
    lastMessage: new Message({ role: 'assistant', content: [new TextBlock(text)] }),
    invocationState: {},
  });
}

export async function startA2AServer(): Promise<void> {
  const port = parseInt(process.env.A2A_PORT ?? '9000', 10);

  const a2a = new A2AExpressServer({
    agent: graphAsInvokableAgent,
    name: AGENT_NAME,
    description: AGENT_DESCRIPTION,
    version: '0.1.0',
    httpUrl:
      process.env.AGENTCORE_RUNTIME_URL ??
      process.env.A2A_PUBLIC_URL ??
      `http://localhost:${port}`,
    skills: branchSkills(),
  });

  // Own listener (not a2a.serve()): bind 0.0.0.0 and preserve the card URL — see
  // the supervisor's a2a.ts for the full reasoning.
  const app = express();

  // AgentCore's A2A contract health-checks GET /ping on this port (9000).
  app.get('/ping', (_req, res) => {
    res.json({ status: 'Healthy' });
  });

  app.use(a2a.createMiddleware());

  await new Promise<void>((resolve, reject) => {
    app
      .listen(port, '0.0.0.0', () => {
        console.log(`a2a: agent card + JSON-RPC listening on :${port}`);
        resolve();
      })
      .on('error', reject);
  });
}
