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

---

# Follow-up (2026-06-21) — researcher MCP hop reliability

## Prompt (verbatim)

> [promptfoo eval output pasted: researcher 1/3 passing — "What does the knowledge
> base say about MCP?" and "Tell me about AgentCore Runtime requirements." both FAIL;
> "What is the capital of France?" PASS] still it is failing

(Two rounds: the first eval showed refusals "I don't have access to a kb_lookup tool";
after the first fix the second eval showed the model emitting literal
`<function_calls><invoke name="kb_lookup">…` XML in its answer.)

## Problem

The post-deploy researcher eval failed 2/3. The agent did **not** ground its answers in
the `kb_lookup` MCP tool — first refusing ("no kb_lookup tool"), then (after the prompt
fix) **hallucinating the tool-call XML** with a wrong param name (`query` vs the real
`topic`). Hallucinated tool-call syntax is the tell-tale of *a tool the model was told to
use but that is not actually bound* — i.e. the researcher had **0 remote tools** at
invocation.

## Diagnosis (evidence, not inference)

This was **not** the iter-8 URL/port bugs — those fixes are confirmed correct. The
diagnosis came from two live probes:

1. **Live CloudWatch** (`/aws/bedrock-agentcore/runtimes/multiagent_researcher-vu8evXGmcU-DEFAULT`):
   interleaved `researcher: connected to knowledge MCP, 1 remote tool(s) loaded`
   (success) and `client=<strands-agents-ts-sdk>, error=<TypeError: fetch failed> | MCP
   server failed to connect` → `0 remote tool(s) loaded` (failure). At the exact eval
   timestamp (21:34:14) three instances logged `fetch failed`; the *same* instances
   recovered to `1 tool` at 21:34:28.
2. **Endpoint probe** (mint Cognito token → `tools/list` ×6 against `knowledge_mcp_url`):
   **6/6 HTTP 200, `kb_lookup` present**, ~1–2.5s. The knowledge server is rock-solid.

**Root cause:** a freshly-scaled AgentCore instance's *first* outbound MCP connect
occasionally fails with a bare `TypeError: fetch failed` (cold-start network race). With
`continueOnError` the SDK swallows it into a permanent `'failed'` state, and the
researcher's **one-shot memoized** `mcpClientPromise` froze that instance at 0 tools for
its whole life. Eval requests that landed on a stuck instance failed; others passed →
the nondeterminism.

Confirmed along the way (so it's not re-litigated): the Strands `ToolList` type is
`(Tool | McpClient | Agent | ToolList)[]`, so passing the `McpClient` object in
`tools: [client]` **is** the documented usage; `Agent.initialize()` calls
`client.listTools()` per MCP client — a failed connect with `continueOnError` simply
registers `[]`. The wiring was never wrong.

## Fix (decisions, with alternatives)

`agents/researcher/src/agent.ts` only — two changes:

1. **System prompt** — make `kb_lookup` mandatory for technical/project questions; tell
   the model its own recollection is unreliable; restrict the self-knowledge fallback to
   when the tool is genuinely *not wired*. (Alternative rejected: weaken the eval prompts
   to be more imperative like the smoke test — that hides the bug rather than fixing the
   agent; real users ask the non-leading way.)
2. **Cold-start resilience** — `buildKbClient` eagerly connects with **bounded retry**
   (`CONNECT_RETRIES=3`, `CONNECT_BACKOFF_MS=250` linear), returns the client only once
   `listTools()` yields ≥1 tool, else `null`; `getKbClient` **re-arms** (drops the memo)
   on `null` so a stuck instance retries on its next invocation. `logMcpStatus` updated:
   non-null ⇒ live. (Alternatives considered: (a) drop `continueOnError` → rejected,
   breaks always-green on a real outage; (b) eager connect at boot only → kept the boot
   probe but added per-invocation re-arm too, since cold instances can appear *after*
   boot; (c) a connection lock to prevent concurrent re-arm thundering-herd → rejected as
   over-engineering for a POC: redundant connects are bounded and self-correct.)

## Files touched

| File | Change | Why |
| --- | --- | --- |
| `agents/researcher/src/agent.ts` | modified | mandatory-tool prompt; retry-with-re-arm MCP client; matching `logMcpStatus` |

## Tests

- [x] `npx vitest run agents/researcher` → **11 passed** (kb-auth 7, mcp-url 4). The
  changed functions' exported signatures are unchanged, so the pure-seam tests still hold.
- [x] `tsc` build (researcher workspace) → clean.
- [x] Live knowledge-endpoint probe: Cognito token → `tools/list` ×6 → **6/6 HTTP 200,
  `kb_lookup` present** (ruled out a server-side flake before changing the client).
- [ ] Post-deploy researcher promptfoo eval green — the real end-to-end check. Runs only
  after the new researcher image deploys (pipeline on merge).

## Forward-compatibility

- `CONNECT_RETRIES` / `CONNECT_BACKOFF_MS` are local constants — tune without an API change.
- The **re-arm-on-failure** pattern is the template for any future memoized cross-runtime
  client that must survive a cold-start race.
- `resolveKbMcpUrl` still gates the unset-URL case, so re-arming never does wasted network
  work when MCP is intentionally not wired.

## Rollback (follow-up)

- Code-only: revert this commit (restores the one-shot memoized client + softer prompt).
  No infra change; all other agents and the researcher's env/wiring are untouched.
