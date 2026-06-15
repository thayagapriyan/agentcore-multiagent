import { defineConfig } from 'vitest/config';

// Root Vitest config for the monorepo. Tests are deterministic and offline — they
// exercise the agents' pure routing/registry logic (no Bedrock calls), so they run
// on every PR with no AWS credentials. Each agent's tests live under its own
// `test/` folder and import that agent's TypeScript source directly (Vitest
// transpiles on the fly — no build step needed).
export default defineConfig({
  test: {
    include: ['agents/*/test/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    // Keep CI output focused; no coverage gate yet (kept minimal per project conventions).
    reporters: ['default'],
  },
});
