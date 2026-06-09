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

## [Iter 2] — 2026-06-09 — Deploy the supervisor

- Changed: `.github/workflows/deploy.yml` — pre-create the ECR repo via a targeted `terraform apply` before the image build/push, and source the repo URL from `terraform output` instead of the `ECR_REPOSITORY` Actions variable. Fixes a cold-start failure (push-before-apply ordering) and a repo name mismatch.
- Added: `docs/prompts/_template.md` (ported from sibling), `docs/prompts/iter-2.md` (prompt log); minor `docs/IDEA.md` link.
- Context: the iter-2 infra/CICD (`infra/*.tf` + all three workflows) was already authored in the scaffold commit `86ffeb2`; the iteration's work was making the pipeline deploy successfully end-to-end.
- Tests:
  - Bootstrap workflow → deploy role `multiagent-supervisor-github-deploy` created, `AWS_ROLE_ARN` set.
  - Deploy workflow (after fix) → ECR pre-created, ARM64 image pushed, `terraform apply` created runtime `multiagent_supervisor-vlCRzx7D5I`, smoke test passed.
  - Live `invoke-agent-runtime`: `"17 plus 25?"` → `42`; `"8 times 9?"` → `72`; greeting prompts → friendly hello. Delegation to math/greeting specialists verified in production (200s).
- Prompt log: [docs/prompts/iter-2.md](docs/prompts/iter-2.md)
- Rollback: `terraform destroy -target=aws_bedrockagentcore_agent_runtime.supervisor`; revert image tag; disable workflows in GitHub.
- Forward-compatibility: resources prefixed `multiagent-supervisor-*` so iter-5's second deployable adds its own without collision.

---

## [Iter 3] — 2026-06-09 — Extract `packages/common` + per-agent Terraform module

- Added: npm workspaces root (`package.json`), `@multiagent/common` (SDK-agnostic Express `/ping`+`/invocations` wrapper), `infra/modules/agent/` (reusable ECR + runtime + IAM), `infra/supervisor.tf` (`module "supervisor"` + 7 `moved {}` blocks), root `.dockerignore`.
- Changed: supervisor consumes `common` via an `invoke(prompt)` callback (model factory stays local); monorepo Dockerfile (root build context, per-workspace `node_modules`); `.npmrc` `install-strategy=nested`; CI/deploy workflows (root install/build, root-context Docker build, module-addressed `-target`).
- Removed: `infra/ecr.tf`, `infra/runtime.tf` (resources moved into the module, not destroyed).
- Context: enabling refactor so a new agent = a thin `agents/<type>/` folder + one `module` block. SDK-agnostic `common` avoids dragging the Strands SDK's 18 peer deps into every consumer; `install-strategy=nested` fixes the SDK/peer hoisting split.
- Tests:
  - Workspaces install (478 pkgs, 0 vuln), supervisor `tsc --noEmit` → exit 0, `common` builds.
  - `terraform plan` (live image tag) → **`0 to add, 0 to change, 0 to destroy`**, all 7 resources only `has moved to module.supervisor.*` (non-destructive proof).
  - Local ARM64 Docker build → container boots (`2 specialists loaded`), `/ping` → `{"status":"ok"}`, empty prompt → `400`, arch `arm64`.
  - Pending: live re-invoke after deploy (routine push).
- Prompt log: [docs/prompts/iter-3.md](docs/prompts/iter-3.md)
- Rollback: revert the refactor commit; `moved {}` blocks are reversible and the live runtime is never torn down (code-only rollback).
- Forward-compatibility: a new agent now = a new `agents/<type>/` folder importing `common` + a new `module "<type>"` block; the A2A server lands in `common` in iter 4.

---

> **Convention**: append new entries at the **bottom** of the iteration list. Never edit a past entry — add a follow-up entry instead. Past commits stay immutable; the changelog reflects that.
