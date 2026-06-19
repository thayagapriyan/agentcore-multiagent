import { describe, it, expect } from 'vitest';
import { lookup, normalizeTopic, knownTopics, KB } from '../src/kb.js';

// Deterministic knowledge-base tests (no MCP server, no Bedrock, no AWS). These lock
// the lookup contract the cross-runtime MCP call depends on: the researcher's answer
// is only trustworthy proof of the hop if kb_lookup returns an EXACT, stable fact.
// This is the knowledge agent's pure seam (mirrors the router's labelFromText and the
// critic's parseVerdict).

describe('normalizeTopic', () => {
  it('lowercases and trims', () => {
    expect(normalizeTopic('  MCP  ')).toBe('mcp');
    expect(normalizeTopic('A2A')).toBe('a2a');
  });

  it('maps null/undefined to empty string (never throws)', () => {
    expect(normalizeTopic(undefined as unknown as string)).toBe('');
    expect(normalizeTopic(null as unknown as string)).toBe('');
  });
});

describe('lookup — known topics', () => {
  it('returns the exact fact for each known topic, case/space-insensitively', () => {
    for (const entry of KB) {
      expect(lookup(entry.topic)).toBe(entry.fact);
      expect(lookup(` ${entry.topic.toUpperCase()} `)).toBe(entry.fact);
    }
  });

  it('every known fact is non-empty (a hit always carries proof text)', () => {
    for (const entry of KB) {
      expect(entry.fact.length).toBeGreaterThan(0);
    }
  });
});

describe('lookup — misses are total, not thrown', () => {
  it('returns a deterministic not-found message naming the known topics', () => {
    const out = lookup('quantum-gravity');
    expect(out).toContain('No knowledge-base entry for');
    expect(out).toContain('quantum-gravity');
    for (const t of knownTopics()) {
      expect(out).toContain(t);
    }
  });

  it('treats an empty topic as a normal (answerable) miss', () => {
    expect(lookup('')).toContain('No knowledge-base entry for');
    expect(lookup('   ')).toContain('No knowledge-base entry for');
  });
});

describe('KB registry invariants', () => {
  it('topic keys are already normalized (lookup will never silently miss its own entries)', () => {
    for (const entry of KB) {
      expect(entry.topic).toBe(normalizeTopic(entry.topic));
    }
  });

  it('topic keys are unique (no shadowed entries)', () => {
    const topics = KB.map((e) => e.topic);
    expect(new Set(topics).size).toBe(topics.length);
  });

  it('knownTopics reflects the registry', () => {
    expect(knownTopics()).toEqual(KB.map((e) => e.topic));
    expect(knownTopics().length).toBeGreaterThan(0);
  });
});
