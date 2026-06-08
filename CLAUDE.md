# agentcore-multiagent — Claude project guide

> **Read this file at the start of every session.** It defines how this project works and the conventions you must follow.

---

## Mission

A **multi-agent** proof-of-concept on **Amazon Bedrock AgentCore Runtime**: several
agents, each its own deployable, coordinated into a working system. This repo is a
**monorepo** — one Git repository, multiple deployable agents, shared infrastructure,
one CI/CD pipeline.

Sibling project [agentcore-solution1](../agentcore-solution1) is the single-agent
reference this builds on; reuse its proven patterns (Dockerfile, Express
`/ping`+`/invocations` wrapper, S3 sessions, OIDC CI/CD) rather than reinventing them.

---

## Tech stack (locked)

- **Node.js 20+** (ARM64 target — AgentCore requirement)
- **TypeScript 5.4+** with `"type": "module"` and `NodeNext` resolution
- **Strands Agents SDK** — including its multi-agent primitives (`Graph`, `Swarm`,
  agent-as-tool) and the `a2a` module for agent-to-agent interop
- **Express** for each agent's HTTP entrypoint on port `8080`
- **Docker buildx** for ARM64 container builds (one image per deployable agent)
- **Amazon ECR + Bedrock AgentCore Runtime + Gateway**
- **Terraform 1.10+** with AWS provider `>= 5.70.0` (backend uses `use_lockfile`)

Do not introduce alternatives without asking (no Python, no CDK, no Lambda packaging,
no CommonJS, no low-code/YAML-defined agent workflows — orchestration is **code**).

---

## How we work — iteration model

This project is built iteratively, like its sibling. Each change is a small,
additive iteration with **Design → Develop → Test → Deploy → Rollback** phases.

**Operating principles** (enforced):
- **Additive only** — never delete or rename a working feature in the same iteration
  that adds a new one.
- **Forward-compatible** — new iterations must not require old ones to change. Use
  optional env vars and feature flags (e.g. `ORCHESTRATION_MODE`, mirroring how
  `SESSION_BUCKET` / `AGENTCORE_GATEWAY_URL` work in the sibling project).
- **Always green** — every iteration ends with each deployed agent's `/ping`
  returning 200 and `/invocations` returning a valid response, even if stubbed.
- **Reversible** — every iteration has a documented rollback (Terraform target
  destroy, image tag revert, env-var flip).
- **One concern per iteration** — if tempted to bundle, split.

---

## Tracking convention (mandatory)

**Every iteration produces three artifacts in lockstep:**

1. **CHANGELOG.md** — append a new entry per iteration. Never edit past entries.
2. **docs/prompts/iter-N.md** — verbatim prompts, decisions (with alternatives),
   files touched, **actual** test results, forward-compatibility notes, rollback.
3. **Structured git commit** — message format:
   ```
   iter-N: <title>

   Prompts: docs/prompts/iter-N.md
   Iteration: N
   Tests: <one-line summary>
   ```

Branch name: `feat/iter-N-<slug>`.

(The `/iter-start` and `/iter-end` slash commands from the sibling project can be
ported here once the iteration plan exists.)

---

## Conventions you must follow

- **No ESLint / Prettier** yet (intentional — keep deps minimal until a later
  iteration asks for them).
- **ESM-first**: `"type": "module"` + NodeNext. No CommonJS.
- **ARM64 only** for Docker images. Always build with `--platform linux/arm64`.
- **No hardcoded secrets, regions, account IDs, or model IDs** — read everything from
  env vars or Terraform variables.
- **Orchestration lives in code** (Strands `Graph`/`Swarm`), never in YAML. The only
  YAML in this repo is GitHub Actions CI/CD.
- **Don't run** `terraform apply`, `terraform destroy`, `docker push`, `git push`, or
  `git commit` **without confirming with the user**.
- **No `--no-verify`**, no `--force` on git, no skipping hooks — ever, unless the user
  explicitly says so.
- **Don't add comments** that just describe what code does. Only comment when the
  *why* is non-obvious.
- **Don't create new markdown docs** without being asked.

---

## Repository layout (monorepo — intended shape)

> This is the target structure; it grows per iteration. Not all of it exists yet.

```
agentcore-multiagent/
├── CLAUDE.md                    ← you are here
├── AGENTS.md                    ← pointer to this file (tool-agnostic)
├── CHANGELOG.md                 ← human-readable history
├── package.json                 ← npm workspaces root (shared deps + per-agent)
├── tsconfig.base.json           ← shared TS config; each agent extends it
├── .gitignore, .dockerignore, .editorconfig, .nvmrc, .npmrc
├── .claude/                     ← shared permissions + commands
├── .github/workflows/           ← CI + deploy (builds/deploys each agent)
├── packages/
│   └── common/                  ← shared: Express wrapper, session storage, model
├── agents/
│   ├── supervisor/              ← one deployable (own Dockerfile, own runtime)
│   └── <specialist>/            ← additional deployable agents
├── infra/                       ← Terraform: per-agent ECR + runtime, shared role
└── docs/
    ├── iteration-plan.md        ← multi-agent roadmap
    └── prompts/                 ← prompt archive (one per iteration)
```

**Key decisions still open** (ask the user before assuming): how agents share code
(workspaces `common` package vs. per-agent copies), how deployed agents communicate
(MCP via Gateway vs. A2A vs. direct `invoke-agent-runtime`), and how many agents the
POC includes.

---

## When in doubt

- If a request seems to violate one of these conventions, **ask** before proceeding.
- If a convention seems wrong, **say so** — but don't silently break it.
- Reuse the sibling project's working patterns; don't reinvent solved problems.
