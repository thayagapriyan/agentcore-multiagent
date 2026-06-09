# Multi-Agent Learning Roadmap

A progression of multi-agent projects, ordered so each teaches a distinct concept,
building on the existing stack (AgentCore + Strands + Gateway + sessions + CI/CD).
No new dependencies needed — the Strands SDK already ships `Graph`, `Swarm`,
agent-as-tool, and `a2a`.

Grouped by concept, simplest to most advanced.

---

## Tier 1 — Core patterns (in-process, no new infra)

These live inside a single container — you only change what the agent factory
returns. No `runtime.tf` changes; the existing pipeline deploys them as-is.

### 1. Supervisor + specialists (agent-as-tool) ← **best first project**
- A "router" agent with 2–3 sub-agents wrapped as tools (e.g. `math`, `greeting`).
- **Teaches:** how one agent delegates to another; an agent-as-tool is just another
  entry in the `tools` array.
- **Why first:** the smallest possible leap from a single agent.

### 2. Sequential pipeline (`Graph`, linear)
- `research → writer → editor`, each consuming the previous output.
- **Teaches:** chaining, passing state between agents, `Graph` nodes + edges.
- Classic demo: "draft a short blog post" passed through three roles.

### 3. Conditional router (`Graph`, branching)
- `intake` classifies a request → routes to `billing` or `tech` → `summarize`.
- **Teaches:** conditional edges (`when: (r) => ...`) — the heart of real workflows.
- The "customer-support triage" everyone builds — genuinely useful.

### 4. Swarm with handoffs (`Swarm`)
- A team of peers; whoever is best-suited takes over and can hand off.
- **Teaches:** dynamic (model-decided) routing vs. the explicit edges of `Graph` —
  the key `Graph` vs `Swarm` distinction.

---

## Tier 2 — Coordination patterns

### 5. Parallel fan-out / fan-in (`Graph`)
- Run `search` + `calculator` + `weather` simultaneously, merge in a `synthesizer`.
- **Teaches:** parallelism and result aggregation; why latency drops vs. sequential.

### 6. Critic / reflection loop
- A `generator` produces output, a `critic` reviews, loop until approved (or N tries).
- **Teaches:** iterative refinement and termination conditions — measurably improves
  output quality.

### 7. Plan-and-execute
- A `planner` breaks a goal into steps; an `executor` runs each (using Gateway tools).
- **Teaches:** dynamic task decomposition — closer to "autonomous agent" behavior.

---

## Tier 3 — Distribution (new infra — bigger projects)

These cross into "agents as separate services," touching `runtime.tf` and the
pipeline.

### 8. Two AgentCore runtimes, one calls the other (via Gateway/MCP)
- Deploy a second agent as its own runtime; the first calls it as a tool over MCP.
- **Teaches:** the in-process → distributed jump; independent deploy/scale; the real
  infra cost of distribution.

### 9. A2A-exposed agent
- Use the SDK's `a2a/express-server` to expose an agent with an Agent Card, callable
  over the A2A protocol.
- **Teaches:** the open inter-agent standard (what MuleSoft Agent Fabric and others
  speak).

---

## Tier 4 — Capstone

### 10. Mini "agent fabric"
- A supervisor orchestrating 3–4 specialists (some in-process via `Graph`, one remote
  via A2A), with sessions for multi-turn context and the pipeline deploying it.
- **Teaches:** how the patterns compose into a real system.

---

## Suggested sequencing

Done as mini-iterations, env-flagged so each is reversible:

| Iteration | Project | Tier |
|-----------|---------|------|
| 1 | Supervisor + agent-as-tool ← **start here** | 1.1 |
| 2 | Conditional `Graph` router | 1.3 |
| 3 | Critic / reflection loop | 2.6 |
| 4 | Second runtime via MCP (first infra change) | 3.8 |
| 5 | A2A-exposed agent | 3.9 |

Each uses an orchestration env flag, defaults to a single agent, and rolls back by
flipping the flag — the same forward-compatible pattern as `SESSION_BUCKET` /
`AGENTCORE_GATEWAY_URL` in the sibling project.

> This table is the *conceptual* order by pattern tier. The **authoritative
> execution order** is [iteration-plan.md](iteration-plan.md), which inserts
> "deploy the supervisor" as iteration 2 (deploy is its own concern), shifting the
> later patterns down by one.

---

## Learning outside this stack

The canonical multi-agent learning projects are the same concepts above —
supervisor/router, debate (two agents argue, a judge decides), and role-play teams
(CEO/engineer/QA collaborating). Frameworks like LangGraph, CrewAI, and AutoGen have
tutorial versions. The concepts are identical; building them here has the bonus of
actually deploying to AWS.

---

## Current project

**Iteration 1 — Supervisor + specialists (agent-as-tool).** See
[iteration-plan.md](iteration-plan.md) for the Design → Develop → Test → Deploy →
Rollback breakdown.


## Agents testing site
https://www.a2d-ai.com/tester
