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
import { invokeCritic } from './agent.js';

// The critic's public A2A door (Agent Card + JSON-RPC), opt-in via A2A_ENABLED, on
// its own port (default 9000 — AgentCore's A2A port) so the 8080 /ping+/invocations
// contract is untouched. Mirrors the router's a2a.ts facade: the executor consumes
// an Agent result, but our orchestrator is a code loop returning a string, so this
// runs a fresh loop per call and adapts its text to an AgentResult.

type InvokableAgent = A2AServerConfig['agent'];

const AGENT_NAME = 'Multi-Agent Critic';
const AGENT_DESCRIPTION =
  'A generator↔critic reflection loop: it drafts an answer, a critic reviews it, ' +
  'and it revises until the critic approves or a max-iterations cap is reached, ' +
  'then returns the refined answer.';

// One advertised skill — the refinement capability. Kept explicit (not a registry)
// because the critic has a single skill, unlike the router's per-branch skills.
function criticSkills(): AgentSkill[] {
  return [
    {
      id: 'refine',
      name: 'refine_answer',
      description:
        'Produce a high-quality answer via iterative self-review (generate → critique → revise until approved).',
      tags: ['critic', 'reflection', 'refine'],
    },
  ];
}

// Fresh loop per call (isolation, same as /invocations); adapt the answer string to
// an AgentResult the A2A executor can publish as its single artifact chunk.
const loopAsInvokableAgent: InvokableAgent = {
  id: 'multiagent-critic',
  name: AGENT_NAME,
  description: AGENT_DESCRIPTION,
  invoke: async (args) => toAgentResult(await invokeCritic(promptOf(args))),
  stream: async function* (args): AsyncGenerator<StreamEvent, AgentResult, undefined> {
    return toAgentResult(await invokeCritic(promptOf(args)));
  },
};

// Flatten the A2A executor's content-block args to the prompt string the loop expects.
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
    agent: loopAsInvokableAgent,
    name: AGENT_NAME,
    description: AGENT_DESCRIPTION,
    version: '0.1.0',
    httpUrl:
      process.env.AGENTCORE_RUNTIME_URL ??
      process.env.A2A_PUBLIC_URL ??
      `http://localhost:${port}`,
    skills: criticSkills(),
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
