# Iter 4 — A2A on the supervisor (the public door)

**Date**: 2026-06-09
**Branch**: `feat/iter-4-a2a-supervisor`
**Iteration plan reference**: [docs/iteration-plan.md § Iteration 4](../iteration-plan.md)

---

## Goal

Expose the supervisor over the A2A protocol (Agent Card + JSON-RPC) via the Strands SDK's `a2a` module — locally behind `A2A_ENABLED`, and **publicly on AgentCore** via a second A2A-protocol runtime with Cognito JWT inbound auth — without touching the existing HTTP runtime's `/ping`+`/invocations` contract.

---

## Prompts used

1. **Prompt**: `can you work on next iter for agentcore-multiagent project`
   **Why**: kick off the next planned iteration (iter 4 per the plan's tracking checklist). Claude read the iteration plan, inspected the SDK's `a2a` module APIs, designed, built, and tested the container-level A2A support autonomously.

2. **Prompt**: `how to test this supervisior agent using a2a protocol`
   **Why**: understand the testing options. Claude laid out three levels: local curl, local + tunnel + a2d-ai tester, and deployed on AgentCore (which needed protocol + auth work).

3. **Prompt**: `my expectation is option 3 to use a2a protocol to call supervisor agent. please consider all necesary change to make it happen` (corrected from "option 2" mid-message)
   **Why**: extend the iteration to its planned deploy phase — the a2d-ai tester calling the **deployed** supervisor over A2A. Claude researched the AgentCore A2A protocol contract + JWT authorizer, then added the second runtime + Cognito auth + CI smoke test.

4. **Prompt**: `i got this endpoint but not token value , tell me exatly how to test this "<endpoint url>"`
   **Why**: post-deploy, how to actually call the live endpoint. Claude tested it live (card + math + greeting through the public endpoint, all passing) and documented the exact PowerShell steps; the token is minted on demand via `cognito-idp initiate-auth`, not stored anywhere.

5. **Prompt**: `can you add separate github workflow to get token and output it`
   **Why**: self-serve token minting from the Actions tab. Because the repo is **public**, the workflow publishes the token only encrypted (AES-256, `A2A_TOKEN_PASSPHRASE` repo secret) in the run summary — a raw token in logs would let anyone invoke the agent for an hour.

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

- **Decision**: public A2A = a **second runtime** (`aws_bedrockagentcore_agent_runtime.supervisor_a2a` in `infra/supervisor-a2a.tf`) from the **same image and execution role**, with `server_protocol = "A2A"` + Cognito JWT authorizer. The existing HTTP runtime keeps `server_protocol = "HTTP"`.
  **Alternatives considered**: flipping the existing runtime's protocol to `A2A`.
  **Why**: the protocol determines how `InvokeAgentRuntime` routes (A2A on 9000 at `/` vs HTTP on 8080 at `/invocations`) and the JWT authorizer **replaces** SigV4 — flipping in place would break the existing smoke test and every SigV4 caller, violating additive-only. Two runtimes from one image cost one extra serverless runtime (idle ≈ free) and roll back independently. Plain resource (not a second module instance) because the agent module creates its own ECR repo + role — this runtime deliberately *shares* the supervisor's.

- **Decision**: inbound auth = Cognito user pool with `USER_PASSWORD_AUTH` (app client without secret + one terraform-managed test user, password from `random_password`).
  **Alternatives considered**: client-credentials flow (resource server + hosted-UI domain + client secret); leaving SigV4.
  **Why**: SigV4 is unusable from a browser tester. `USER_PASSWORD_AUTH` is AWS's documented pattern for AgentCore JWT inbound auth, needs no hosted-UI domain or resource server, and a bearer token is one unauthenticated `cognito-idp initiate-auth` call — also what the CI smoke test uses. The runtime's `custom_jwt_authorizer` validates against the pool's OIDC discovery URL with `allowed_clients` = the app client id.

- **Decision**: the A2A listener also serves `GET /ping` on port 9000, and the card URL precedence is `AGENTCORE_RUNTIME_URL` → `A2A_PUBLIC_URL` → `http://localhost:<port>`.
  **Why**: AgentCore's A2A protocol contract health-checks `/ping` on 9000 (not 8080) — without it the A2A runtime would never go healthy. `AGENTCORE_RUNTIME_URL` is the env var AWS's own SDK helper uses for the deployed card URL; the runtime ARN has a random suffix so the URL can't be known before the first apply — `supervisor_a2a_public_url` is set on a follow-up apply (documented two-step; clients that use the endpoint URL they were given work regardless).

---

## Files created / modified

| File | Action | Notes |
|------|--------|-------|
| `agents/supervisor/src/a2a.ts` | added | Agent Card (skills derived from `ALL_SPECIALISTS`), fresh-per-request facade, A2A listener on `A2A_PORT` with `/ping` (AgentCore A2A health check), card-URL precedence |
| `agents/supervisor/src/app.ts` | modified | starts A2A server when `A2A_ENABLED=true`; failure logged, never kills the invoke path |
| `agents/supervisor/package.json` | modified | + `@a2a-js/sdk ^0.3.10` |
| `agents/supervisor/Dockerfile` | modified | `EXPOSE 8080 9000` (documentation only) |
| `infra/supervisor-a2a.tf` | added | Cognito pool/client/test-user + A2A-protocol runtime (same image/role, JWT authorizer) + endpoint/credential outputs |
| `infra/variables.tf` | modified | + `supervisor_a2a_enabled` (bool, default false), `supervisor_a2a_public_url` (string, default "") |
| `infra/supervisor.tf` | modified | passes `A2A_ENABLED` via module `environment_variables` when enabled |
| `infra/versions.tf` | modified | + `hashicorp/random` provider (test-user password) |
| `infra/.terraform.lock.hcl` | modified | random provider pin |
| `.github/workflows/deploy.yml` | modified | + A2A smoke test (Cognito token → fetch agent card through the public endpoint) |
| `.github/workflows/get-a2a-token.yml` | added | manual workflow minting a 1-hour bearer token; published **encrypted** with the `A2A_TOKEN_PASSPHRASE` repo secret (repo is public — never prints the raw token) |
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

Deployed-A2A additions (local verification):

- [x] `GET :9000/ping` → `{"status":"Healthy"}` (AgentCore A2A health-check contract)
- [x] Card URL precedence: with `AGENTCORE_RUNTIME_URL=https://example.test/runtimes/x/invocations/` the card advertises exactly that URL
- [x] A2A `message/send` `"what is 6 times 7?"` → `6 times 7 equals **42**.`
- [x] `terraform init` (random provider), `fmt -check -recursive`, `validate` → clean
- [x] `terraform plan` with the **live image tag** → **`5 to add, 0 to change, 0 to destroy`** — the new A2A stack only; the existing HTTP runtime byte-for-byte untouched (non-destructive proof)
Deployed (verified live against runtime `multiagent_supervisor_a2a-8OvFnkHKQx`):

- [x] Cognito `initiate-auth` (USER_PASSWORD_AUTH) → access token issued
- [x] `GET <endpoint>/.well-known/agent-card.json` with bearer token → card returned through the public endpoint; **card `url` already advertises the real public endpoint** — AgentCore injects `AGENTCORE_RUNTIME_URL` into the container, so the planned `supervisor_a2a_public_url` two-step apply is unnecessary
- [x] A2A `message/send` `"what is 17 plus 25?"` → state `completed`, artifact `17 plus 25 equals **42**.`
- [x] A2A `message/send` `"say hi to Priyan"` → friendly greeting artifact
- [x] a2d-ai tester (browser, A2A mode) with endpoint URL + bearer token — **verified by the user** ("this iteration looks good i verified everything")

---

## Forward-compatibility check

- The pattern for every future public agent: import `A2AExpressServer` from the SDK, write a thin `src/a2a.ts` with that agent's card, gate on `A2A_ENABLED`. Internal sub-agents never get one.
- The agent module's `environment_variables` passthrough (built in iter 3) carried the flag with zero module changes — the same channel iter-5+ agents use for their own config.
- Card skills are derived from `ALL_SPECIALISTS`, so adding a specialist updates the card automatically.
- `A2A_PUBLIC_URL` is reserved for the deployed card URL once the runtime is externally reachable over A2A.

---

## Open questions / follow-ups

- [x] ~~After the first deploy: set `supervisor_a2a_public_url` and re-apply so the Agent Card advertises the real public URL~~ — not needed: AgentCore injects `AGENTCORE_RUNTIME_URL` into the container and the card self-corrected on deploy (verified live). The variable stays as a manual override.
- [ ] Verify the a2d-ai tester supports a custom `Authorization: Bearer` header (its docs are a JS app and weren't inspectable). If it can't send the header, fallback testers: the official [a2a-inspector](https://github.com/a2aproject/a2a-inspector), or the curl/Python client in [docs](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-a2a.html).
- [ ] The Strands SDK pins express `^5.1.0` as a peer; the repo is on express 4 (works — `@a2a-js/sdk` accepts both). Revisit when bumping express.

---

## How to call the deployed A2A endpoint

```bash
cd infra
A2A_URL=$(terraform output -raw a2a_endpoint_url)
TOKEN=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id "$(terraform output -raw a2a_cognito_client_id)" \
  --auth-parameters USERNAME=a2a-tester,PASSWORD="$(terraform output -raw a2a_tester_password)" \
  --query 'AuthenticationResult.AccessToken' --output text)

# Agent card
curl -s "${A2A_URL}.well-known/agent-card.json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id: $(uuidgen)"

# JSON-RPC message/send
curl -s -X POST "$A2A_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id: $(uuidgen)" \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"message":{"kind":"message","messageId":"m1","role":"user","parts":[{"kind":"text","text":"what is 17 plus 25?"}]}}}'
```

For the a2d-ai tester: paste `a2a_endpoint_url` as the agent URL and supply the bearer token as the auth header. Tokens expire after 1 hour (re-run `initiate-auth`).

---

## Rollback

- Public A2A door only: `terraform destroy -target=aws_bedrockagentcore_agent_runtime.supervisor_a2a -target=aws_cognito_user_pool.a2a` (the user/client/password fall with the pool). The HTTP runtime and its smoke test are unaffected.
- Container flag (HTTP runtime): leave `supervisor_a2a_enabled` at its default `false` — the container never opens 9000.
- Code: revert the iter-4 commit. The HTTP runtime was never modified (plan with live tag: 0 changes to it).
