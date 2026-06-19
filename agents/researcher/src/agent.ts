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
  'You are a research assistant. When the user asks about a project topic, use the ' +
  'kb_lookup tool to fetch an authoritative fact and base your answer on it. Quote ' +
  'the looked-up fact in your answer. If no tool is available or the topic is ' +
  'unknown, answer from your own knowledge and say so briefly.';

const DEFAULT_MODEL_ID = 'global.anthropic.claude-haiku-4-5-20251001-v1:0';

let model: BedrockModel | null = null;

function getModel(): BedrockModel {
  return (model ??= new BedrockModel({
    modelId: process.env.MODEL_ID ?? DEFAULT_MODEL_ID,
    region: process.env.AWS_REGION ?? 'us-east-1',
    temperature: 0.2,
  }));
}

// Resolve the knowledge runtime's MCP endpoint. AgentCore exposes a runtime's MCP
// server under its invocation URL at the /mcp path; KB_MCP_URL carries the full URL.
// Pure + exported so URL handling is unit-testable without constructing an McpClient.
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

  return new McpClient({ url, headers, continueOnError: true });
}

function getKbClient(): Promise<McpClient | null> {
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
  return mcpClientPromise;
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

// One-time, non-fatal boot probe: log whether the MCP door is wired and how many
// remote tools loaded. Mirrors the sibling's logGatewayStatus.
export async function logMcpStatus(): Promise<void> {
  const client = await getKbClient();
  if (!client) {
    console.log('researcher: KB_MCP_URL unset — 0 remote tools (answering from own knowledge)');
    return;
  }
  try {
    const tools = await client.listTools();
    console.log(`researcher: connected to knowledge MCP, ${tools.length} remote tool(s) loaded`);
  } catch (err) {
    console.warn(
      'researcher: knowledge MCP connection failed, continuing with 0 remote tools —',
      (err as Error).message,
    );
  }
}
