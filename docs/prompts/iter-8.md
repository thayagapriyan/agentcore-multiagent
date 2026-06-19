# Iter 8 — Second agent called over MCP (internal distribution)

**Date**: 2026-06-18
**Branch**: `feat/iter-8-second-agent-over-mcp`
**Iteration plan reference**: [docs/iteration-plan.md § Iteration 8](../iteration-plan.md)

---

## Goal

Demonstrate the in-process → distributed jump: a top agent (`researcher`) calls a
**separately deployed** specialist (`knowledge`) over **MCP across the runtime
boundary** — the first runtime-to-runtime call in the project. The knowledge agent is
internal (no A2A); only the researcher is public.

---

## Prompts used

1. **Prompt**: `okay proceed to build iter-8 without asking input or approval from my side. you need to run loop until you complete. consider all phase design, develop, unit test, github workflow, terraform, smoke testing, a2a token if need`
   **Why**: full pre-authorization to build iter 8 end to end autonomously.

2. **Context (prior turns)**: established that the three existing agents coordinate
   sub-agents **in-process** (agent-as-tool, Graph, code loop) — none crosses a runtime
   boundary; A2A proves cross-runtime only for an *external* caller. Iter 8's unique gap
   is one of *our own* agents calling another over MCP. Also confirmed MCP is not the
   only cross-runtime transport (A2A and signed `/invocations` also work) — MCP is
   chosen because it's the standard **tool** protocol and the one not yet demonstrated.

---

## Decisions made

- **Decision**: Two new deployables in one iteration — `agents/knowledge/` (MCP
  **server**) + `agents/researcher/` (MCP **client** / caller).
  **Alternatives considered**: (a) env-gated MCP tool on the existing supervisor;
  (b) Lambda-backed Gateway target like the sibling.
  **Why**: "demonstrate a cross-runtime MCP call" is a single concern that inherently
  needs both a server and a client. Adding the tool to the supervisor would touch the
  live public door and bend "never restructure an existing agent." A Lambda target
  (sibling pattern) makes the callee a Lambda, not a *deployable agent runtime* — the
  plan explicitly wants "a separate **agent runtime** over MCP." Two thin additive
  folders keep supervisor/router/critic byte-unchanged.

- **Decision**: The knowledge runtime sets `server_protocol = "MCP"` and serves the
  MCP StreamableHTTP transport on port 8080 via `@modelcontextprotocol/sdk` `./server`.
  **Alternatives considered**: AgentCore Gateway in front of the specialist.
  **Why**: AgentCore Runtime natively supports an MCP server protocol; this is the
  truest "a runtime *is* the MCP endpoint" shape and avoids a Gateway hop. The Strands
  SDK ships only the MCP **client** (`McpClient`); the **server** comes from the
  official `@modelcontextprotocol/sdk` (already present transitively, pinned explicitly).

- **Decision**: Knowledge exposes one **deterministic** tool `kb_lookup(topic)` (canned
  facts, no LLM).
  **Alternatives considered**: a real LLM specialist behind MCP.
  **Why**: a deterministic callee lets the smoke test assert *the cross-runtime hop
  happened* (the answer can only come from the remote tool) without LLM flakiness. The
  iteration's novelty is the transport, not the intelligence.

- **Decision**: Knowledge gets **no A2A door**; inbound auth `NONE` on its MCP runtime.
  **Alternatives considered**: give it A2A like the other agents.
  **Why**: the plan says internal sub-agents are not A2A-exposed. `NONE` mirrors the
  sibling's proven gateway choice (the Strands `McpClient` transport can't SigV4-sign);
  the researcher reaches it over the private hop.

- **Decision**: The researcher's MCP connection is gated on `KB_MCP_URL` (unset → 0
  remote tools, agent still answers). Mirrors the sibling's optional-`AGENTCORE_GATEWAY_URL`
  pattern.
  **Why**: always-green — `/invocations` must return a valid response even if the
  knowledge runtime is unreachable.

---

## Files created / modified

| File | Action | Notes |
|------|--------|-------|
| `agents/knowledge/**` | added | MCP-server agent (deterministic kb_lookup tool) |
| `agents/researcher/**` | added | MCP-caller top agent + A2A door |
| `agents/*/test/*.test.ts` | added | Vitest unit tests for both agents |
| `agents/*/eval/promptfooconfig.yaml` | added | post-deploy quality evals |
| `infra/knowledge.tf` | added | `module "knowledge"` (MCP runtime) |
| `infra/researcher.tf` | added | `module "researcher"` (HTTP runtime) |
| `infra/researcher-a2a.tf` | added | researcher public A2A/JWT door |
| `infra/modules/agent/*` | modified | optional `server_protocol` + `authorizer_type` knobs |
| `infra/outputs.tf` / `infra/variables.tf` | modified | runtime_arns map + per-agent vars |
| `.github/workflows/{ci,deploy,get-a2a-token}.yml` | modified | typecheck/build/smoke/token |
| `docs/agents/{knowledge,researcher}/ARCHITECTURE.md` | added | per-agent docs |

---

## Tests

- [x] `npm test` → **54 passed** (was 34; +20 new: knowledge `kb.test.ts` 9, researcher `mcp-url.test.ts` 4 + `kb-auth.test.ts` 7). No AWS.
- [x] `tsc --noEmit` (knowledge, researcher) → both exit 0. Also `@multiagent/common` builds; existing agents unaffected.
- [x] `terraform fmt -check -recursive` → exit 0; `terraform init -backend=false` + `terraform validate` → "Success! The configuration is valid." (module's new optional `server_protocol` + `jwt_authorizer` validate; default-HTTP path unchanged for existing agents.)
- [x] **Local cross-runtime MCP hop (researcher `McpClient` → knowledge MCP server), no AWS/Bedrock**: knowledge server up, `tools/list` → `["kb_lookup"]`, `kb_lookup("mcp")` → exact fact "MCP (Model Context Protocol) is an open standard…", `kb_lookup("nope")` → deterministic not-found naming known topics. **HOP SMOKE: PASS** — proves the transport end to end. (Surfaced one real bug in my test harness: `McpClient.callTool(toolObject, args)` takes the tool object from `listTools`, not `{name}` — fixed.)
- [x] **ARM64 container (knowledge)**: `docker buildx --platform linux/arm64` built; container `uname -m` → `aarch64`; `/ping` → `{"status":"ok"}`; MCP `tools/list` → `kb_lookup` (full schema, SSE transport); `tools/call kb_lookup(a2a)` → the a2a fact; `GET /mcp` → 405 (stateless POST-only). Container removed after.
- [ ] Researcher ARM64 container: not built locally — identical Dockerfile pattern to the proven supervisor/router/critic images, and its `McpClient` was verified live above; built + smoke-tested by the pipeline on merge.
- [ ] Deployed smoke tests + post-deploy eval: pipeline on merge (knowledge MCP `tools/list` with a minted Cognito token; researcher invoke requiring "Model Context Protocol" in the grounded answer = proof of the live hop; researcher A2A card; researcher promptfoo eval).

---

## Forward-compatibility check

- The `runtime_arns` map gains `knowledge` + `researcher` keys (established extension point).
- The agent module's new `server_protocol` / `authorizer_type` variables default to the
  current HTTP/no-authorizer behavior — existing agents' plans are unchanged.
- `KB_MCP_URL` gating means the researcher composes with future MCP callees by adding URLs.

---

## Open questions / follow-ups

- [ ] Optional: scope the knowledge runtime's inbound auth beyond `NONE` (JWT/SigV4) in a hardening iteration.

---

## Rollback

- Whole iteration: `terraform destroy -target=module.researcher -target=module.knowledge` (+ researcher A2A runtime & Cognito pool). Existing agents untouched.
- Caller only: unset `KB_MCP_URL` on the researcher (falls back to 0 remote tools).
- Code: revert the iter-8 commit (supervisor/router/critic byte-unchanged).
