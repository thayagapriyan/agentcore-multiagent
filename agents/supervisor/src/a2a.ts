import express from 'express';
import { A2AExpressServer } from '@strands-agents/sdk/a2a/express';
import type { A2AServerConfig } from '@strands-agents/sdk/a2a';
import type { AgentSkill } from '@a2a-js/sdk';
import { createSupervisor } from './agent.js';
import { ALL_SPECIALISTS } from './specialists.js';

// A2A is the supervisor's public door (Agent Card + JSON-RPC), opt-in via
// A2A_ENABLED. It runs on its own port (default 9000 — AgentCore's A2A port)
// so the 8080 /ping+/invocations contract is completely untouched.

// The SDK doesn't export InvokableAgent directly; derive it from the config.
type InvokableAgent = A2AServerConfig['agent'];

const AGENT_NAME = 'Multi-Agent Supervisor';
const AGENT_DESCRIPTION =
  'A supervisor agent that routes each request to the right specialist ' +
  '(math, greetings) and returns the result.';

// One card skill per in-process specialist, derived from the same registry the
// supervisor routes with — adding a specialist updates the card automatically.
function specialistSkills(): AgentSkill[] {
  return ALL_SPECIALISTS.map((s) => ({
    id: s.name,
    name: s.name,
    description: s.description,
    tags: ['supervisor', s.name.replace(/_specialist$/, '')],
  }));
}

// The A2A executor holds a single agent for the server's lifetime, but a Strands
// Agent carries an invocation lock + history (see agent.ts). This facade builds a
// fresh supervisor per call so concurrent A2A requests stay isolated, same as the
// /invocations path.
const freshSupervisorPerRequest: InvokableAgent = {
  id: 'multiagent-supervisor',
  name: AGENT_NAME,
  description: AGENT_DESCRIPTION,
  invoke: (args, options) => createSupervisor().invoke(args, options),
  stream: (args, options) => createSupervisor().stream(args, options),
};

export async function startA2AServer(): Promise<void> {
  const port = parseInt(process.env.A2A_PORT ?? '9000', 10);

  const a2a = new A2AExpressServer({
    agent: freshSupervisorPerRequest,
    name: AGENT_NAME,
    description: AGENT_DESCRIPTION,
    version: '0.1.0',
    // The URL advertised on the Agent Card, in precedence order: the AgentCore
    // runtime URL (https://bedrock-agentcore.../runtimes/<arn>/invocations/),
    // an explicit override, or the local listener.
    httpUrl:
      process.env.AGENTCORE_RUNTIME_URL ??
      process.env.A2A_PUBLIC_URL ??
      `http://localhost:${port}`,
    skills: specialistSkills(),
  });

  // Mount the SDK's middleware on our own listener instead of a2a.serve():
  // serve() binds 127.0.0.1 and overwrites the card URL with the bind address,
  // which breaks both container networking and the A2A_PUBLIC_URL override.
  const app = express();

  // AgentCore's A2A contract health-checks GET /ping on this port (9000), not
  // 8080. Registered before the A2A middleware so its root-mounted JSON-RPC
  // handler never sees it.
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
