# Iter 5 — Conditional `Graph` router (new agent)

**Date**: 2026-06-15
**Branch**: `feat/iter-5-graph-router`
**Iteration plan reference**: [docs/iteration-plan.md § Iteration 5](../iteration-plan.md)

---

## Goal

A **new deployable** `agents/router/` that classifies each support request and
routes it through an explicit Strands `Graph` with **conditional edges** (intake →
billing / tech / general → summarize), exposed over HTTP `/invocations` and a public
A2A/JWT door — the supervisor untouched, deployed as its own ECR repo + runtime via a
second `module "router"` block.

---

## Prompts used

1. **Prompt**: `move to next iteration`
   **Why**: kick off iter 5 per the plan's tracking checklist (iters 1–4 done). Claude
   read the iteration plan + CHANGELOG, inspected the supervisor's source, the
   `packages/common` wrapper, the agent Terraform module, and the SDK's `multiagent`
   (`Graph`/`Edge`/`Node`) type declarations before designing.

2. **Prompt**: (decision) A2A scope for the router — *"tell me why do we need http
   protocol when it is a2a compliant"*
   **Why**: clarify the two-door model. Claude explained that AgentCore runtimes have
   one `server_protocol` each (HTTP vs A2A → ports 8080 vs 9000), the same image serves
   both, and the HTTP door is the one the CI smoke test (SigV4 `invoke-agent-runtime`)
   verifies. Chosen scope: **Option 1** — HTTP `/invocations` + one A2A/JWT door (the
   a2d-ai-tester path); SigV4-A2A scanner door deferred (as it was for the supervisor).

3. **Prompt**: *"yes start building but add condition to update architecture.md file
   also in agents.md or claude.md when necessary like other md files"*
   **Why**: fold doc upkeep into the iteration. ARCHITECTURE.md turned out to be
   **per-agent** (`docs/agents/<agent>/ARCHITECTURE.md`); the router gets its own.

4. **Prompt**: (decision) SDK 1.5.0 vs 1.4.0 for the A2A facade.
   **Why**: a fresh router install pulled `@strands-agents/sdk@1.5.0` (supervisor is on
   1.4.0). In 1.5.0 the A2A executor requires a real snapshot-capable `Agent` via
   `agentFactory` — the plain-object Graph facade fails at boot. Chosen: **pin the
   router to 1.4.0** (matches the supervisor, reuses the proven facade, no extra model
   calls, no divergence).

---

## Decisions made

- **Decision**: routing is an explicit `Graph` with **conditional `EdgeHandler`s**, not
  agent-as-tool. `intake` (an `Agent` that emits exactly one label) → one gated edge per
  branch → `summarize`. Each branch → `summarize` (unconditional).
  **Alternatives considered**: a `Swarm`; reusing the supervisor's agent-as-tool with a
  routing prompt.
  **Why**: the plan's iter-5 goal is *explicit edges* — the learning is the `Graph`
  primitive. Edge handlers read the intake node's classification off `MultiAgentState`
  (`state.node('intake').content`) and traverse exactly one branch; the others stay
  `PENDING`, so they never gate `summarize` despite the SDK's AND-semantics on incoming
  edges (only the branch that ran is summarize's satisfied dependency).

- **Decision**: node id === classification label === branch registry key, centralized in
  `branches.ts`. The intake prompt, edge handlers, agent-card skills, and logs all
  derive from `ALL_BRANCHES`.
  **Why**: `AgentNode` derives its id from `agent.id`, edges reference nodes by id, and
  the handlers match the label string — keeping all three the same value in one place is
  the entire routing contract. Adding a branch = one registry entry.

- **Decision**: a `general` fallback branch, taken on an explicit "general"
  classification **or** any unrecognized label (`classifiedLabel()` defaults to it).
  **Why**: makes the graph **total** — every request lands on exactly one branch, so
  there's no "no outgoing edge satisfied / stuck" state, and a chatty/garbled intake
  output still routes.

- **Decision**: pin the router to `@strands-agents/sdk@1.4.0` (exact, no caret).
  **Alternatives considered**: 1.5.0 `agentFactory` with a graph-as-tool `Agent`
  (faithful but +2 model calls per A2A request, diverges from the supervisor); upgrade
  **both** agents to 1.5.0 (touches the live supervisor — against additive-only).
  **Why**: the supervisor's A2A facade pattern works on 1.4.0; pinning keeps both agents
  on one SDK, reuses the proven facade, and adds zero cost. The supervisor manifest is
  left as `^1.4.0` (lockfile already holds it at 1.4.0) so this iteration touches no
  existing-agent files.

- **Decision**: the A2A facade adapts the `Graph` output to an `AgentResult`. The SDK's
  `A2AExecutor` consumes the stream's final value via `.toString()`; a `MultiAgentResult`
  has no useful `toString` (would serialize `[object Object]`), so the facade's
  `invoke`/`stream` run a fresh graph and wrap its terminus text in
  `new AgentResult({ stopReason:'endTurn', lastMessage: <assistant TextBlock>,
  invocationState:{} })`.
  **Why**: keeps the A2A answer byte-equal to the `/invocations` answer (both run the
  same graph), with correct artifact text instead of `[object Object]`.

- **Decision**: per-agent **`runtime_arns` map** output (`{ supervisor, router }`) added
  alongside the kept flat `agent_runtime_arn`. Smoke tests select via
  `terraform output -json runtime_arns | jq -r .<agent>`.
  **Why**: the plan designates iter 5 (first >1-agent iteration) as where the map lands.
  Keeping the flat output too is additive — no existing caller breaks.

- **Decision**: broaden the CI deploy role's IAM scope from `${var.agent_name}-*`
  (`multiagent-supervisor-*`) to the project-wide `multiagent-*`.
  **Why**: the router's runtime role is `multiagent-router-runtime-role`, outside the old
  per-agent prefix — the deploy role couldn't create it. `multiagent-*` covers every
  current and future agent without re-editing `cicd.tf` per agent, while still excluding
  unrelated account IAM.

- **Decision**: the router's A2A door has its **own** Cognito pool/client/test-user
  (`router-a2a-tester`), separate from the supervisor's.
  **Why**: tokens for one agent must not authorize the other; mirrors `supervisor-a2a.tf`
  exactly so each door rolls back independently.

---

## Files created / modified

| File | Action | Notes |
|------|--------|-------|
| `agents/router/src/branches.ts` | added | Branch registry (`ALL_BRANCHES`): id===label===node-id, description, `build(model)`; `general` fallback + `FALLBACK_BRANCH_ID`. |
| `agents/router/src/graph.ts` | added | `createRouterGraph(model)` — intake → conditional edges (`EdgeHandler` per branch) → summarize; `classifiedLabel(state)` reads intake's output; `maxSteps:10` loop guard. |
| `agents/router/src/agent.ts` | added | Local Bedrock model factory; `invokeRouter(prompt)` (terminus text); opt-in `LOG_DELEGATION` via Graph `BeforeNodeCallEvent`; `logBranches()`. |
| `agents/router/src/a2a.ts` | added | A2A door: card skills from `ALL_BRANCHES`, fresh-graph-per-call facade adapting `Graph` output → `AgentResult`, 9000 listener + `/ping`. |
| `agents/router/src/app.ts` | added | Entry: 8080 wrapper + opt-in 9000 A2A (failure logged, never kills invoke path). |
| `agents/router/{package.json,tsconfig.json,Dockerfile,.dockerignore,.npmrc}` | added | Mirror the supervisor; **SDK pinned `1.4.0`**; root-context monorepo Docker build. |
| `infra/router.tf` | added | `module "router"` (own ECR + runtime + IAM); image tag coalesces `router_image_tag` → `image_tag`. |
| `infra/router-a2a.tf` | added | Router's public A2A/JWT door: own Cognito pool/client/test-user + A2A runtime (same image/role) + endpoint/credential outputs. |
| `infra/variables.tf` | modified | + `router_agent_name`, `router_image_tag`, `router_a2a_enabled`, `router_a2a_public_url`. |
| `infra/outputs.tf` | modified | + `runtime_arns` map, `router_ecr_repository_url`, `router_runtime_arn`; clarified `agent_runtime_arn` as legacy. |
| `infra/cicd.tf` | modified | deploy-role IAM scope `${var.agent_name}-*` → `multiagent-*` (covers the router's role). |
| `.github/workflows/deploy.yml` | modified | ensure **both** ECR repos; build+push supervisor & router; smoke tests via `runtime_arns` map (supervisor math + router billing); A2A smoke for both cards. |
| `.github/workflows/ci.yml` | modified | + router typecheck step. |
| `package-lock.json` | modified | router workspace + SDK 1.4.0 pin. |
| `docs/agents/router/ARCHITECTURE.md` | added | per-agent architecture doc (mirrors the supervisor's). |
| `CLAUDE.md` | modified | repository-layout note: `agents/<type>/` now has supervisor + router; ARCHITECTURE.md is per-agent. |
| `docs/prompts/iter-5.md` | added | this file. |
| `CHANGELOG.md` | modified | iter-5 entry appended. |
| `docs/iteration-plan.md` | modified | tracking checklist: iter 5 checked. |

---

## Tests

Actual results, run locally (Node 20.16, live Bedrock with local AWS creds):

- [x] `npm install` → resolves, 0 vulnerabilities; router `@strands-agents/sdk` = **1.4.0**, supervisor = **1.4.0**
- [x] `npm run build` (common + router + supervisor) → all clean
- [x] router `npx tsc --noEmit` → exit 0; **supervisor `npx tsc --noEmit` → exit 0** (unchanged, stays green)
- [x] `terraform fmt -check -recursive` → exit 0; `terraform validate` → "Success! The configuration is valid."
- [x] Local run (`A2A_ENABLED=true LOG_DELEGATION=true`): boots `listening on :8080`, `3 branches wired`, `a2a: … listening on :9000`
- [x] `GET :8080/ping` → `{"status":"ok"}`
- [x] `POST :8080/invocations` **billing** ("double charged … refund?") → billing-branch answer; log: `intake (classified: billing)` then `node billing`
- [x] `POST :8080/invocations` **tech** ("app crashes with a null pointer … settings") → troubleshooting answer; log: `node tech`
- [x] `POST :8080/invocations` **general** ("what are your support hours?") → general answer; log: `node general`
- [x] `POST :8080/invocations` empty prompt → **400** `{"error":"prompt is required"}`
- [x] `GET :9000/ping` → `{"status":"Healthy"}`; `GET :9000/.well-known/agent-card.json` → card "Multi-Agent Router", 3 branch skills, `streaming:true`
- [x] A2A `message/send` (billing) → task `completed`, artifact = the graph's billing answer (proves facade returns real graph text, not `[object Object]`); log routed to `billing`
- [x] ARM64 Docker build (`buildx --platform linux/arm64 --load`) → success; container `uname -m` → **aarch64**; boots both listeners; `/ping` → 200; live tech invocation routed to `tech`; empty → 400
- [ ] Deployed smoke tests (supervisor math + router billing via `runtime_arns`, both A2A cards) — pending pipeline run on merge to main

Note: the `BeforeNodeCallEvent` log fires *before* a node produces output, so the line
for the `intake` node itself reads `classified: general` (intake hasn't emitted yet —
`classifiedLabel` defaults to fallback). This is cosmetic; the **branch** node that
fires next always carries the correct label, and which branch node actually executes is
correct in every case above.

---

## Forward-compatibility check

- New-agent template is now proven twice: a thin `agents/<type>/` folder importing
  `common` + one `module "<type>"` block + (for a public agent) a `<type>-a2a.tf`. Iter 6
  (critic) and iter 7 (MCP) repeat it.
- `runtime_arns` map is the extension point: every future agent adds one key; smoke tests
  already select by agent.
- `multiagent-*` deploy-role IAM scope means no future agent has to touch `cicd.tf`.
- Branch registry (`ALL_BRANCHES`) drives the prompt, edges, card, and logs — adding a
  branch is one entry, same additive shape as the supervisor's specialist registry.
- **Do not** un-pin the router's SDK to a caret without re-validating the A2A facade
  against the newer executor (1.5.0 requires `agentFactory` + a snapshot-capable Agent).

---

## Open questions / follow-ups

- [ ] SigV4-A2A scanner door for the router (mirror `supervisor-a2a-sigv4.tf`) — deferred,
  same as the supervisor's was an iter-4 follow-up.
- [ ] A `get-a2a-token.yml`-style on-demand token workflow for the router (the supervisor
  has one) — not essential; deferred.
- [ ] Revisit the SDK pin: when ready to adopt `@strands-agents/sdk` ≥ 1.5.0, switch
  both A2A doors to `agentFactory` (fresh `Agent` per context) in one coordinated change.
- [ ] The intake-node log line shows the fallback label (cosmetic, see Tests note); if it
  ever matters, log the branch decision from an `AfterNodeCallEvent` on `intake` instead.

---

## Rollback

- **Whole router agent**: `terraform destroy -target=module.router` plus the A2A door
  (`-target=aws_bedrockagentcore_agent_runtime.router_a2a
  -target=aws_cognito_user_pool.router_a2a`). The supervisor's three runtimes are
  unaffected.
- **Router A2A door only**: destroy the `router_a2a` runtime + Cognito pool; the router's
  HTTP `/invocations` runtime keeps working.
- **Container A2A listener**: leave `router_a2a_enabled` at its default `false` — the
  container never opens 9000.
- **Code**: revert the iter-5 commit. No existing-agent files were modified, so the
  supervisor is byte-unchanged. (`cicd.tf` IAM scope widening is the only shared-file
  change — reverting it is safe once the router's role is gone.)
