import express from 'express';
import { handleMcpRequest, logTools } from './mcp-server.js';

// The knowledge agent's HTTP entrypoint. It does NOT use packages/common's
// /invocations wrapper — that wrapper speaks the AgentCore HTTP agent contract, but
// this runtime speaks MCP. AgentCore's MCP server protocol expects the MCP endpoint
// at POST /mcp and still health-checks GET /ping, so we serve both directly.

const PORT = parseInt(process.env.PORT ?? '8080', 10);

const app = express();
app.use(express.json());

// AgentCore health check (same contract as the other agents' /ping).
app.get('/ping', (_req, res) => {
  res.json({ status: 'ok' });
});

// The MCP door. POST /mcp is the streamable-HTTP MCP endpoint AgentCore routes to.
app.post('/mcp', async (req, res) => {
  try {
    await handleMcpRequest(req, res, req.body);
  } catch (err) {
    console.error('knowledge: MCP request failed', err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

// MCP streamable HTTP is POST-only for stateless servers; GET/DELETE on /mcp would be
// session-stream operations we don't support — answer 405 instead of a silent hang.
app.all('/mcp', (req, res) => {
  if (req.method === 'POST') return; // handled above
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed (stateless MCP server is POST-only).' },
    id: null,
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`knowledge: listening on :${PORT} (GET /ping, POST /mcp)`);
  logTools();
});
