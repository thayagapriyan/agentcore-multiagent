# Iter 2 — Deploy the supervisor

**Date**: 2026-06-09
**Branch**: `feat/iter-2-deploy-supervisor`
**Iteration plan reference**: [docs/iteration-plan.md § Iteration 2](../iteration-plan.md)

---

## Goal

Get the iter-1 supervisor agent running live on Amazon Bedrock AgentCore Runtime via the sibling project's proven Terraform + OIDC CI/CD path (one ECR repo + one runtime, Bedrock-only — no Gateway or sessions yet).

---

## Prompts used

Verbatim (or close paraphrase) of the prompts sent to Claude during this iteration. Order matters — they tell the story.

1. **Prompt**: `what is next step i have committed all changes` → then `we will be working on agentcore-multiagent project`
   **Why**: orient on project state and pick the next iteration.

2. **Prompt**: started Iter 2 via `/iter-start 2 "Deploy the supervisor"`, folding the stray `docs/IDEA.md` edit into this branch.
   **Why**: scaffold the iteration on rails.

---

## Decisions made

Non-obvious choices made during this iteration, with reasoning. Things a future reader would want to know.

- **Decision**: Most of iter-2's infra/CICD was already authored in the scaffold commit `86ffeb2`. The real work was making the deploy pipeline succeed on a cold start.
  **Alternatives considered**: re-authoring the infra from the iteration plan.
  **Why**: the existing infra already incorporated every sibling iter-11 lesson and was correct — no reason to rewrite it.

- **Decision**: `deploy.yml` pre-creates the ECR repo via a targeted `terraform apply` *before* the image build/push, and reads the repo URL from `terraform output` instead of a hand-set `ECR_REPOSITORY` Actions variable.
  **Alternatives considered**: (a) creating the ECR repo manually once in the console; (b) keeping the `ECR_REPOSITORY` variable and just fixing its value.
  **Why**: the original workflow pushed the image before any `terraform apply`, so on a first-ever deploy the repo didn't exist → push failed. Sourcing the URL from `terraform output` also eliminates the name-drift bug (the variable was set to `agentcore-multiagent` but Terraform names the repo `multiagent-supervisor`). This makes a cold deploy self-sufficient with no manual steps.

---

## Files created / modified

| File | Action | Notes |
|------|--------|-------|
| `.github/workflows/deploy.yml` | modified | pre-create ECR before build/push; read repo URL from `terraform output` |
| `docs/prompts/_template.md` | added | ported from sibling project (didn't exist here yet) |
| `docs/prompts/iter-2.md` | added | this log |
| `docs/IDEA.md` | modified | added "Agents testing site" link (folded in from main) |

---

## Tests

Per the iteration plan's Test phase. Record actual results, not expected.

- [x] Bootstrap workflow → deploy role `multiagent-supervisor-github-deploy` created, `AWS_ROLE_ARN` Actions var set.
- [x] Deploy workflow (first run) → **failed** at image push: ECR repo didn't exist yet (push-before-apply ordering) + `ECR_REPOSITORY` name mismatch. Fixed in `deploy.yml`.
- [x] Deploy workflow (after fix, `workflow_dispatch` on branch) → **succeeded**: ECR pre-created, ARM64 image pushed, `terraform apply` created runtime `multiagent_supervisor-vlCRzx7D5I`, built-in smoke test (`{"prompt":"add 2 and 3"}` → grep `result`) passed.
- [x] Merge to `main` → fast-forward to `d42a338` (already-deployed commit); deploy is a no-op/idempotent, runtime ARN unchanged.
- [x] Live runtime verified directly via `invoke-agent-runtime`:
  - `"what is 17 plus 25?"` → `{"result":"17 plus 25 equals **42**."}` (200)
  - `"what is 8 times 9?"` → `{"result":"8 times 9 is **72**."}` (200)
  - `"say hi to me"` / `"greet me warmly"` → friendly greeting (200)
  - Math → `math_specialist`, greeting → `greeting_specialist`, delegation working in production.

---

## Forward-compatibility check

How does this iteration leave room for future iterations? Anything that should NOT be hardened or removed because a later iteration depends on it staying flexible.

- Resource names prefixed per agent (`multiagent-supervisor-*`) so iter-5's second deployable adds its own without collision.

---

## Open questions / follow-ups

Things that came up but weren't in scope for this iteration. Move to a future iteration or a separate ticket.

- [x] Audited: scaffold commit `86ffeb2` already provided all `infra/*.tf` + all three workflows; only the `deploy.yml` cold-start fix was needed.
- [ ] `ECR_REPOSITORY` Actions variable is now unused by `deploy.yml` (URL comes from `terraform output`). `bootstrap.yml`'s docs still mention setting it — harmless, but could be tidied in a future docs pass.

---

## Rollback

How to undo this iteration if needed.

- `terraform destroy -target=aws_bedrockagentcore_agent_runtime.supervisor`; image tag revert; disable workflows in GitHub.
