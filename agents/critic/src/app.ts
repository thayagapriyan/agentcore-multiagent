import { startServer } from '@multiagent/common';
import { invokeCritic, logLoop } from './agent.js';
import { startA2AServer } from './a2a.js';

startServer({
  invoke: invokeCritic,
  onListen: logLoop,
});

// Public A2A door, opt-in. A failure here must never take down the AgentCore
// invoke contract above, so log loudly and keep serving.
if (process.env.A2A_ENABLED === 'true') {
  startA2AServer().catch((err) => {
    console.error('a2a: server failed to start — invoke path unaffected', err);
  });
}
