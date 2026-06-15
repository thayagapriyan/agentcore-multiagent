# Iter 6 — Testing harness (Vitest unit tests + promptfoo evals)

**Date**: 2026-06-15
**Branch**: `feat/iter-6-testing-harness`
**Iteration plan reference**: [docs/iteration-plan.md § Iteration 6](../iteration-plan.md)

---

## Goal

Add an automated test layer that enforces the "always green / never break a prior
iteration" rule: **deterministic Vitest unit tests** for the agents' routing/registry
logic (run on every PR, no AWS) plus **promptfoo evals** that grade
classification/delegation quality against the live runtimes (run post-deploy). No
agent behavior changes — this iteration only adds tests around the existing agents.

---

## Prompts used

1. **Prompt**: `how to verify it hit correct agent ? and also explain how to write test
   case ? do you know promptfoo and explain if we need to use promptfoo how can we do
   it because on every iteration we should not break existing changes`
   **Why**: the user wanted (a) how to prove routing, (b) how to write tests, (c)
   whether/how to use promptfoo given the additive, always-green rule. Claude explained
   the two test layers (deterministic routing = unit test; classification quality =
   eval) and proposed promptfoo as the per-agent regression suite.

2. **Decision prompts** (via AskUserQuestion): test approach = **layered (unit +
   promptfoo)**; own iteration = **yes, iter 6** (critic shifts to iter 7); unit runner
   = **Vitest**; eval timing = **post-deploy in deploy.yml**.

---

## Decisions made

- **Decision**: testing is its **own iteration** (iter 6), not folded into iter 5.
  **Why**: one-concern-per-iteration. iter 5's agent is built/deployed; adding a test
  harness is a distinct concern. The previously-planned critic-loop agent shifts from
  iter 6 to **iter 7** (and MCP to iter 8).

- **Decision**: two test layers, deliberately separated by where they run.
  - **Unit (Vitest)** — deterministic routing/registry logic, **no Bedrock**, runs on
    every PR in `ci.yml`. This is the regression gate.
  - **Eval (promptfoo)** — LLM classification/delegation quality, calls Bedrock against
    **live runtimes**, runs **post-deploy** in `deploy.yml`.
  **Why**: PR CI has no AWS creds and must stay fast/free; evals need creds + a live
  runtime and cost model calls. Splitting keeps the PR gate cheap while still getting
  end-to-end quality coverage on every deploy.

- **Decision**: extract a pure `labelFromText(raw): string` from `classifiedLabel` in
  the router's `graph.ts`; `classifiedLabel(state)` now delegates to it.
  **Alternatives considered**: constructing a fake `MultiAgentState` in tests.
  **Why**: the routing decision is pure (string → label), but it was coupled to
  `MultiAgentState`. Extracting the pure function makes the routing contract directly
  unit-testable without faking SDK state. **Behavior-preserving** — same lowercase +
  exact + word-boundary + fallback logic; verified router still builds + typechecks and
  the live eval still routes correctly.

- **Decision**: pin **Vitest 2** (`^2.1.9`), not Vitest 4.
  **Alternatives considered**: Vitest 4 (clean `npm audit`); Node's built-in
  `node:test` (zero deps).
  **Why**: Vitest 4 uses a native `rolldown` binary with **no win32-arm64 build**, so it
  fails to run on the dev machine (local tests are the fast feedback loop — that's
  unacceptable). Vitest 2 runs on win32-arm64 **and** CI (ubuntu x64); all 18 tests
  pass. Its only downside is a transitive `npm audit` advisory (esbuild dev-server,
  GHSA-67mh-4wv8-2f99) — **accepted**: we never run a dev server (`vitest run` is
  one-shot), and Vitest is a root devDependency pruned from every shipped image
  (`npm prune --omit=dev`). Revisit when a win32-arm64 rolldown build exists.

- **Decision**: a **custom promptfoo provider** (`eval/agentcore-provider.js`) that
  shells out to `aws bedrock-agentcore invoke-agent-runtime`, rather than promptfoo's
  `http` provider or a new AWS SDK dependency.
  **Alternatives considered**: `http` provider (can't SigV4-sign AgentCore's data
  plane); `@aws-sdk/client-bedrock-agentcore` (a new dep not in the tree).
  **Why**: AgentCore's data plane requires SigV4; the CLI already does that and is
  present in the deploy job (it's exactly what the smoke test uses). Shelling out keeps
  the eval harness dependency-light (only promptfoo, via `npx`). The provider selects
  each agent's ARN from the `runtime_arns` map via the `RUNTIME_ARNS` env var.

- **Decision**: grade with `llm-rubric` for routing/tone, `contains` for the
  deterministic math answers; grader runs through **Bedrock** (`bedrock:global.anthropic
  .claude-haiku-4-5-...`), not OpenAI.
  **Why**: the summarize node deliberately hides the routing label, so output can only be
  judged topically (is this a billing answer?) — that's what `llm-rubric` does. Using the
  Bedrock grader avoids needing an OpenAI key. The grader id format is
  `bedrock:<full-model-id>` with the same `global.` inference profile the agents use
  (Haiku 4.5 is profile-only; the wrong id gives "model identifier is invalid").

---

## Files created / modified

| File | Action | Notes |
|------|--------|-------|
| `vitest.config.ts` | added | root Vitest config; globs `agents/*/test/**` + `packages/*/test/**`; offline, deterministic. |
| `package.json` | modified | + `test`/`test:watch` scripts, `vitest ^2.1.9` devDependency. |
| `agents/router/test/routing.test.ts` | added | 14 tests: `labelFromText` (exact/case/trim/word-boundary/fallback/no-substring-match) + branch-registry invariants. |
| `agents/supervisor/test/specialists.test.ts` | added | 4 tests: specialist-registry invariants (unique names, descriptions, build factory). |
| `agents/router/src/graph.ts` | modified | extracted pure `labelFromText`; `classifiedLabel` delegates to it (behavior-preserving). |
| `eval/agentcore-provider.js` | added | custom promptfoo provider → `aws bedrock-agentcore invoke-agent-runtime`, ARN from `RUNTIME_ARNS`. |
| `agents/router/eval/promptfooconfig.yaml` | added | 6 cases (billing×2, tech×2, general, ambiguous) graded by Bedrock llm-rubric. |
| `agents/supervisor/eval/promptfooconfig.yaml` | added | 3 cases (math×2 via `contains`, greeting via llm-rubric). |
| `.github/workflows/ci.yml` | modified | + `npm test` step (every PR, no AWS). |
| `.github/workflows/deploy.yml` | modified | + Node 22 setup + post-deploy promptfoo eval step for both agents (live runtimes). |
| `package-lock.json` | modified | vitest. |
| `docs/prompts/iter-6.md` | added | this file. |
| `CHANGELOG.md` | modified | iter-6 entry. |
| `docs/iteration-plan.md` | modified | insert iter 6 (testing); critic → iter 7, MCP → iter 8. |

---

## Tests

Actual results (Node 20.16 local; live Bedrock via local AWS creds):

- [x] `npm test` → **18 passed** (router 14, supervisor 4), ~0.5s, no AWS
- [x] `npm audit` with Vitest 2 → 4 advisories, all the esbuild dev-server transitive
  (accepted, dev-only, pruned from images); with Vitest 4 → 0 but native binary won't
  run on win32-arm64 (rejected)
- [x] router/supervisor `tsc --noEmit` → exit 0 (refactor behavior-preserving)
- [x] `terraform fmt -check -recursive` → exit 0 (no infra change this iter)
- [x] promptfoo **router** eval against live runtime → **6/6 pass (100%)** — billing,
  tech, general, and ambiguous prompts all return correctly-routed answers
- [x] promptfoo **supervisor** eval against live runtime → **3/3 pass (100%)** — math 42 /
  72, greeting friendly
- [x] promptfoo via `-c ../agents/<agent>/eval/...` from `infra/` cwd (mimics CI) → passes
  (provider `file://` paths resolve relative to the config, not cwd)
- [x] `ci.yml` / `deploy.yml` parse; step order verified (setup-terraform restored after
  an edit dropped it; caught by IDE YAML diagnostic)
- [ ] CI unit-test job + post-deploy eval job green on the pipeline — pending push/merge

---

## Forward-compatibility check

- Every future agent adds `agents/<type>/test/*.test.ts` (picked up by the root glob) and
  `agents/<type>/eval/promptfooconfig.yaml` (add one line to the deploy eval step). The
  shared provider + `runtime_arns` map need no change.
- Unit tests are the cross-iteration regression net: if iter 7+ changes
  `packages/common` or the model factory and breaks an agent's routing contract, that
  agent's Vitest suite goes red on the PR — automated enforcement of "always green."
- `labelFromText` is the public, tested seam for routing — keep it pure (no SDK state) so
  it stays unit-testable.

---

## Open questions / follow-ups

- [ ] Move to Vitest 4 (clean audit) once a win32-arm64 rolldown binary ships, or switch
  to `node:test` if the audit noise becomes a problem.
- [ ] Pin a promptfoo version in the deploy step (currently `@latest` via npx) once a
  version is chosen, for reproducible eval runs. Note promptfoo needs Node ≥20.20/≥22.
- [ ] Expand eval datasets (more billing/tech/general variants; adversarial/ambiguous
  prompts) and consider a pass-rate threshold rather than all-must-pass.
- [ ] A `packages/common` unit test (the glob already covers `packages/*/test/**`).

---

## Rollback

- Remove the test layer: delete `vitest.config.ts`, `agents/*/test/`, `agents/*/eval/`,
  `eval/`, the `test` scripts + vitest dep in `package.json`, the `Unit tests` step in
  `ci.yml`, and the Node-setup + eval step in `deploy.yml`. No agent behavior depends on
  any of it.
- The `labelFromText` extraction is behavior-preserving; reverting it (inlining back into
  `classifiedLabel`) is safe but unnecessary.
