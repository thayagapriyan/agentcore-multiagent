import { BedrockModel } from '@strands-agents/sdk';
import { runCriticLoop, type LoopResult } from './critic-loop.js';

// The critic deployable: a generator↔critic reflection loop behind the shared
// /ping+/invocations wrapper. Mirrors the supervisor and router shape — local model
// factory (packages/common stays SDK-agnostic), fresh orchestrator per request,
// opt-in delegation logging — but the orchestration primitive is an explicit code
// loop with a max-iterations cap, not agent-as-tool or a Graph.

const DEFAULT_MODEL_ID = 'global.anthropic.claude-haiku-4-5-20251001-v1:0';
const DEFAULT_MAX_ITERATIONS = 3;

let model: BedrockModel | null = null;

function getModel(): BedrockModel {
  return (model ??= new BedrockModel({
    modelId: process.env.MODEL_ID ?? DEFAULT_MODEL_ID,
    region: process.env.AWS_REGION ?? 'us-east-1',
    // The generator benefits from some creativity; kept moderate so the critic's
    // verdict token stays well-formed and the draft still improves between rounds.
    temperature: 0.4,
  }));
}

// Max generate→critique rounds before the loop returns the best-effort draft.
// Env-tunable; clamped to >=1 by the loop itself.
function maxIterations(): number {
  const raw = parseInt(process.env.MAX_ITERATIONS ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_ITERATIONS;
}

// Run one prompt through a fresh reflection loop. Opt-in LOG_DELEGATION logs each
// round's verdict (the critic-loop analogue of the supervisor's tool-delegation log
// and the router's node-routing log) — proof the loop iterated and terminated.
export async function runLoop(prompt: string): Promise<LoopResult> {
  const log = process.env.LOG_DELEGATION === 'true';
  return runCriticLoop(getModel(), prompt, {
    maxIterations: maxIterations(),
    onRound: log
      ? (round, verdict) =>
          console.log(
            `critic → round ${round}: ${verdict.approved ? 'APPROVED' : 'REVISE'}` +
              (verdict.approved ? '' : ` — ${verdict.feedback.slice(0, 120)}`),
          )
      : undefined,
  });
}

// The invoke callback handed to the shared server wrapper: return the loop's
// best-effort answer. (The /invocations contract is {result: string}.)
export async function invokeCritic(prompt: string): Promise<string> {
  const result = await runLoop(prompt);
  if (process.env.LOG_DELEGATION === 'true') {
    console.log(
      `critic: done in ${result.rounds} round(s), ${result.approved ? 'approved' : 'cap reached (best-effort)'}`,
    );
  }
  return result.answer;
}

// Boot-time log so container logs show the loop is wired and its cap.
export function logLoop(): void {
  console.log(
    `critic: generator↔critic reflection loop wired (max ${maxIterations()} rounds, returns best-effort draft on cap)`,
  );
}
