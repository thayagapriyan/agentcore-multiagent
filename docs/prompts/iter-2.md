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

- **Decision**: <what was chosen>
  **Alternatives considered**: <what was rejected>
  **Why**: <reasoning>

---

## Files created / modified

| File | Action | Notes |
|------|--------|-------|
| `docs/prompts/_template.md` | added | ported from sibling project (didn't exist here yet) |
| `docs/prompts/iter-2.md` | added | this log |
| `docs/IDEA.md` | modified | added "Agents testing site" link (folded in from main) |

---

## Tests

Per the iteration plan's Test phase. Record actual results, not expected.

- [ ] Local: `tsc --noEmit`, `terraform fmt -check`, `terraform validate` clean → `<actual>`
- [ ] Bootstrap workflow → deploy role created, `AWS_ROLE_ARN` var set → `<actual>`
- [ ] Deploy workflow smoke test: `invoke-agent-runtime {"prompt":"add 2 and 3"}` → 200 with `result` reflecting `math_specialist` → `<actual>`

---

## Forward-compatibility check

How does this iteration leave room for future iterations? Anything that should NOT be hardened or removed because a later iteration depends on it staying flexible.

- Resource names prefixed per agent (`multiagent-supervisor-*`) so iter-5's second deployable adds its own without collision.

---

## Open questions / follow-ups

Things that came up but weren't in scope for this iteration. Move to a future iteration or a separate ticket.

- [ ] Audit how much of `infra/` and `.github/workflows/` the scaffold commit (`86ffeb2`) already provides vs. what iter 2 still needs.

---

## Rollback

How to undo this iteration if needed.

- `terraform destroy -target=aws_bedrockagentcore_agent_runtime.supervisor`; image tag revert; disable workflows in GitHub.
