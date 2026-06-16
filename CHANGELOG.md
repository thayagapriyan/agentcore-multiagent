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

## [Iter 4] — 2026-06-09 — A2A on the supervisor (the public door)

- Added: `agents/supervisor/src/a2a.ts` — A2A server (Agent Card + JSON-RPC) via `@strands-agents/sdk/a2a/express`, opt-in behind `A2A_ENABLED`, on AgentCore's A2A port (`A2A_PORT`, default 9000) with the contract's `GET /ping` health check. Card skills derive from `ALL_SPECIALISTS`; a fresh-supervisor-per-request facade keeps concurrent A2A requests isolated; card URL precedence `AGENTCORE_RUNTIME_URL` → `A2A_PUBLIC_URL` → localhost.
- Added: `infra/supervisor-a2a.tf` — the **public A2A door**: a second AgentCore runtime from the **same image and role** with `server_protocol = "A2A"` and a Cognito JWT authorizer (user pool + `USER_PASSWORD_AUTH` app client + terraform-managed test user via `random_password`). Outputs: `a2a_endpoint_url`, client id, tester credentials (password sensitive). The original HTTP runtime is untouched — bearer-token A2A and SigV4 `/invocations` run side by side.
- Changed: `app.ts` starts the A2A listener when flagged (failure logged, never kills the invoke path); supervisor `package.json` + `@a2a-js/sdk` (Strands peer dep skipped by `legacy-peer-deps`); Dockerfile `EXPOSE 8080 9000`; `versions.tf` + `hashicorp/random`; `deploy.yml` + A2A smoke test (Cognito `initiate-auth` token → fetch agent card through the public endpoint); `variables.tf` + `supervisor_a2a_enabled`, `supervisor_a2a_public_url`.
- Context: A2A is the public door — only the top-most agent of each project exposes it. The reusable A2A wrapper is the SDK itself, so `packages/common` stays SDK-agnostic (iter-3 decision) — a deliberate deviation from the plan's "A2A server lands in common" wording, documented in the prompt log. A second runtime (vs flipping the existing one) because protocol + JWT authorizer change the invoke contract and would break SigV4 callers — additive-only.
- Tests: build/typecheck/tf fmt+validate clean. Local flag on: agent card on 9000 (`/ping` → Healthy), A2A `message/send` math → `42` (delegation → `math_specialist`), greeting → friendly hello; `/invocations` math → same `42`; empty prompt → 400. Flag off: 9000 refuses connections. ARM64 image builds; container (aarch64) serves both ports. `terraform plan` with the live image tag → **5 to add, 0 to change, 0 to destroy** (existing runtime untouched). Deployed + verified live: Cognito token minted, agent card via the public endpoint (card URL self-corrected — AgentCore injects `AGENTCORE_RUNTIME_URL`), `message/send` math → `42`, greeting → hello, a2d-ai tester confirmed by the user. Follow-up: `.github/workflows/get-a2a-token.yml` mints a 1-hour bearer token on demand (published encrypted — public repo).
- Prompt log: [docs/prompts/iter-4.md](docs/prompts/iter-4.md)
- Rollback: public door — `terraform destroy -target` the A2A runtime + Cognito pool (HTTP runtime unaffected); container flag — `supervisor_a2a_enabled=false` (default); code — revert the commit.
- Forward-compatibility: every future public agent repeats the thin `src/a2a.ts` + per-agent A2A-runtime pattern with its own card; internal sub-agents never get one.

## [Iter 4 follow-up] — 2026-06-13 — SigV4 A2A door (MuleSoft scanner discovery)

- Added: `infra/supervisor-a2a-sigv4.tf` — a **third** supervisor runtime from the **same image and role**, `server_protocol = "A2A"` but with **no authorizer**, so inbound auth is AgentCore's default **SigV4**. Outputs: `a2a_sigv4_runtime_arn`, `a2a_sigv4_endpoint_url`.
- Changed: `infra/variables.tf` — added `supervisor_a2a_sigv4_public_url` (manual Agent Card URL override; normally empty — AgentCore injects `AGENTCORE_RUNTIME_URL` and the card self-corrects, mirroring `supervisor_a2a_public_url`).
- Removed: stray `agent-card.json` scratch file (a card fetched from the JWT runtime during iter-4 testing — never belonged in the repo).
- Context: the **MuleSoft Agent Registry scanner** discovers agents by fetching the Agent Card with **SigV4-signed** requests (its IAM policy carries `bedrock-agentcore:InvokeAgentRuntime`). The iter-4 JWT runtime only accepts Cognito bearer tokens, so it rejects the scanner. AgentCore Runtime has no true public/no-auth mode — **SigV4 is the floor** — and SigV4 is exactly what the scanner's access keys can sign. So this door is SigV4-only; the JWT door (a2d-ai tester) and the HTTP `/invocations` door are both untouched. Three doors now run side by side off one image: HTTP/SigV4 `/invocations`, A2A/JWT, A2A/SigV4.
- Tests: `terraform fmt -check -recursive` clean; `terraform validate` → "Success! The configuration is valid." **Deployed via the pipeline (`deploy.yml` green); runtime `multiagent_supervisor_a2a_sigv4-ZEb4MdDBW2` `READY`.** Scanner discovery **confirmed**: after the SigV4 door went live, the MuleSoft Agent Registry scanner listed the supervisor (it could not before — the only A2A door was JWT-gated, which the scanner's SigV4/IAM credentials can't satisfy). SigV4 GET of `…/invocations/.well-known/agent-card.json` returns the card (`math_specialist`, `greeting_specialist`).
- Discovery findings (worth recording): (1) **listing vs. card-readability are separate layers** — the scanner *lists* every runtime its IAM policy allows (account-wide `bedrock-agentcore:ListAgentRuntimes`), independent of each runtime's inbound auth; SigV4 only governs whether it can *read the card / invoke*. So all four account runtimes appeared once the scanner had account-wide List, not because of this change. (2) The scanner catalogs **every immutable runtime version** as its own entry — the "~24 agents" observed = the 24 total versions across the four runtimes (supervisor 9 + agentcore_solution1 10 + a2a 4 + a2a_sigv4 1), not duplicates or a misconfiguration. To trim: scope the scanner's IAM to specific runtime ARNs and/or use a MuleSoft "latest-version only" setting.
- Rollback: `terraform destroy -target=aws_bedrockagentcore_agent_runtime.supervisor_a2a_sigv4` (the other two doors are unaffected); code — revert the commit.
- Forward-compatibility: any future public agent that must be scanner-discoverable repeats this thin SigV4-A2A-runtime pattern alongside its JWT door (now part of the standard new-agent template, starting iter 5's router); the two auth modes stay separate runtimes so neither contract can break the other.

---

## [Iter 5] — 2026-06-15 — Conditional `Graph` router (new agent)

- Added: `agents/router/` — a **second deployable**. A Strands `Graph` with **conditional edges**: an `intake` node classifies each request into one label, per-branch `EdgeHandler`s route to exactly one branch (`billing` / `tech` / `general`), and a `summarize` node composes the final reply. `branches.ts` (registry where `id` === classification label === graph node id === card skill, with a `general` fallback that keeps the graph total), `graph.ts` (`createRouterGraph` + `classifiedLabel(state)` reading intake's output off `MultiAgentState`, `maxSteps:10` loop guard), `agent.ts` (local model factory, `invokeRouter`, opt-in `LOG_DELEGATION` via Graph `BeforeNodeCallEvent`), `a2a.ts` (public A2A door; facade adapts the `Graph` output → `AgentResult` since the executor consumes an Agent result), `app.ts`, plus `package.json` / `tsconfig.json` / `Dockerfile` / `.dockerignore` / `.npmrc` (mirror the supervisor).
- Added: `infra/router.tf` (`module "router"` — own ECR + runtime + IAM role), `infra/router-a2a.tf` (router's public A2A/JWT door: its **own** Cognito pool/client/`router-a2a-tester` user + A2A-protocol runtime from the same image/role + endpoint/credential outputs). `docs/agents/router/ARCHITECTURE.md` (per-agent architecture doc).
- Changed: `infra/outputs.tf` — new per-agent **`runtime_arns` map** (`{ supervisor, router }`); flat `agent_runtime_arn` kept (marked legacy) + `router_*` outputs. `infra/variables.tf` — `router_agent_name` / `router_image_tag` / `router_a2a_enabled` / `router_a2a_public_url`. `infra/cicd.tf` — deploy-role IAM scope widened `multiagent-supervisor-*` → `multiagent-*` so it can manage the router's role (and every future agent's). `.github/workflows/deploy.yml` — ensure **both** ECR repos, build+push both images (same git sha), smoke tests via the `runtime_arns` map (supervisor math + router billing) and both A2A cards. `.github/workflows/ci.yml` — router typecheck. `CLAUDE.md` — repo-layout note (router added; ARCHITECTURE.md is per-agent). `agents/router/package.json` pins `@strands-agents/sdk` to **`1.4.0`**.
- Context: first iteration with >1 deployable, built on the new-agent template proven in iters 3–4 (thin `agents/<type>/` folder importing `common` + one `module` block + a `<type>-a2a.tf`). The supervisor is **byte-unchanged** — no existing-agent source files were touched. A fresh router install pulled SDK 1.5.0, whose A2A executor requires a snapshot-capable `Agent` via `agentFactory` (the plain-object Graph facade fails); pinning the router to 1.4.0 reuses the supervisor's proven facade with no extra model calls and no divergence (revisit when adopting ≥1.5.0 for both agents at once).
- Tests: `npm install` 0 vuln (both agents SDK 1.4.0); full build + router & **supervisor** `tsc --noEmit` exit 0; `terraform fmt -check -recursive` + `validate` clean. Local run (`A2A_ENABLED`/`LOG_DELEGATION`): `/ping` ok, billing→billing / tech→tech / general→general (verified in the routing log), empty→400; A2A card "Multi-Agent Router" (3 branch skills) + `message/send` billing → `completed` with the real graph answer as the artifact. ARM64 Docker build → container `aarch64`, both listeners boot, live tech invocation routed to `tech`, empty→400. Pending: deployed smoke tests (pipeline on merge).
- Prompt log: [docs/prompts/iter-5.md](docs/prompts/iter-5.md)
- Rollback: whole agent — `terraform destroy -target=module.router` + the A2A runtime & Cognito pool; A2A door only — destroy the `router_a2a` runtime + pool (HTTP runtime unaffected); container A2A — `router_a2a_enabled=false` (default); code — revert the commit (supervisor untouched).
- Forward-compatibility: `runtime_arns` map is the extension point (one key per future agent); the `multiagent-*` deploy-role scope means no future agent re-edits `cicd.tf`; the branch registry drives prompt/edges/card/logs like the supervisor's specialist registry. Iters 6 (critic) and 7 (MCP) repeat the same new-agent template.

---

## [Iter 6] — 2026-06-15 — Testing harness (Vitest unit tests + promptfoo evals)

- Added: a two-layer test harness. **(1) Vitest unit tests** — `vitest.config.ts` (root, globs `agents/*/test/**` + `packages/*/test/**`), `agents/router/test/routing.test.ts` (14 tests: `labelFromText` exact/case/trim/word-boundary/fallback + branch-registry invariants), `agents/supervisor/test/specialists.test.ts` (4 tests: specialist-registry invariants). Deterministic, offline, no AWS — the regression gate, run on every PR. **(2) promptfoo evals** — `eval/agentcore-provider.js` (custom provider → `aws bedrock-agentcore invoke-agent-runtime`, ARN from the `runtime_arns` map via `RUNTIME_ARNS`), `agents/router/eval/promptfooconfig.yaml` (6 cases: billing/tech/general/ambiguous, Bedrock `llm-rubric`), `agents/supervisor/eval/promptfooconfig.yaml` (3 cases: math via `contains`, greeting via `llm-rubric`). Run post-deploy against live runtimes.
- Changed: `agents/router/src/graph.ts` — extracted pure `labelFromText(raw)`; `classifiedLabel(state)` delegates to it (behavior-preserving, makes routing unit-testable without faking `MultiAgentState`). `package.json` — `test`/`test:watch` scripts + `vitest ^2.1.9`. `.github/workflows/ci.yml` — `npm test` step (every PR). `.github/workflows/deploy.yml` — Node 22 setup + post-deploy promptfoo eval step for both agents. `docs/iteration-plan.md` — inserted iter 6 (testing); the critic-loop agent shifts to iter 7, second-agent-over-MCP to iter 8.
- Optional cloud sharing: the post-deploy eval step publishes each run to a promptfoo cloud account and prints a shareable results URL **iff** the `PROMPTFOO_API_KEY` repo secret is set (`promptfoo auth login --api-key` then `promptfoo share`). Unset = evals still run and still gate the deploy (offline pass/fail); only the share is skipped. `share` failure is non-fatal. (promptfoo's UI calls this an "API token"; the CLI flag is `--api-key` — same value.)
- Context: own iteration (one concern), purely additive — **no agent behavior changes**, no infra change. Enforces the project's always-green rule automatically: deterministic routing contracts are gated on every PR (cheap, no creds), LLM quality is graded post-deploy against live runtimes (needs creds + cost). A future iteration that breaks an agent's routing via shared-code changes turns that agent's Vitest suite red on the PR.
- Decisions worth noting: **Vitest 2 (not 4)** — v4's native rolldown binary has no win32-arm64 build (won't run on the dev machine); v2 runs everywhere (18 tests green). v2's only cost is a transitive esbuild **dev-server** audit advisory — accepted (we never run a dev server; vitest is a devDependency pruned from images). **Custom CLI-based provider** (not http/SDK) — AgentCore's data plane needs SigV4, which the CLI already does and the deploy job already has. **Bedrock grader** (`bedrock:global.anthropic.claude-haiku-4-5-...`) — no OpenAI key; the summarize node hides the routing label so output is graded topically.
- Tests: `npm test` → **18 passed** (router 14, supervisor 4), no AWS. router/supervisor `tsc --noEmit` exit 0 (refactor preserved behavior). `terraform fmt -check` clean. promptfoo against **live runtimes**: router **6/6 (100%)**, supervisor **3/3 (100%)** — including via `-c` from `infra/` cwd as CI runs it. Pending: CI unit-test job + post-deploy eval job green on the pipeline.
- Prompt log: [docs/prompts/iter-6.md](docs/prompts/iter-6.md)
- Rollback: delete `vitest.config.ts`, `agents/*/test/`, `agents/*/eval/`, `eval/`, the test scripts + vitest dep, the `Unit tests` CI step, and the eval step in deploy.yml. No agent behavior depends on any of it; the `labelFromText` extraction is behavior-preserving.
- Forward-compatibility: every future agent adds `test/*.test.ts` (auto-globbed) + an `eval/promptfooconfig.yaml` (one line in the deploy eval step); the shared provider + `runtime_arns` map are unchanged. `labelFromText` is the tested routing seam — keep it pure.

---

## [Iter 7] — 2026-06-15 — Critic / reflection loop (new agent)

- Added: `agents/critic/` — a **third deployable**. A generator↔critic **reflection loop**: a generator agent drafts an answer, a critic agent reviews it, and the loop feeds the critique into the next draft until the critic approves **or** a `MAX_ITERATIONS` cap (default 3) is hit. `critic-loop.ts` (pure `parseVerdict(raw)` → `{approved, feedback}` with an ambiguous-verdict-fails-safe rule; pure SDK-agnostic `reflect(prompt, generate, critique, config)` that owns termination + feedback-threading + best-effort return; `runCriticLoop` wires `reflect` to the real generator/critic `Agent`s), `agent.ts` (local model factory, `MAX_ITERATIONS` knob, opt-in `LOG_DELEGATION` per-round logging, `invokeCritic`), `a2a.ts` (public A2A door; facade adapts the loop's string → `AgentResult`), `app.ts`, plus `package.json` / `tsconfig.json` / `Dockerfile` / `.dockerignore` / `.npmrc` (mirror the router).
- Added: `infra/critic.tf` (`module "critic"` — own ECR + runtime + IAM role), `infra/critic-a2a.tf` (critic's public A2A/JWT door: its **own** Cognito pool/client/`critic-a2a-tester` user + A2A-protocol runtime from the same image/role + endpoint/credential outputs). `agents/critic/test/critic-loop.test.ts` (16 Vitest cases: `parseVerdict` + loop-termination invariants, no Bedrock), `agents/critic/eval/promptfooconfig.yaml` (3 post-deploy quality cases). `docs/agents/critic/ARCHITECTURE.md` (per-agent architecture doc). `.claude/commands/{iter-start,iter-end}.md` (ported from the sibling, adapted to this repo).
- Changed: `infra/outputs.tf` — `runtime_arns` map gains a `critic` key; new `critic_*` outputs. `infra/variables.tf` — `critic_agent_name` / `critic_image_tag` / `critic_a2a_enabled` / `critic_a2a_public_url`. `.github/workflows/ci.yml` — critic typecheck (`npm test` auto-globs the new suite). `.github/workflows/deploy.yml` — ensure the critic ECR repo, build+push the critic image (same git sha), smoke test (HTTP billing-free "tagline" prompt + A2A card), critic added to the post-deploy eval loop. `docs/iteration-plan.md` — testing harness documented as iter 6, critic = iter 7, MCP = iter 8 (map table + sections + checklist made consistent).
- Context: third multi-agent pattern, built on the new-agent template proven in iters 3–5 (thin `agents/<type>/` folder importing `common` + one `module` block + a `<type>-a2a.tf`). The supervisor and router are **byte-unchanged**. The reflection loop is an **explicit code loop**, not a cyclic Strands `Graph` back-edge: the SDK snapshots/restores graph nodes (stateless across executions) under AND-semantics, so a revisited node wouldn't accumulate the prior draft + critique — a code loop threads that state directly and makes termination a **pure, unit-testable** function rather than a `maxSteps` side effect (the plan allowed "a `Graph` with a back-edge **or** `Swarm`"). No shared-infra files changed: the deploy role is already scoped `multiagent-*`.
- Tests: `npm test` → **34 passed** (supervisor 4, router 14, **critic 16**), no AWS. critic/supervisor/router `tsc --noEmit` exit 0. `terraform fmt -check -recursive` + `validate` clean. Local run (`MAX_ITERATIONS=2`, `LOG_DELEGATION`): `/ping` ok; "tagline" → `round 1 APPROVED`; a harder accurate-AND-simple prompt → **2 rounds** (REVISE → APPROVED, live multi-round refinement); empty → 400; cap-termination proven deterministically by the Vitest suite (rounds never exceed the cap even when the critic always REVISEs). A2A card "Multi-Agent Critic" (`refine` skill) + `message/send` → `completed` with the loop answer as the artifact. The new tests **caught a real bug**: same-line critic feedback (`REVISE: be specific`) was being dropped — fixed. Pending: ARM64 Docker build + deployed smoke tests + post-deploy eval (pipeline on merge).
- Prompt log: [docs/prompts/iter-7.md](docs/prompts/iter-7.md)
- Rollback: whole agent — `terraform destroy -target=module.critic` + the A2A runtime & Cognito pool; A2A door only — destroy the `critic_a2a` runtime + pool (HTTP runtime unaffected); container A2A — `critic_a2a_enabled=false` (default); code — revert the commit (supervisor + router untouched).
- Forward-compatibility: `runtime_arns` gains one key per agent (the established extension point); `parseVerdict`/`reflect` are the tested control-flow seams — keep them pure so the loop stays unit-testable; `MAX_ITERATIONS` is an env knob (raise without code change). Iter 8 (second agent over MCP) repeats the same new-agent template.
- Follow-up (same iteration): wired the critic into `.github/workflows/get-a2a-token.yml` — added `critic` to the agent picker and a `case` branch resolving its `critic_*` A2A outputs, so the encrypted-token workflow mints a bearer token for the critic's public door like it does for supervisor/router. (Missed in the initial commit; the `if/else` agent resolver was generalized to a `case` so future prefixed agents add one word in two places.)

---

> **Convention**: append new entries at the **bottom** of the iteration list. Never edit a past entry — add a follow-up entry instead. Past commits stay immutable; the changelog reflects that.
