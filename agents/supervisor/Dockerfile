# syntax=docker/dockerfile:1.7
FROM --platform=linux/arm64 node:20-bookworm-slim AS build

WORKDIR /app
COPY package*.json tsconfig.json .npmrc ./
RUN npm install

COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---------- runtime ----------
FROM --platform=linux/arm64 node:20-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# Run as non-root (AgentCore best practice)
RUN useradd --create-home --uid 1001 agent
USER agent

EXPOSE 8080
# node-based check: node:20-bookworm-slim ships node but not wget/curl
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/ping').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/app.js"]
