# Changelog

Human-readable history of changes to this project, organized by iteration. See [docs/iteration-plan.md](docs/iteration-plan.md) for the roadmap and [docs/prompts/](docs/prompts/) for the prompts and decisions behind each iteration.

Format:
```
## [Iter N] — YYYY-MM-DD — <title>
- Added / Changed / Removed: <files or features>
- Tests: <what was verified>
- Prompt log: docs/prompts/iter-N.md
- Rollback: <how to undo>
```

---

## [Iter 0] — 2026-06-08 — Repo foundation

- Added: `CLAUDE.md` (multi-agent monorepo project guide), `AGENTS.md` (tool-agnostic pointer), `.gitignore`, `.editorconfig`, `.npmrc`, `.nvmrc`, `.claude/settings.json` (shared permissions carried over from the sibling project), this `CHANGELOG.md`.
- Context: new monorepo for a multi-agent POC on Bedrock AgentCore — several deployable agents, shared infra, one CI/CD pipeline. Builds on the single-agent reference [agentcore-solution1](../agentcore-solution1).
- Tests: N/A (foundation files only — no code yet).
- Rollback: delete the added files.

---

> **Convention**: append new entries at the **bottom** of the iteration list. Never edit a past entry — add a follow-up entry instead. Past commits stay immutable; the changelog reflects that.
