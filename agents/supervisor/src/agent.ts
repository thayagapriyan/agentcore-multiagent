import { Agent, BedrockModel, BeforeToolCallEvent } from '@strands-agents/sdk';
import { ALL_SPECIALISTS } from './specialists.js';

// Supervisor pattern (agent-as-tool): a router Agent whose tools are other Agents.
// Each specialist is wrapped via `agent.asTool({ name, description })` — the
// supervisor's model sees them as ordinary tools and delegates by "calling" them.
// This is the smallest multi-agent step: an agent-as-tool is just another entry in
// the `tools` array (mirrors how the sibling project added Gateway tools).

const SUPERVISOR_PROMPT =
  'You are a supervisor that routes each request to the right specialist tool. ' +
  'Use math_specialist for calculations and greeting_specialist for greetings. ' +
  'For anything else, answer directly. Always return the specialist\'s result to the user.';

// Bedrock model factory. MODEL_ID/region come from the runtime's env; low
// temperature for deterministic routing. Memoized across invocations. (Kept local
// to the agent: packages/common stays SDK-agnostic to avoid the SDK's large peer
// set — agents own their model.)
const DEFAULT_MODEL_ID = 'global.anthropic.claude-haiku-4-5-20251001-v1:0';

let model: BedrockModel | null = null;

function getModel(): BedrockModel {
  return (model ??= new BedrockModel({
    modelId: process.env.MODEL_ID ?? DEFAULT_MODEL_ID,
    region: process.env.AWS_REGION ?? 'us-east-1',
    temperature: 0.2,
  }));
}

// Fresh supervisor per invocation: the Agent carries an invocation lock + history,
// so a shared instance would bleed state across concurrent requests. Specialists are
// rebuilt per call too — cheap, and keeps each request's reasoning isolated.
export function createSupervisor(): Agent {
  const m = getModel();
  const specialistTools = ALL_SPECIALISTS.map((s) =>
    s.build(m).asTool({ name: s.name, description: s.description }),
  );

  const supervisor = new Agent({
    model: m,
    systemPrompt: SUPERVISOR_PROMPT,
    tools: specialistTools,
    printer: false,
  });

  // Observability: log which specialist the supervisor delegates to. Opt-in via
  // LOG_DELEGATION so it's quiet by default. Also doubles as proof that routing
  // (agent-as-tool) is actually happening rather than the supervisor answering
  // directly.
  if (process.env.LOG_DELEGATION === 'true') {
    supervisor.addHook(BeforeToolCallEvent, (event) => {
      console.log(`supervisor → delegating to ${event.toolUse.name}`);
    });
  }

  return supervisor;
}

// The invoke callback handed to the shared server wrapper: build a fresh
// supervisor and run one prompt, returning the result text.
export async function invokeSupervisor(prompt: string): Promise<string> {
  const supervisor = createSupervisor();
  const result = await supervisor.invoke(prompt);
  return result.toString();
}

// Boot-time log so container logs show which specialists are wired.
export function logSpecialists(): void {
  const names = ALL_SPECIALISTS.map((s) => s.name).join(', ');
  console.log(`supervisor: ${ALL_SPECIALISTS.length} specialists loaded — ${names}`);
}
