# Iter 4 — A2A on the supervisor (the public door)

**Date**: 2026-06-09
**Branch**: `feat/iter-4-a2a-supervisor`
**Iteration plan reference**: [docs/iteration-plan.md § Iteration 4](../iteration-plan.md)

---

## Goal

Expose the supervisor over the A2A protocol (Agent Card + JSON-RPC) via the Strands SDK's `a2a` module, opt-in behind `A2A_ENABLED`, without touching the AgentCore `/ping`+`/invocations` contract.

---

## Prompts used

1. **Prompt**: `can you work on next iter for agentcore-multiagent project`
   **Why**: kick off the next planned iteration (iter 4 per the plan's tracking checklist). Claude read the iteration plan, inspected the SDK's `a2a` module APIs, designed, built, and tested the iteration autonomously.

---

## Decisions made

- **Decision**: the A2A server does **not** land in `packages/common` (deviation from the iteration plan's wording).
  **Alternatives considered**: (a) a generic A2A wrapper in `common` as the plan said; (b) making `common` depend on the Strands SDK.
  **Why**: iter 3 deliberately made `common` SDK-agnostic to avoid the SDK's 18-peer-dependency set. The "generic A2A wrapper" the plan wanted **already exists in the SDK** (`A2AExpressServer` from `@strands-agents/sdk/a2a/express`) — re-wrapping it in `common` would either duplicate the SDK or drag the SDK into `common`. The reusable piece is the SDK import; the per-agent piece (Agent Card, skills, wiring) is inherently per-agent and lives in `agents/supervisor/src/a2a.ts` (~70 lines). Future public agents repeat the same thin file with their own card.

- **Decision**: A2A listens on its **own port** (`A2A_PORT`, default 9000) alongside the 8080 contract, started from `app.ts` only when `A2A_ENABLED === 'true'`.
  **Alternatives considered**: mounting the A2A middleware on the existing 8080 Express app.
  **Why**: AgentCore's A2A protocol contract expects port 9000 (HTTP=8080, MCP=8000, A2A=9000), and a separate listener keeps rollback trivial — flag off, port closed, invoke path byte-identical.

- **Decision**: use `createMiddleware()` on our own Express listener instead of the SDK's `serve()`.
  **Alternatives considered**: `A2AExpressServer.serve()`.
  **Why**: `serve()` binds `127.0.0.1` by default (unreachable in a container) and overwrites the Agent Card's `url` with the bind address, which would clobber the `A2A_PUBLIC_URL` override. Our listener binds `0.0.0.0` and preserves the card URL.

- **Decision**: a fresh-supervisor-per-request facade implements `InvokableAgent` (`invoke`/`stream` each build a new supervisor via `createSupervisor()`).
  **Alternatives considered**: passing one long-lived `Agent` instance to `A2AExpressServer`.
  **Why**: the SDK's `A2AExecutor` holds a single agent for the server's lifetime, but a Strands `Agent` carries an invocation lock + conversation history — a shared instance would serialize and bleed state across concurrent A2A requests. Same isolation invariant the `/invocations` path has had since iter 1. (`InvokableAgent` isn't exported from the SDK root; derived as `A2AServerConfig['agent']`.)

- **Decision**: add `@a2a-js/sdk` as an explicit supervisor dependency.
  **Why**: it's a peer dependency of the Strands SDK that `legacy-peer-deps=true` (in `.npmrc` since iter 3) skips auto-installing, and the SDK's a2a express server imports `@a2a-js/sdk/server/express` at runtime. Installed 0.3.13; its express peer range `^4.21.2 || ^5.1.0` accepts our express 4.22.2.

- **Decision**: infra change is **env-var only** (`supervisor_a2a_enabled` Terraform variable, default `false`, mapped to `A2A_ENABLED` through the agent module's existing `environment_variables` passthrough). The runtime's `protocol_configuration` stays `HTTP`.
  **Alternatives considered**: switching `server_protocol` to `A2A` now.
  **Why**: flipping the protocol changes how `InvokeAgentRuntime` routes (A2A on 9000 instead of `/invocations` on 8080), which would break the existing smoke test and isn't reversible by flag-flip. External A2A reachability (the a2d-ai tester) additionally needs inbound auth a browser tester can satisfy (runtime endpoints are SigV4-only by default; that needs the OAuth/JWT `authorizer_configuration`). That's a deliberate, separate deploy decision — left as an open follow-up rather than bundled (one concern per iteration).

---

## Files created / modified

| File | Action | Notes |
|------|--------|-------|
| `agents/supervisor/src/a2a.ts` | added | Agent Card (skills derived from `ALL_SPECIALISTS`), fresh-per-request facade, A2A listener on `A2A_PORT` |
| `agents/supervisor/src/app.ts` | modified | starts A2A server when `A2A_ENABLED=true`; failure logged, never kills the invoke path |
| `agents/supervisor/package.json` | modified | + `@a2a-js/sdk ^0.3.10` |
| `agents/supervisor/Dockerfile` | modified | `EXPOSE 8080 9000` (documentation only) |
| `infra/variables.tf` | modified | + `supervisor_a2a_enabled` (bool, default false) |
| `infra/supervisor.tf` | modified | passes `A2A_ENABLED` via module `environment_variables` when enabled |
| `package-lock.json` | modified | lockfile for the new dep |
| `docs/prompts/iter-4.md` | added | this file |
| `CHANGELOG.md` | modified | iter-4 entry appended |

---

## Tests

Actual results, run locally (Node 20.16, live Bedrock calls with local AWS creds):

- [x] `npm install` → resolves, 0 vulnerabilities; `@a2a-js/sdk@0.3.13` in `agents/supervisor/node_modules`
- [x] `npm run build` (common + supervisor) clean; supervisor `npx tsc --noEmit` → exit 0
- [x] `terraform fmt -check -recursive` → clean; `terraform validate` → valid
- [x] Flag ON (`A2A_ENABLED=true`): boot logs `listening on :8080`, `2 specialists loaded`, `a2a: agent card + JSON-RPC listening on :9000`
- [x] `GET :9000/.well-known/agent-card.json` → card with name, version 0.1.0, protocolVersion 0.2.0, both specialist skills, `streaming: true`
- [x] A2A `message/send` `"what is 17 plus 25?"` → task `completed`, artifact `17 plus 25 equals **42**.`; log `delegating to math_specialist`
- [x] A2A `message/send` `"say hi to Priyan"` → friendly greeting artifact; log `delegating to greeting_specialist`
- [x] `POST :8080/invocations` `"what is 17 plus 25?"` → `{"result":"17 plus 25 equals **42**."}` (matches the A2A answer)
- [x] `POST :8080/invocations` empty prompt → 400 `{"error":"prompt is required"}`
- [x] Flag OFF (default): `/ping` → 200; port 9000 → connection refused (rollback proof)
- [x] ARM64 Docker build (`buildx --platform linux/arm64`) → success; container (`uname -m` → `aarch64`) with flag on serves `/ping` 200 + agent card on 9000

---

## Forward-compatibility check

- The pattern for every future public agent: import `A2AExpressServer` from the SDK, write a thin `src/a2a.ts` with that agent's card, gate on `A2A_ENABLED`. Internal sub-agents never get one.
- The agent module's `environment_variables` passthrough (built in iter 3) carried the flag with zero module changes — the same channel iter-5+ agents use for their own config.
- Card skills are derived from `ALL_SPECIALISTS`, so adding a specialist updates the card automatically.
- `A2A_PUBLIC_URL` is reserved for the deployed card URL once the runtime is externally reachable over A2A.

---

## Open questions / follow-ups

- [ ] **Deployed A2A reachability**: serving A2A externally on AgentCore needs (a) `protocol_configuration.server_protocol = "A2A"` on the runtime — which changes the invoke contract and smoke test — and (b) inbound auth the a2d-ai tester can satisfy (SigV4 by default; a browser tester needs the OAuth/JWT authorizer). Decide: flip the existing supervisor runtime, or stand up a second A2A-protocol runtime from the same image.
- [ ] The Strands SDK pins express `^5.1.0` as a peer; the repo is on express 4 (works — `@a2a-js/sdk` accepts both). Revisit when bumping express.

---

## Rollback

- Deployed: leave `supervisor_a2a_enabled` at its default `false` (or set it back) and re-apply — the container stops opening 9000; the invoke path was never touched.
- Code: revert the iter-4 commit. No Terraform resources were created or changed (env var only), so no state surgery.
