# Iteration Plan — Multi-Agent Track

Small, additive iterations building a multi-agent system on Bedrock AgentCore. Each
follows **Design → Develop → Test → Deploy → Rollback**, leaves the system working,
and is forward-compatible with later iterations.

See [IDEA.md](IDEA.md) for the broader roadmap this is drawn from, and the sibling
[agentcore-solution1](../../agentcore-solution1) for the proven single-agent deploy
patterns we reuse.

---

## Strategy: one folder per agent type, each its own deployable

Each multi-agent *pattern* is built as its **own agent type** in its own
`agents/<type>/` folder, packaged as its **own deployable** — its own Docker image,
ECR repo, and AgentCore runtime. Patterns are **separate agents, not modes of one
agent.** This is the core shape of the repo:

- **Never modify or replace an existing agent.** A new iteration adds a new
  `agents/<type>/` folder alongside the others. The live supervisor from iter 1–2 is
  never restructured by a later iteration. (This supersedes the earlier env-flag
  approach — `ORCHESTRATION_MODE` is no longer how new patterns arrive.)
- **Each agent = its own runtime.** Separate ECR repo + AgentCore runtime per agent
  type, for maximum isolation and independent deploy/scale. The cost (N runtimes) is
  accepted deliberately.
- **Shared code lives in `packages/common`.** The Express `/ping`+`/invocations`
  wrapper, the Bedrock model factory, and the A2A server are factored into a
  workspace package every agent imports — reuse, not copy-paste.
- **Terraform is a reusable per-agent module.** `infra/` defines an agent module
  (ECR + runtime + IAM) instantiated once per agent type. Adding an agent = one
  module block, not a new hand-written stack.
- **A2A only on the top-most (public) agent of each project.** The entry-point agent
  exposes an A2A server + Agent Card — the public door the [a2d-ai tester](https://www.a2d-ai.com/tester)
  and other A2A clients call. Internal sub-agents stay in-process (or later, internal
  MCP); they are not A2A-exposed.

The sibling project already proved the deploy plumbing (ECR → AgentCore Runtime →
OIDC CI/CD); the **learning** here is multi-agent *patterns*, each built and verified
locally first, then deployed as its own runtime through the existing pipeline.

---

## Operating principles

| Principle | What it means in practice |
|-----------|---------------------------|
| **Additive only** | A new iteration adds a new `agents/<type>/` folder; it never modifies or replaces an existing agent. |
| **One agent per folder** | Each agent type is its own deployable (own image, ECR repo, runtime). Patterns are separate agents, not env-flag modes of one agent. |
| **Reuse via `packages/common`** | Shared wrapper, model factory, and A2A server live in the common package; agents import them, never copy them. |
| **A2A on the public agent only** | Each project's top-most agent exposes A2A; internal sub-agents do not. |
| **Forward-compatible** | New iterations must not require old ones to change. New agents reuse the existing common package + Terraform module unchanged. |
| **Always green** | Every iteration ends with each deployed agent's `/ping` → 200 and `/invocations` → a valid response (locally, and on AWS once deployed). |
| **Reversible** | Every iteration has a documented rollback (`terraform destroy -target` the new agent's module, image tag revert). A new agent's rollback never touches existing agents. |
| **One concern per iteration** | If tempted to bundle two changes, split. |
| **Orchestration in code** | Routing/workflow logic is TypeScript (`Graph`/`Swarm`/agent-as-tool), never YAML. |

---

## Iteration map (at a glance)

| # | Iteration | New deployable? | Delivers | Infra change |
|---|-----------|-----------------|----------|--------------|
| 1 | Supervisor + specialists | `agents/supervisor/` | Router delegates to math/greeting sub-agents (agent-as-tool) | none — **done** |
| 2 | Deploy the supervisor | — | Iter-1 agent live on AgentCore via Terraform + OIDC CI/CD | ECR + runtime + pipeline — **done** |
| 3 | Extract `packages/common` + per-agent TF module | — (refactor) | Shared wrapper/model factory in `packages/common`; `infra/` becomes a reusable per-agent module. Supervisor consumes both, behavior + state **identical**. | infra refactor, no resource recreate |
| 4 | A2A on the supervisor (public door) | — | Supervisor exposes an A2A server + Agent Card via `packages/common`; the **a2d-ai tester can now call it** | A2A wiring on existing runtime |
| 5 | Conditional `Graph` router | `agents/router/` | New agent: classify → route → summarize (explicit edges); A2A on top | new ECR + runtime (module) |
| 6 | Critic / reflection loop | `agents/critic/` | New agent: generator + critic, loop until approved; A2A on top | new ECR + runtime (module) |
| 7 | Second agent called over MCP | `agents/<specialist>/` | A specialist as its own runtime, called by a top agent over internal MCP/Gateway | new runtime + Gateway |

Each new-agent iteration (5+) is the same shape: a new `agents/<type>/` folder, a new
module block in `infra/`, A2A on its top-most agent, deployed by the existing
pipeline. Later (optional, same pattern): swarm w/ handoffs, parallel fan-out,
plan-and-execute, capstone "agent fabric".

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
- The supervisor stays a plain `Agent`. Later patterns (`Graph`, `Swarm`, critic loop)
  are **separate agent folders**, not changes to this one — so the supervisor is never
  restructured.

---

## Iteration 2 — Deploy the supervisor ✅ done

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

## Iteration 3 — Extract `packages/common` + per-agent Terraform module

> Goal: the enabling refactor. Factor the shared agent runtime code into
> `packages/common` and turn `infra/` into a reusable per-agent module — so every
> later agent is a thin folder + one module block. **Additive: the supervisor's
> behavior and its live AWS resources are unchanged.**

**Design**
- `packages/common` (npm workspace): the Express `/ping`+`/invocations` wrapper, the
  Bedrock model factory, and shared types. (The A2A server lands here in iter 4.)
- Root `package.json` with npm workspaces (`packages/*`, `agents/*`).
- `infra/` agent module (`infra/modules/agent/`): ECR repo + lifecycle + runtime +
  runtime IAM role, parameterized by `agent_name`/`model_id`/`image_tag`. The root
  `infra/` calls it once for `supervisor` and keeps shared resources (backend,
  `cicd.tf` OIDC role) at the top level.

**Develop**
- Create `packages/common/`; move the wrapper + model factory out of
  `agents/supervisor/src` into it; supervisor imports from `common`.
- Refactor `infra/{ecr,iam,runtime}.tf` into `infra/modules/agent/`; replace the
  bodies with a `module "supervisor"` call.
- **State migration:** use `moved {}` blocks (or `terraform state mv`) so the
  supervisor's existing resources map to their new module addresses — **no
  destroy/recreate** of the live runtime.

**Test**
- Local: `npm install` (workspaces resolve), `tsc --noEmit` clean for supervisor.
- `terraform plan` shows **only address moves, zero resource changes** (the proof
  this refactor is non-destructive).
- After deploy, re-invoke the live runtime → same `42` / greeting responses as iter 2.

**Deploy**
- Pipeline as usual; confirm `terraform apply` reports no resource replacement.

**Rollback**
- Revert the refactor commit; `moved` blocks are reversible. The live runtime is never
  torn down, so rollback is code-only.

**Forward-compatibility**
- After this, a new agent = a new `agents/<type>/` folder importing `common` + a new
  `module "<type>"` block. This is the spine every later iteration relies on.

---

## Iteration 4 — A2A on the supervisor (the public door)

> Goal: expose the supervisor over the A2A protocol (Agent Card + JSON-RPC) using the
> SDK's `a2a` module, so the [a2d-ai tester](https://www.a2d-ai.com/tester) and other
> A2A clients can call it. A2A is the public front door — **only the top-most agent
> gets it.**

**Design**
- An A2A server (`a2a/express-server`) in `packages/common`, reusable by any agent
  that should be public. Publish the supervisor's Agent Card (name, description,
  skills).
- Runs alongside the AgentCore `/ping`+`/invocations` contract (additive — the
  existing invoke path keeps working).

**Develop**
- `packages/common/src/a2a-server.ts` — generic A2A wrapper around an `Agent`.
- `agents/supervisor/src/a2a.ts` — supervisor's Agent Card + skills; wire into `app.ts`.
- Expose/port config via env so the runtime serves the A2A endpoint.

**Test**
- Local: fetch the Agent Card; an A2A client call returns the same result as
  `/invocations` for the math + greeting prompts.
- Deployed: point the a2d-ai tester (A2A mode) at the supervisor's A2A endpoint →
  `"what is 17 plus 25?"` → `42`.

**Rollback**
- Remove the A2A wiring from `app.ts` (env flag off); the AgentCore invoke path is
  untouched, so the agent still works.

**Forward-compatibility**
- The `packages/common` A2A server is reused by every future project's top agent —
  internal sub-agents never import it.

---

## Iteration 5 — Conditional `Graph` router (new agent)

> Goal: a **new** agent type — `agents/router/` — that classifies a request and routes
> via an explicit `Graph` with conditional edges. The supervisor is untouched.

**Design**
- New deployable `agents/router/`: `intake` node classifies → conditional edges to
  branch agents → `summarize`. Imports the `/ping`+`/invocations` wrapper from
  `packages/common` (SDK-agnostic); owns its own Bedrock model factory like the
  supervisor. A2A on its top (router) agent.
- New `module "router"` block in `infra/` → its own ECR + runtime.
- **Per-agent outputs (decided iter 3):** convert the flat `agent_runtime_arn` output
  to a single **map keyed by agent** — `runtime_arns = { supervisor = …, router = … }`
  — and update the deploy smoke test to `terraform output -json runtime_arns | jq -r
  .<agent>`. This is the first iteration with >1 agent, so it's where the map lands.

**Develop**
- `agents/router/src/{graph,agent,app}.ts`, Dockerfile, package.json (extends base TS
  config, depends on `common`).
- `infra/` — add `module "router"`; convert outputs to the per-agent ARN map; pipeline
  builds/deploys both supervisor + router (each resolving its own `agent_name`).

**Test**
- Local: a "refund" prompt routes to the billing branch, a "bug" prompt to tech, via
  the `Graph` event log.
- Deployed: router runtime healthy; A2A call via a2d-ai tester returns a routed answer.

**Rollback**
- `terraform destroy -target=module.router`; supervisor unaffected.

**Forward-compatibility**
- Establishes the new-agent template (folder + module + A2A-on-top) every later
  pattern reuses.

---

## Iteration 6 — Critic / reflection loop (new agent)

> Goal: a **new** agent type — `agents/critic/` — iterative refinement: a generator
> produces output, a critic reviews, loop until approved or N tries.

**Design**
- New deployable `agents/critic/`: `generator` + `critic` agents with a termination
  condition (approved or max iterations), as a `Graph` with a back-edge (or `Swarm`).
- New `module "critic"` block; A2A on its top agent.

**Develop**
- `agents/critic/src/{critic-loop,agent,app}.ts`, Dockerfile, package.json.
- `infra/` — add `module "critic"`.

**Test**
- Local: a prompt needing refinement shows ≥1 critic round; verify it terminates at
  the max-iteration cap (no infinite loop).
- Deployed: A2A call returns a refined answer; loop count visible in logs.

**Rollback**
- `terraform destroy -target=module.critic`; other agents unaffected.

---

## Iteration 7 — Second agent called over MCP (internal distribution)

> Goal: a top agent calls a **separate** agent runtime over **internal** MCP/Gateway —
> the in-process → distributed jump. The callee is internal (no A2A); only the top
> caller stays public.

**Design**
- New deployable specialist `agents/<specialist>/` with its own runtime.
- A top agent connects to it as an MCP tool via the Gateway (reuse the sibling's
  Gateway pattern). Internal sub-agents are **not** A2A-exposed.

**Develop**
- New agent folder + `module "<specialist>"`; `infra/` gains a Gateway + target;
  pipeline builds/deploys both images.

**Test**
- Both runtimes healthy; a top-agent invocation that needs the remote specialist shows
  the cross-runtime MCP call in traces.

**Rollback**
- `terraform destroy -target` the specialist module + Gateway target; the caller falls
  back to its in-process specialists.

---

## Tracking progress

```
- [x] Iter 1 — Supervisor + specialists (agent-as-tool)        ← done, verified live
- [x] Iter 2 — Deploy the supervisor (infra + CI/CD)           ← done, verified live
- [x] Iter 3 — Extract packages/common + per-agent TF module   ← done, 0-change plan proof
- [x] Iter 4 — A2A on the supervisor (public door)             ← done, verified via a2d-ai tester
- [ ] Iter 5 — Conditional Graph router        (new agent: agents/router/)
- [ ] Iter 6 — Critic / reflection loop        (new agent: agents/critic/)
- [ ] Iter 7 — Second agent over MCP           (new agent + internal Gateway)
```

---

## When to break the rules

Same as the sibling: spikes (throwaway prototypes), tight coupling discovered late
(fix the earlier iteration before piling on), and hotfixes (document, fold into the
next iteration). The plan is a default, not a contract.
