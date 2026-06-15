import { describe, it, expect } from 'vitest';
import {
  ALL_SPECIALISTS,
  mathSpecialist,
  greetingSpecialist,
} from '../src/specialists.js';

// Deterministic registry tests for the supervisor (no Bedrock). The supervisor
// routes via the model (agent-as-tool), so there's no pure routing function to
// test like the router's labelFromText; the deterministic surface is the
// specialist registry, whose names/descriptions drive the tool defs and the A2A
// agent card. These guard the contract those depend on.

describe('specialist registry invariants', () => {
  it('every specialist name is unique (names double as tool ids)', () => {
    const names = ALL_SPECIALISTS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('the two expected specialists are present', () => {
    expect(ALL_SPECIALISTS).toContain(mathSpecialist);
    expect(ALL_SPECIALISTS).toContain(greetingSpecialist);
  });

  it('every specialist has a non-empty description (used in tool def + card skill)', () => {
    for (const s of ALL_SPECIALISTS) {
      expect(s.description.trim().length).toBeGreaterThan(0);
    }
  });

  it('every specialist exposes a build() factory', () => {
    for (const s of ALL_SPECIALISTS) {
      expect(typeof s.build).toBe('function');
    }
  });
});
