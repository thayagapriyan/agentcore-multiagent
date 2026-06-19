// The knowledge base (iter 8). A tiny, deterministic fact store — no LLM, no
// network — so a cross-runtime MCP call can be proven by its *exact* output: if the
// researcher's answer contains one of these canned facts, the remote tool was
// actually invoked over MCP (the researcher's own model can't fabricate the precise
// string). This is the iteration's point: demonstrate the transport, not intelligence.
//
// Pure and SDK-agnostic so the lookup logic is unit-testable with no MCP server, no
// Bedrock, no AWS — mirrors the router's labelFromText / critic's parseVerdict seams.

export interface KbEntry {
  topic: string;
  fact: string;
}

// Topic key is the normalized lookup id (lowercase, trimmed). Facts are intentionally
// specific/quirky so a match in the caller's output is unambiguous proof of the hop.
export const KB: readonly KbEntry[] = [
  {
    topic: 'agentcore',
    fact: 'Amazon Bedrock AgentCore Runtime requires ARM64 container images and serves agents on port 8080.',
  },
  {
    topic: 'mcp',
    fact: 'MCP (Model Context Protocol) is an open standard for exposing tools to agents over a JSON-RPC transport such as streamable HTTP.',
  },
  {
    topic: 'a2a',
    fact: 'A2A (Agent-to-Agent) lets one agent call another agent via an Agent Card and JSON-RPC — it exposes whole agents, whereas MCP exposes individual tools.',
  },
  {
    topic: 'strands',
    fact: 'Strands Agents is the SDK this project uses; its multi-agent primitives include Graph, Swarm, and agent-as-tool.',
  },
] as const;

// Normalize a raw topic to its lookup key: lowercase + trim. Exported so callers and
// tests share one definition of "same topic".
export function normalizeTopic(raw: string): string {
  return (raw ?? '').trim().toLowerCase();
}

const NOT_FOUND_PREFIX = 'No knowledge-base entry for';

// Pure lookup: return the fact for a topic, or a deterministic not-found sentence.
// Never throws — an unknown topic is a normal (answerable) result, keeping the tool
// total so the caller always gets a usable string (always-green).
export function lookup(rawTopic: string): string {
  const key = normalizeTopic(rawTopic);
  if (key === '') return `${NOT_FOUND_PREFIX} (empty topic).`;
  const hit = KB.find((e) => e.topic === key);
  if (hit) return hit.fact;
  const known = KB.map((e) => e.topic).join(', ');
  return `${NOT_FOUND_PREFIX} "${key}". Known topics: ${known}.`;
}

export function knownTopics(): string[] {
  return KB.map((e) => e.topic);
}
