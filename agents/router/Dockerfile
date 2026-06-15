# syntax=docker/dockerfile:1.7
#
# Monorepo workspace build. Build context is the REPO ROOT (not this folder), so
# the image can see packages/common, which the router depends on. The deploy
# workflow builds with `-f agents/router/Dockerfile .` from the root.
FROM --platform=linux/arm64 node:20-bookworm-slim AS build

WORKDIR /app

# Workspace manifests first, for layer caching. npm needs the root manifest plus
# every workspace's package.json to resolve the workspace graph.
COPY package*.json .npmrc ./
COPY packages/common/package.json ./packages/common/
COPY agents/router/package.json ./agents/router/
RUN npm install

# Sources + tsconfigs, then build common before the agent (the agent imports it).
COPY packages/common ./packages/common
COPY agents/router ./agents/router
RUN npm run build --workspace @multiagent/common \
  && npm run build --workspace router \
  && npm prune --omit=dev

# ---------- runtime ----------
FROM --platform=linux/arm64 node:20-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

# install-strategy=nested keeps each workspace's deps under its own node_modules,
# so copy the whole tree: the root node_modules (holds the @multiagent/common
# symlink + shared tooling), the agent's nested node_modules (the Strands SDK + its
# peers, co-located so ESM resolution works), and each workspace's built dist.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/common/package.json ./packages/common/package.json
COPY --from=build /app/packages/common/dist ./packages/common/dist
COPY --from=build /app/packages/common/node_modules ./packages/common/node_modules
COPY --from=build /app/agents/router/package.json ./agents/router/package.json
COPY --from=build /app/agents/router/dist ./agents/router/dist
COPY --from=build /app/agents/router/node_modules ./agents/router/node_modules

# Run as non-root (AgentCore best practice)
RUN useradd --create-home --uid 1001 agent
USER agent

# 9000 = opt-in A2A door (A2A_ENABLED=true); inert when the flag is off
EXPOSE 8080 9000
# node-based check: node:20-bookworm-slim ships node but not wget/curl
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/ping').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "agents/router/dist/app.js"]
