# Iter 7 — Critic / reflection loop (new agent)

**Date**: 2026-06-15
**Branch**: `feat/iter-7-critic-loop`
**Iteration plan reference**: [docs/iteration-plan.md § Iteration 7](../iteration-plan.md)

---

## Goal

A **new** deployable agent — `agents/critic/` — that does iterative refinement: a
**generator** produces a draft answer, a **critic** reviews it, and the loop revises
until the critic approves or a max-iterations cap is hit. A2A on its top agent. The
supervisor and router are byte-unchanged.

---

## Prompts used

1. **Prompt**: `run /iter-end`
   **Why**: close out iter 6 (testing harness). The `/iter-end` skill wasn't installed;
   ran its steps manually against the sibling spec — iter 6 was already fully committed
   on `main` (prompt log + CHANGELOG + commits complete), nothing to finalize.

2. **Prompt**: `1. yes add harness step in iteration as 7 iter. 2. add those commands
   from sibling projects 3. start new agent critic / reflection loop`
   **Why**: three asks — (1) make the iteration plan numbering consistent now that the
   testing harness is its own iteration (clarified via AskUserQuestion: critic = iter 7,
   MCP = iter 8); (2) port `/iter-start` + `/iter-end` into this repo's
   `.claude/commands/`; (3) build the critic agent as iter 7.

---

## Decisions made

- **Decision**: the reflection loop is an **explicit code-orchestrated loop**
  (`for` over generate → critique → revise), not a cyclic Strands `Graph` with a
  back-edge.
  **Alternatives considered**: a `Graph` with a `critique → generate` back-edge gated by
  an "approved?" edge handler (the literal reading of the plan); a `Swarm` with handoffs.
  **Why**: the SDK's `Graph` uses AND-semantics and **snapshot/restore (stateless) agent
  nodes** — a revisited node doesn't accumulate the prior draft + critique, so a true
  refinement loop has to thread that state through the prompt anyway. A plain code loop
  does exactly that cleanly, makes the **termination condition pure and unit-testable**
  (mirrors the router's `labelFromText` seam), and the iteration plan explicitly allows
  "a `Graph` with a back-edge **(or `Swarm`)**" — i.e. the primitive is open. `maxSteps`
  on a Graph would still be the only loop guard; here the `for`-cap is that guard,
  in plain sight.

- **Decision**: the critic emits a structured verdict the loop parses with a pure
  `parseVerdict(raw)` → `{ approved: boolean; feedback: string }`. Approval is detected
  by a leading `APPROVED` / `REVISE` token (case-insensitive, word-boundary), defaulting
  to "revise" when ambiguous so the loop never approves slop by accident.
  **Why**: same testability seam as the router — the loop's control flow is a pure string
  function, gradeable with Vitest and no Bedrock.

- **Decision**: cap iterations via `MAX_ITERATIONS` env (default 3), and **always return
  the latest draft** even if never approved (best-effort), tagged in logs.
  **Why**: always-green — `/invocations` must return a valid answer even when the critic
  never fully approves. The cap guarantees termination (no infinite loop), the plan's
  explicit test requirement.

- **Decision**: reuse the proven new-agent template verbatim — thin `agents/critic/`
  importing `@multiagent/common`, one `module "critic"` block, a `critic-a2a.tf` JWT door
  with its own Cognito pool, SDK pinned to **1.4.0** (matches supervisor + router).
  **Why**: additive, forward-compatible, and the `cicd.tf` deploy role is already scoped
  `multiagent-*`, so no shared-infra file changes — the critic is purely new resources.

---

## Files created / modified

| File | Action | Notes |
|------|--------|-------|
| `docs/iteration-plan.md` | modified | renumber: testing harness = iter 6 (added detailed section), critic = iter 7, MCP = iter 8; map table + tracking checklist made consistent. |
| `.claude/commands/iter-start.md` | added | ported from sibling, adapted to this repo's conventions. |
| `.claude/commands/iter-end.md` | added | ported from sibling, adapted to this repo's CHANGELOG format + tracking checklist. |
| `agents/critic/src/critic-loop.ts` | added | generator + critic agents; pure `parseVerdict`; the code-orchestrated loop. |
| `agents/critic/src/agent.ts` | added | local model factory, `invokeCritic`, opt-in `LOG_DELEGATION` round logging. |
| `agents/critic/src/a2a.ts` | added | public A2A door (Agent Card + JSON-RPC); facade adapts the loop output → AgentResult. |
| `agents/critic/src/app.ts` | added | HTTP entrypoint + opt-in A2A. |
| `agents/critic/{package.json,tsconfig.json,Dockerfile,.dockerignore,.npmrc}` | added | mirror the router. |
| `agents/critic/test/critic-loop.test.ts` | added | Vitest: `parseVerdict` + loop-termination invariants (no Bedrock). |
| `agents/critic/eval/promptfooconfig.yaml` | added | post-deploy quality eval (live runtime). |
| `infra/critic.tf` | added | `module "critic"` — own ECR + runtime + IAM. |
| `infra/critic-a2a.tf` | added | critic's public A2A/JWT door (own Cognito pool/client/user). |
| `infra/variables.tf` | modified | `critic_agent_name` / `critic_image_tag` / `critic_a2a_enabled` / `critic_a2a_public_url`. |
| `infra/outputs.tf` | modified | `runtime_arns` gains a `critic` key; `critic_*` outputs. |
| `.github/workflows/ci.yml` | modified | critic typecheck (npm test auto-globs the new suite). |
| `.github/workflows/deploy.yml` | modified | ensure critic ECR repo, build+push critic image, smoke test (HTTP + A2A), critic in the eval loop. |
| `docs/agents/critic/ARCHITECTURE.md` | added | per-agent architecture doc. |

---

## Tests

Per the iteration plan's Test phase. Actual results (Node local; live Bedrock via local
AWS creds, account 224193574799):

- [x] `npm test` → **34 passed** (supervisor 4, router 14, **critic 16**), ~0.7s, no AWS
- [x] critic `tsc --noEmit` → exit 0; supervisor + router `tsc --noEmit` → exit 0 (unchanged)
- [x] `terraform fmt -check -recursive` → exit 0; `terraform validate` → "Success! The
  configuration is valid."
- [x] local HTTP run (`MAX_ITERATIONS=2`, `LOG_DELEGATION=true`): `/ping` →
  `{"status":"ok"}`; `/invocations` "write a tagline" → refined answer, log
  `round 1: APPROVED` / `done in 1 round(s), approved`; a harder prompt (accurate-AND-
  simple quantum explanation) → **`done in 2 round(s)`** (round 1 REVISE → round 2
  APPROVED — live multi-round refinement); empty prompt → **400**
- [x] loop **termination at the cap** proven deterministically by the Vitest suite
  (`reflect — termination guarantee`: rounds never exceed the cap even when the critic
  always says REVISE; non-positive cap clamps to 1; best-effort answer always returned)
- [x] A2A door (`A2A_ENABLED`, port 9001): agent card name **"Multi-Agent Critic"**, one
  `refine` skill, `streaming:true`; `message/send` "two-word bakery slogan" →
  task **completed**, artifact `"Rise & Shine"` (== the loop answer)
- [x] **bug caught by the new tests**: same-line critic feedback (`REVISE: be specific`)
  was dropped by `feedbackAfterToken` (only kept lines *after* the token); fixed to strip
  the leading token (+`:`/`-`/ws) and keep the same-line remainder — re-ran green
- [ ] ARM64 Docker build + deployed smoke tests + post-deploy eval — pending pipeline

---

## Forward-compatibility check

- The critic is a new `agents/<type>/` folder + one `module` block; supervisor + router
  untouched. `runtime_arns` gains one key — the established extension point.
- `parseVerdict` is the tested control-flow seam (like the router's `labelFromText`) —
  keep it pure so the loop stays unit-testable.
- `MAX_ITERATIONS` is an env knob; the loop cap is forward-compatible (raise without code
  change).

---

## Open questions / follow-ups

- [ ] Consider a SigV4 A2A door for scanner discovery (mirrors `supervisor-a2a-sigv4.tf`),
  if the critic should be cataloged by the MuleSoft registry like the supervisor.
- [ ] Expand the eval dataset (more "needs-refinement" prompts; assert ≥1 revision round).

---

## Rollback

- Whole agent: `terraform destroy -target=module.critic` + the A2A runtime & Cognito pool.
- A2A door only: destroy the `critic_a2a` runtime + pool (HTTP runtime unaffected).
- Container A2A: `critic_a2a_enabled=false` (default).
- Code: revert the commit (supervisor + router untouched).
