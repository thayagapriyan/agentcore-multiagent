import { Agent, BedrockModel, McpClient, BeforeToolCallEvent } from '@strands-agents/sdk';
import { resolveKbAuthConfig, mintKbToken } from './kb-auth.js';

// Researcher pattern (iter 8): the project's first agent that calls ANOTHER agent
// runtime over MCP across the network. It connects to the separately-deployed
// `knowledge` runtime (which serves the MCP protocol) as an McpClient and adds its
// remote tools to its own tool list. Contrast the supervisor/router/critic, whose
// sub-agents all live IN-PROCESS — here the tool is a different container, a different
// runtime, reached over streamable HTTP.
//
// The MCP connection is OPTIONAL FOREVER (mirrors the sibling's AGENTCORE_GATEWAY_URL
// pattern): tools are wired only when KB_MCP_URL is set, and continueOnError keeps an
// invocation working (with 0 remote tools) even if the knowledge runtime is
// unreachable. Always-green: /invocations must return a valid answer regardless.

const RESEARCHER_PROMPT =
  'You are a research assistant backed by an authoritative knowledge base. Whenever the ' +
  'user asks about a topic — and ALWAYS when they mention the knowledge base or ask ' +
  'about a technical/project subject — you MUST first call the kb_lookup tool and base ' +
  'your answer on the fact it returns. Do not answer technical or project questions from ' +
  'your own memory before calling kb_lookup; your own recollection of these topics is ' +
  'unreliable and the looked-up fact is the source of truth. Quote the looked-up fact in ' +
  'your answer. Only if the kb_lookup tool is genuinely unavailable (not wired) may you ' +
  'fall back to your own knowledge — and then say so briefly. For everyday general-' +
  'knowledge questions unrelated to any tooled topic, you may answer directly.';

const DEFAULT_MODEL_ID = 'global.anthropic.claude-haiku-4-5-20251001-v1:0';

let model: BedrockModel | null = null;

function getModel(): BedrockModel {
  return (model ??= new BedrockModel({
    modelId: process.env.MODEL_ID ?? DEFAULT_MODEL_ID,
    region: process.env.AWS_REGION ?? 'us-east-1',
    temperature: 0.2,
  }));
}

// Resolve the knowledge runtime's MCP endpoint. The MCP JSON-RPC message is POSTed to
// the runtime's InvokeAgentRuntime path (/runtimes/{arn}/invocations?qualifier=DEFAULT);
// AgentCore proxies it to the container's internal /mcp route. KB_MCP_URL carries the
// full public URL. Pure + exported so URL handling is unit-testable without an McpClient.
export function resolveKbMcpUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const url = env.KB_MCP_URL?.trim();
  return url ? url : undefined;
}

// The MCP client is resolved once (memoized) — connecting per request would re-handshake
// on every call. continueOnError so a knowledge-runtime outage degrades to 0 tools, not
// a 500. Mirrors the sibling's getGatewayClient, plus a bearer token in `headers`
// because the knowledge MCP runtime is JWT-gated (AgentCore has no no-auth runtime).
//
// Resolution is async (token minting is a network call) and memoized via a promise so
// concurrent first-callers share one mint. Token refresh: Cognito access tokens last
// ~1h; a fresh McpClient is rebuilt on a timer so a long-lived runtime never serves an
// expired token.
let mcpClientPromise: Promise<McpClient | null> | null = null;
const TOKEN_REFRESH_MS = 50 * 60 * 1000; // refresh before the 60-min Cognito expiry
let refreshTimer: NodeJS.Timeout | null = null;

// Cold-start resilience (verified against live CloudWatch): on a freshly-scaled
// AgentCore instance, the FIRST outbound MCP connect occasionally fails with a bare
// `TypeError: fetch failed` even though the knowledge endpoint is healthy (probed 6/6
// HTTP 200). With continueOnError the SDK swallows that into a permanent 'failed'
// state, so a one-shot memoized client would freeze that instance at 0 tools for life
// and the model, finding no kb_lookup tool, fabricates tool-call XML. We defend on two
// fronts: bounded retry here, and re-arming the memo in getKbClient so a still-stuck
// instance retries on its next invocation instead of degrading forever.
const CONNECT_RETRIES = 3;
const CONNECT_BACKOFF_MS = 250;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function buildKbClient(): Promise<McpClient | null> {
  const url = resolveKbMcpUrl();
  if (!url) return null;

  // JWT-gated door: mint a bearer token and pass it as a static header. If auth isn't
  // configured (or minting fails), still build the client without a header — the
  // gated runtime will reject and McpClient (continueOnError) reports 0 tools, so the
  // researcher degrades gracefully instead of crashing (always-green).
  const headers: Record<string, string> = {};
  const auth = resolveKbAuthConfig();
  if (auth) {
    try {
      headers.Authorization = `Bearer ${await mintKbToken(auth)}`;
    } catch (err) {
      console.warn('researcher: failed to mint knowledge MCP token —', (err as Error).message);
    }
  }

  const client = new McpClient({ url, headers, continueOnError: true });

  // Eagerly connect with bounded retry. listTools() drives the actual connect; a
  // successful call with ≥1 tool proves the hop works. continueOnError means a failed
  // connect resolves to [] rather than throwing, so a 0-length result is also a
  // "retry" signal, not just a thrown error. Return null on exhaustion so getKbClient
  // re-arms (does NOT cache a dead client).
  for (let attempt = 1; attempt <= CONNECT_RETRIES; attempt++) {
    try {
      const tools = await client.listTools();
      if (tools.length > 0) return client;
      console.warn(
        `researcher: knowledge MCP returned 0 tools (attempt ${attempt}/${CONNECT_RETRIES})`,
      );
    } catch (err) {
      console.warn(
        `researcher: knowledge MCP connect failed (attempt ${attempt}/${CONNECT_RETRIES}) —`,
        (err as Error).message,
      );
    }
    if (attempt < CONNECT_RETRIES) await sleep(CONNECT_BACKOFF_MS * attempt);
  }
  return null;
}

async function getKbClient(): Promise<McpClient | null> {
  if (!mcpClientPromise) {
    mcpClientPromise = buildKbClient();
    // Schedule a refresh so the bearer token never goes stale on a long-lived runtime.
    // unref() so the timer never keeps the process alive on its own.
    if (!refreshTimer) {
      refreshTimer = setInterval(() => {
        mcpClientPromise = buildKbClient();
      }, TOKEN_REFRESH_MS);
      refreshTimer.unref?.();
    }
  }

  const client = await mcpClientPromise;
  // Re-arm: a null result means "MCP not wired (KB_MCP_URL unset)" OR "connect retries
  // exhausted on this instance". The first is permanent and cheap to recompute; the
  // second is the cold-start race we want to recover from — so drop the memo and let
  // the NEXT invocation rebuild. resolveKbMcpUrl gates the wasted-work case (unset URL
  // returns null immediately without a network call), so re-arming is safe either way.
  if (client === null) mcpClientPromise = null;
  return client;
}

// Fresh researcher per invocation (the Agent carries an invocation lock + history —
// a shared instance would bleed state across concurrent requests, same rule as the
// other agents). The MCP client itself is shared/memoized: it is a connection, not
// conversational state.
export async function createResearcher(): Promise<Agent> {
  const client = await getKbClient();
  const tools = client ? [client] : [];

  const researcher = new Agent({
    model: getModel(),
    systemPrompt: RESEARCHER_PROMPT,
    tools,
    printer: false,
  });

  // Observability: log when the researcher calls a remote MCP tool — opt-in via
  // LOG_DELEGATION (same knob as the other agents). Doubles as proof the cross-runtime
  // hop actually fired rather than the model answering from its own knowledge.
  if (process.env.LOG_DELEGATION === 'true') {
    researcher.addHook(BeforeToolCallEvent, (event) => {
      console.log(`researcher → calling remote MCP tool ${event.toolUse.name}`);
    });
  }

  return researcher;
}

export async function invokeResearcher(prompt: string): Promise<string> {
  const researcher = await createResearcher();
  const result = await researcher.invoke(prompt);
  return result.toString();
}

// One-time, non-fatal boot probe: log whether the MCP door is wired. getKbClient now
// connects-with-retry and only returns a non-null client once it has ≥1 tool, so a
// non-null result here already means the hop is live. A null result means either
// KB_MCP_URL is unset or the cold-start retries were exhausted — either way the
// researcher serves from its own knowledge (always-green) and will retry on the next
// real invocation. Mirrors the sibling's logGatewayStatus.
export async function logMcpStatus(): Promise<void> {
  const client = await getKbClient();
  if (client) {
    const tools = await client.listTools();
    console.log(`researcher: connected to knowledge MCP, ${tools.length} remote tool(s) loaded`);
  } else if (!resolveKbMcpUrl()) {
    console.log('researcher: KB_MCP_URL unset — 0 remote tools (answering from own knowledge)');
  } else {
    console.warn(
      'researcher: knowledge MCP not ready at boot — 0 remote tools; will retry on next invocation',
    );
  }
}
