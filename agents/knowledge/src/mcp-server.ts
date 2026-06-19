import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { lookup, knownTopics } from './kb.js';

// The knowledge agent's MCP server (iter 8). Unlike every prior agent — which serves
// the AgentCore HTTP /ping+/invocations contract — this runtime serves the MCP
// PROTOCOL (server_protocol = "MCP" on its runtime). It exposes ONE deterministic
// tool, kb_lookup, that the researcher agent calls over MCP across the runtime
// boundary. This is the project's first runtime-to-runtime call.
//
// Stateless transport (sessionIdGenerator: undefined): AgentCore Runtime is a
// horizontally-scaled, per-request environment — no sticky sessions — so each MCP
// request is self-contained (the MCP equivalent of the "fresh Agent per invocation"
// rule the LLM agents follow). A fresh server+transport per request keeps concurrent
// callers isolated.

export const TOOL_NAME = 'kb_lookup';

function buildServer(): McpServer {
  const server = new McpServer(
    { name: 'multiagent-knowledge', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    TOOL_NAME,
    {
      title: 'Knowledge-base lookup',
      description:
        'Look up a canned fact about a project topic. Known topics: ' +
        knownTopics().join(', ') +
        '. Returns the fact, or a not-found message naming the known topics.',
      inputSchema: { topic: z.string().describe('The topic to look up, e.g. "mcp" or "a2a".') },
    },
    async ({ topic }) => ({
      content: [{ type: 'text' as const, text: lookup(topic) }],
    }),
  );

  return server;
}

// Handle one MCP POST. Per-request server + transport (stateless), closed when the
// response finishes so nothing leaks across the scaled runtime's requests.
export async function handleMcpRequest(
  req: Parameters<StreamableHTTPServerTransport['handleRequest']>[0],
  res: Parameters<StreamableHTTPServerTransport['handleRequest']>[1],
  body: unknown,
): Promise<void> {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

export function logTools(): void {
  console.log(`knowledge: MCP server ready — tool "${TOOL_NAME}", topics: ${knownTopics().join(', ')}`);
}
