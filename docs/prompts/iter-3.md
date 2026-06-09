# Iter 3 — Extract `packages/common` + per-agent Terraform module

**Date**: 2026-06-09
**Branch**: `feat/iter-3-extract-common-tf-module`
**Iteration plan reference**: [docs/iteration-plan.md § Iteration 3](../iteration-plan.md)

---

## Goal

Factor the shared agent runtime code into a `packages/common` npm workspace and turn `infra/` into a reusable per-agent Terraform module, so every later agent is a thin folder + one module block — **without changing the supervisor's behavior or its live AWS resources** (state migrates via `moved {}` blocks, no destroy/recreate).

---

## Prompts used

1. **Prompt**: `/iter-start 3`
   **Why**: scaffold the iteration after restructuring the plan to the one-agent-per-folder model.

---

## Decisions made

- **Decision**: `packages/common` is **SDK-agnostic** — it only depends on `express` and exposes a framework-neutral `createServer/startServer` that takes an `invoke(prompt) => Promise<string>` callback. The Strands model factory stays in each agent.
  **Alternatives considered**: putting the Bedrock model factory + Strands `Agent` types in `common` (so `common` owns the whole runtime).
  **Why**: moving the Strands SDK import into `common` forced the SDK to resolve at the workspace root, away from its 18 peer deps, causing an ESM `ERR_MODULE_NOT_FOUND` cascade (zod, @modelcontextprotocol/sdk, …). Keeping the SDK in the agent avoids dragging its heavy peer set into every consumer and keeps `common` light + reusable. `common` still owns the bulkiest shared boilerplate (the `/ping`+`/invocations` contract).

- **Decision**: `.npmrc` `install-strategy=nested` for the workspace.
  **Alternatives considered**: default hoisting; pinning every Strands peer version to force co-hoisting.
  **Why**: npm's default hoisting split the Strands SDK (hoisted to root) from peers that stayed nested, breaking runtime ESM resolution. `nested` keeps each workspace's tree under its own `node_modules` — the SDK resolves its peers locally, mirroring the pre-workspace layout that worked, and makes each agent's Docker image self-contained.

- **Decision**: Terraform `infra/modules/agent/` module + `moved {}` blocks; resource bodies copied byte-for-byte from the old root stack.
  **Alternatives considered**: a cleaner module that accepts a one-time destroy/recreate of the live runtime.
  **Why**: the iteration's promise is zero resource changes. `moved {}` migrates state addresses with no destroy/recreate — proven by `terraform plan` showing `0 to add, 0 to change, 0 to destroy`.

- **Decision**: Docker build context moved to the **repo root** (`-f agents/supervisor/Dockerfile .`); a root `.dockerignore` added.
  **Why**: the image must see `packages/common`, which lives outside the supervisor folder. Runtime stage copies each workspace's `node_modules` + `dist` (required under nested install).

- **Decision**: Deploy workflow's "pre-create ECR" step changed from a **targeted `terraform apply`** to an idempotent `aws ecr describe || create` (repo name read non-interactively from `var.agent_name`'s default in `variables.tf` via `sed` — `terraform console` is an interactive REPL that hangs in CI), leaving a **single full `terraform apply`** to run the `moved {}` blocks.
  **Alternatives considered**: listing all old+new moved addresses in `-target` for this one migration deploy.
  **Why**: Terraform refuses a partial (`-target`) apply while `moved {}` blocks are pending ("Moved resource instances excluded by targeting"). Decoupling ECR existence from a targeted apply permanently removes the cold-start/move collision and is more robust.

---

## Files created / modified

| File | Action | Notes |
|------|--------|-------|
| `package.json` (root) | added | npm workspaces (`packages/*`, `agents/*`) |
| `.npmrc` | modified | add `install-strategy=nested` |
| `.dockerignore` (root) | added | for the root-context monorepo build |
| `packages/common/{package.json,tsconfig.json,src/server.ts,src/index.ts}` | added | SDK-agnostic Express `/ping`+`/invocations` wrapper |
| `agents/supervisor/package.json` | modified | depend on `@multiagent/common` |
| `agents/supervisor/src/app.ts` | modified | use shared `startServer({ invoke, onListen })` |
| `agents/supervisor/src/agent.ts` | modified | add `invokeSupervisor()`; model factory stays local |
| `agents/supervisor/Dockerfile` | modified | monorepo workspace build; copy each workspace's node_modules + dist |
| `infra/modules/agent/{main,variables,outputs}.tf` | added | reusable ECR + runtime + IAM module |
| `infra/supervisor.tf` | added | `module "supervisor"` call + 7 `moved {}` blocks |
| `infra/ecr.tf`, `infra/runtime.tf` | deleted | resources moved into the module |
| `infra/iam.tf` | modified | now only the shared `aws_caller_identity` data source |
| `infra/outputs.tf` | modified | source values from `module.supervisor` |
| `.github/workflows/{ci,deploy}.yml` | modified | root workspace install/build; root-context Docker build; module-addressed `-target` |

---

## Tests

Per the iteration plan's Test phase. Record actual results, not expected.

- [x] `npm install` (workspaces resolve) → 478 packages, 0 vulnerabilities; `@multiagent/common` symlinked at root `node_modules/@multiagent/common`.
- [x] `tsc --noEmit` for supervisor → **exit 0**. `npm run build --workspace @multiagent/common` → OK (emits `index.d.ts`).
- [x] `terraform fmt -check` clean; `terraform validate` → Success; `terraform plan` (with live image tag) → **`Plan: 0 to add, 0 to change, 0 to destroy`**, all 7 resources only `has moved to module.supervisor.*` (non-destructive proof).
- [x] Local ARM64 Docker build (`-f agents/supervisor/Dockerfile .`) → image built; `docker run` → boots, logs `2 specialists loaded`, `/ping` → `{"status":"ok"}`, empty prompt → `400`, `docker inspect` arch = `arm64`.
- [x] After deploy, re-invoke live runtime → Deploy workflow green: single full `terraform apply` ran the 7 `moved {}` migrations (no recreate, same runtime ARN), and the workflow smoke test (`invoke-agent-runtime` with `add 2 and 3`) returned a `result` field.

---

## Forward-compatibility check

- After this, a new agent = a new `agents/<type>/` folder importing `common` + a new `module "<type>"` block. This is the spine iter 4+ relies on. The A2A server lands in `packages/common` in iter 4.
- **Per-agent outputs (ARNs etc.):** today there is one module, so the flat top-level `agent_runtime_arn` output is fine. When agent #2 arrives (iter 5), a flat output collides. **Decision (made in iter 3, implemented in iter 5):** expose a single **map output keyed by agent name** — e.g. `runtime_arns = { supervisor = "arn:…", router = "arn:…" }` — and have the deploy workflow look up its agent's ARN via `terraform output -json runtime_arns | jq -r .<agent>`. Pairs naturally with a future `for_each` over an agents map. The ECR repo name is already derived per-agent from `var.agent_name` (deploy reads it from `variables.tf` via `sed`), so it scales the same way.

---

## Open questions / follow-ups

- [x] Deployed: `terraform apply` reported the `moved` migrations (no recreate, same runtime ARN) and the live-runtime smoke test passed.
- [ ] The supervisor's per-folder `agents/supervisor/.npmrc` now triggers a harmless "ignoring workspace config" warning under workspaces. Redundant with the root `.npmrc`; could be removed in a later cleanup.
- [ ] `install-strategy=nested` trades disk/image size for resolution correctness. Revisit if a future agent's image size becomes a concern.

---

## Rollback

- Revert the refactor commit; `moved {}` blocks are reversible. The live runtime is never torn down, so rollback is code-only.
