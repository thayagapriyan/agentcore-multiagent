import { startServer } from '@multiagent/common';
import { invokeSupervisor, logSpecialists } from './agent.js';

startServer({
  invoke: invokeSupervisor,
  onListen: logSpecialists,
});
