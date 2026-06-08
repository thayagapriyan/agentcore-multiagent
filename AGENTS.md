# AGENTS.md

This file exists so any AI coding tool (Claude Code, Cursor, Aider, Copilot, etc.) discovers project guidance via the emerging `AGENTS.md` convention.

**The canonical guide is [CLAUDE.md](CLAUDE.md) — read that first.**

It covers:
- Mission: a multi-agent monorepo POC on Bedrock AgentCore (several deployables, shared infra, one pipeline)
- Tech stack (locked: Node 20 / TypeScript / Strands incl. `Graph`/`Swarm`/`a2a` / Terraform / AgentCore)
- Iteration model (Design → Develop → Test → Deploy → Rollback; additive, forward-compatible, always-green, reversible)
- Tracking convention (CHANGELOG.md + docs/prompts/iter-N.md + structured commits)
- Conventions (ESM-first, ARM64, orchestration in code not YAML, no ESLint yet, ask before destructive ops)
- Repository layout (monorepo: `packages/common`, `agents/*`, shared `infra/`)

Sibling reference project: [agentcore-solution1](../agentcore-solution1) — the single-agent baseline this builds on.

If you're a tool that only reads `AGENTS.md` and not `CLAUDE.md`, treat the contents of `CLAUDE.md` as your guidance.
