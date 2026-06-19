import { describe, it, expect } from 'vitest';
import { resolveKbMcpUrl } from '../src/agent.js';

// Deterministic tests for the researcher's MCP-URL resolution — the gate that decides
// whether the cross-runtime MCP tool is wired (KB_MCP_URL set) or the agent runs with
// 0 remote tools (always-green fallback). Pure + env-injectable, so this never
// constructs an McpClient or calls Bedrock. Mirrors the sibling's optional-gateway
// gating, made unit-testable.

describe('resolveKbMcpUrl', () => {
  it('returns the URL when KB_MCP_URL is set', () => {
    expect(resolveKbMcpUrl({ KB_MCP_URL: 'https://example.com/mcp' })).toBe(
      'https://example.com/mcp',
    );
  });

  it('trims surrounding whitespace', () => {
    expect(resolveKbMcpUrl({ KB_MCP_URL: '  https://example.com/mcp  ' })).toBe(
      'https://example.com/mcp',
    );
  });

  it('returns undefined when KB_MCP_URL is unset (0 remote tools, always-green)', () => {
    expect(resolveKbMcpUrl({})).toBeUndefined();
  });

  it('treats an empty or whitespace-only value as unset', () => {
    expect(resolveKbMcpUrl({ KB_MCP_URL: '' })).toBeUndefined();
    expect(resolveKbMcpUrl({ KB_MCP_URL: '   ' })).toBeUndefined();
  });
});
