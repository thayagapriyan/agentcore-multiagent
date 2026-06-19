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
import { invokeResearcher } from './agent.js';

// The researcher's public A2A door (Agent Card + JSON-RPC), opt-in via A2A_ENABLED,
// on its own port (default 9000 — AgentCore's A2A port) so the 8080 /ping+/invocations
// contract is untouched. The researcher is the PUBLIC agent of this iter-8 pair; the
// knowledge runtime it calls over MCP stays internal (no A2A). Mirrors the critic's
// a2a.ts facade: a fresh agent per call, its text adapted to an AgentResult.

type InvokableAgent = A2AServerConfig['agent'];

const AGENT_NAME = 'Multi-Agent Researcher';
const AGENT_DESCRIPTION =
  'A research assistant that answers questions about project topics by calling a ' +
  'separately-deployed knowledge agent over MCP (Model Context Protocol) and quoting ' +
  'the looked-up fact. Demonstrates a cross-runtime tool call.';

function researcherSkills(): AgentSkill[] {
  return [
    {
      id: 'research',
      name: 'research_topic',
      description:
        'Answer a question about a project topic, backed by an authoritative fact fetched from the knowledge agent over MCP.',
      tags: ['research', 'mcp', 'knowledge'],
    },
  ];
}

const researcherAsInvokableAgent: InvokableAgent = {
  id: 'multiagent-researcher',
  name: AGENT_NAME,
  description: AGENT_DESCRIPTION,
  invoke: async (args) => toAgentResult(await invokeResearcher(promptOf(args))),
  stream: async function* (args): AsyncGenerator<StreamEvent, AgentResult, undefined> {
    return toAgentResult(await invokeResearcher(promptOf(args)));
  },
};

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
    agent: researcherAsInvokableAgent,
    name: AGENT_NAME,
    description: AGENT_DESCRIPTION,
    version: '0.1.0',
    httpUrl:
      process.env.AGENTCORE_RUNTIME_URL ??
      process.env.A2A_PUBLIC_URL ??
      `http://localhost:${port}`,
    skills: researcherSkills(),
  });

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
