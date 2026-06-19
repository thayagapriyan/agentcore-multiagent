# syntax=docker/dockerfile:1.7
#
# Monorepo workspace build. Build context is the REPO ROOT (not this folder). Unlike
# the LLM agents, knowledge does NOT depend on packages/common — it serves MCP, not
# the /ping+/invocations wrapper — but the root + workspace manifests are still copied
# so npm resolves the workspace graph identically. The deploy workflow builds with
# `-f agents/knowledge/Dockerfile .` from the root.
FROM --platform=linux/arm64 node:20-bookworm-slim AS build

WORKDIR /app

# Workspace manifests first, for layer caching. npm needs the root manifest plus
# every workspace's package.json to resolve the workspace graph.
COPY package*.json .npmrc ./
COPY packages/common/package.json ./packages/common/
COPY agents/knowledge/package.json ./agents/knowledge/
RUN npm install

# Sources + tsconfig, then build the agent.
COPY agents/knowledge ./agents/knowledge
RUN npm run build --workspace knowledge \
  && npm prune --omit=dev

# ---------- runtime ----------
FROM --platform=linux/arm64 node:20-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

# install-strategy=nested keeps each workspace's deps under its own node_modules, so
# copy the root node_modules (shared tooling) plus the agent's nested node_modules
# (the MCP SDK + express + zod) and its built dist.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/agents/knowledge/package.json ./agents/knowledge/package.json
COPY --from=build /app/agents/knowledge/dist ./agents/knowledge/dist
COPY --from=build /app/agents/knowledge/node_modules ./agents/knowledge/node_modules

# Run as non-root (AgentCore best practice)
RUN useradd --create-home --uid 1001 agent
USER agent

# 8080 = MCP server (GET /ping, POST /mcp). No A2A door — knowledge is internal.
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/ping').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "agents/knowledge/dist/app.js"]
