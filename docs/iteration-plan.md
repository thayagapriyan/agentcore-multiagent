# Iteration Plan — Multi-Agent Track

Small, additive iterations building a multi-agent system on Bedrock AgentCore. Each
follows **Design → Develop → Test → Deploy → Rollback**, leaves the system working,
and is forward-compatible with later iterations.

See [IDEA.md](IDEA.md) for the broader roadmap this is drawn from, and the sibling
[agentcore-solution1](../../agentcore-solution1) for the proven single-agent deploy
patterns we reuse.

---

## Strategy: local-first, deploy as its own concern

The sibling project already proved the deploy plumbing (ECR → AgentCore Runtime →
OIDC CI/CD). The **learning** in this repo is the multi-agent *patterns* — fastest to
iterate locally. So:

- **Pattern iterations** (1, 3, 4, …) are built and verified **locally** first.
- **Deploy is its own iteration** (iter 2 deploys the supervisor; later patterns
  deploy as part of their flow once the pipeline exists).

This keeps one concern per iteration and avoids re-proving solved infrastructure.

---

## Operating principles

| Principle | What it means in practice |
|-----------|---------------------------|
| **Additive only** | Never delete or rename a working agent/pattern in the same iteration that adds a new one. |
| **Forward-compatible** | New iterations must not require old ones to change. Use env flags (e.g. `ORCHESTRATION_MODE`, `LOG_DELEGATION`) and optional config. |
| **Always green** | Every iteration ends with `/ping` → 200 and `/invocations` → a valid response (locally, and on AWS once deployed). |
| **Reversible** | Every iteration has a documented rollback (env flip, image tag revert, Terraform target destroy). |
| **One concern per iteration** | If tempted to bundle two changes, split. |
| **Orchestration in code** | Routing/workflow logic is TypeScript (`Graph`/`Swarm`/agent-as-tool), never YAML. |

---

## Iteration map (at a glance)

| # | Iteration | Delivers | Pattern tier | Infra change |
|---|-----------|----------|--------------|--------------|
| 1 | Supervisor + specialists | Router agent delegates to math/greeting sub-agents (agent-as-tool) | 1.1 | none — **done** |
| 2 | Deploy the supervisor | Iter-1 agent live on AgentCore via Terraform + OIDC CI/CD | — | ECR + runtime + pipeline |
| 3 | Conditional `Graph` router | Classify → route → summarize, explicit edges | 1.3 | none |
| 4 | Critic / reflection loop | Generator + critic, loop until approved | 2.6 | none |
| 5 | Second runtime via MCP | A specialist deployed as its own runtime, called over MCP/Gateway | 3.8 | second runtime + Gateway |
| 6 | A2A-exposed agent | An agent exposes an A2A Agent Card, callable over A2A | 3.9 | A2A server wiring |

Later (optional): parallel fan-out (2.5), plan-and-execute (2.7), capstone "agent
fabric" (Tier 4).

---

## Iteration 1 — Supervisor + specialists (agent-as-tool) ✅ done

> Goal: a router agent that delegates to specialist sub-agents — the smallest
> multi-agent step.

**Design**
- A supervisor `Agent` whose `tools` are other `Agent`s, wrapped via
  `agent.asTool({ name, description })`.
- Two dependency-free specialists (`math_specialist`, `greeting_specialist`) sharing
  the supervisor's Bedrock model — no Gateway/Lambda needed.
- Reuse the sibling's Express `/ping` + `/invocations` wrapper.

**Develop**
- `agents/supervisor/src/specialists.ts` — specialist definitions.
- `agents/supervisor/src/agent.ts` — `createSupervisor()` wires specialists as tools;
  opt-in `LOG_DELEGATION` hook logs which specialist is chosen.
- `agents/supervisor/src/app.ts` — HTTP entrypoint.
- Per-agent `package.json`, `tsconfig.json`, `Dockerfile`, `.dockerignore`, `.npmrc`.

**Test** (actual results — verified locally)
- `npm run build` clean; `npx tsc --noEmit` exit 0.
- `/ping` → `{"status":"ok"}`.
- "what is 17 plus 25?" → **42**, log: `delegating to math_specialist`.
- "say hi to me" → greeting, log: `delegating to greeting_specialist`.
- empty prompt → **400**.

**Deploy**
- None this iteration — local only. Deploy is iter 2.

**Rollback**
- Delete `agents/supervisor/`.

**Forward-compatibility**
- New specialists are just new entries in `ALL_SPECIALISTS` — additive.
- The supervisor is a plain `Agent`, so swapping in a `Graph`/`Swarm` later (iter 3+)
  is a change behind `createSupervisor()`, not a contract change to `app.ts`.

---

## Iteration 2 — Deploy the supervisor

> Goal: iter-1's supervisor running live on AgentCore Runtime, deployed by the
> sibling's proven Terraform + OIDC CI/CD path.

**Design**
- One ECR repo + one AgentCore runtime for the supervisor (it's a single deployable —
  specialists are in-process).
- Reuse the sibling's `versions.tf` backend pattern, `iam.tf` runtime role (ECR pull +
  logs + `bedrock:InvokeModel`), `runtime.tf`, and `cicd.tf` (OIDC deploy role).
- No Gateway, no sessions yet — the supervisor only needs Bedrock.

**Develop**
- `infra/` — `versions.tf`, `variables.tf` (`agent_name = multiagent-supervisor`),
  `ecr.tf`, `iam.tf`, `runtime.tf`, `cicd.tf`, `outputs.tf`.
- `.github/workflows/` — `ci.yml` (typecheck + tf fmt/validate), `deploy.yml`
  (OIDC → buildx ARM64 → push → apply → smoke), `bootstrap.yml` (one-time OIDC role).
- Pin Terraform to a version supporting `use_lockfile` (≥ 1.10 — lesson from sibling).

**Test**
- Local: `tsc --noEmit`, `terraform fmt -check`, `terraform validate` clean.
- Bootstrap workflow → deploy role created, `AWS_ROLE_ARN` var set.
- Deploy workflow → smoke test: `invoke-agent-runtime {"prompt":"add 2 and 3"}` →
  200 with a `result` reflecting `math_specialist`.

**Deploy**
- Terraform apply via the pipeline.

**Rollback**
- `terraform destroy -target=aws_bedrockagentcore_agent_runtime.supervisor`; image tag
  revert; disable workflows in GitHub.

**Forward-compatibility**
- Resource names prefixed per agent (`multiagent-supervisor-*`) so a second deployable
  (iter 5) adds its own without collision.

---

## Iteration 3 — Conditional `Graph` router

> Goal: replace the simple supervisor with an explicit `Graph` that classifies a
> request and routes to the right branch — the heart of real workflows.

**Design**
- `intake` node classifies → conditional edges to `billing`/`tech` (or reuse
  math/greeting) → `summarize` node.
- Gated behind `ORCHESTRATION_MODE` (`agent-as-tool` default | `graph`), so iter-1
  behavior is preserved and rollback is an env flip.

**Develop**
- `agents/supervisor/src/graph.ts` — build the `Graph` (nodes + conditional edges).
- `createSupervisor()` branches on `ORCHESTRATION_MODE`.

**Test**
- Local: a "refund" prompt routes to billing branch; a "bug" prompt to tech; verify
  via the delegation/`Graph` event log.
- `ORCHESTRATION_MODE` unset → identical to iter 1 (additive proof).

**Deploy**
- Build/push new image; `terraform apply -var=image_tag=<sha>` (+ set env var).

**Rollback**
- Unset `ORCHESTRATION_MODE` → reverts to agent-as-tool. No redeploy needed.

**Forward-compatibility**
- `Graph` vs agent-as-tool is a runtime choice — both code paths kept.

---

## Iteration 4 — Critic / reflection loop

> Goal: iterative refinement — a generator produces output, a critic reviews, loop
> until approved or N tries.

**Design**
- `generator` + `critic` agents; a loop with a termination condition (approved or
  max iterations). Expressed as a `Graph` with a back-edge, or a `Swarm`.
- New `ORCHESTRATION_MODE=critic` value (additive to iter-3's modes).

**Develop**
- `agents/supervisor/src/critic-loop.ts`.

**Test**
- Local: a prompt that needs refinement shows ≥1 critic round in the log; verify it
  terminates (no infinite loop) at the max-iteration cap.

**Deploy / Rollback**
- Same env-flag pattern as iter 3.

---

## Iteration 5 — Second runtime via MCP (first distribution)

> Goal: take one specialist out-of-process — deploy it as its **own** AgentCore
> runtime, called by the supervisor over MCP via the Gateway.

**Design**
- New deployable `agents/<specialist>/` with its own Dockerfile + runtime.
- Supervisor connects to it as an MCP tool (reuse the sibling's Gateway pattern).
- This is the in-process → distributed jump; the cost (extra runtime, IAM, latency)
  is the lesson.

**Develop**
- Second agent folder; `infra/` gains a second ECR + runtime + Gateway target;
  pipeline builds/deploys both images.

**Test**
- Both runtimes healthy; supervisor invocation that needs the remote specialist shows
  the cross-runtime call in traces.

**Rollback**
- `terraform destroy -target` the second runtime + Gateway target; supervisor falls
  back to in-process specialists.

**Forward-compatibility**
- Monorepo structure (`agents/*`, per-agent Dockerfiles) was laid down in iter 1 for
  exactly this.

---

## Iteration 6 — A2A-exposed agent

> Goal: expose an agent via the A2A protocol (Agent Card + JSON-RPC) using the SDK's
> `a2a` module — the open inter-agent standard.

**Design**
- One agent runs an A2A server (`a2a/express-server`) alongside or instead of the
  AgentCore HTTP contract; publish its Agent Card.
- Another agent calls it over A2A.

**Develop**
- `agents/<agent>/src/a2a-server.ts`; wire the Agent Card + skills.

**Test**
- Validate the Agent Card; a cross-agent A2A call returns a correct result.
- (Optional) point an external A2A inspector at the Agent Card.

**Rollback**
- Remove the A2A server; agents revert to MCP/in-process.

---

## Tracking progress

```
- [x] Iter 1 — Supervisor + specialists (agent-as-tool)   ← done, verified locally
- [ ] Iter 2 — Deploy the supervisor (infra + CI/CD)
- [ ] Iter 3 — Conditional Graph router
- [ ] Iter 4 — Critic / reflection loop
- [ ] Iter 5 — Second runtime via MCP
- [ ] Iter 6 — A2A-exposed agent
```

---

## When to break the rules

Same as the sibling: spikes (throwaway prototypes), tight coupling discovered late
(fix the earlier iteration before piling on), and hotfixes (document, fold into the
next iteration). The plan is a default, not a contract.
