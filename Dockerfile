# syntax=docker/dockerfile:1
#
# W-ONE core image — the same core as the desktop app, headless: API
# (HTTP + WebSocket, device pairing) and the web UI on one port. The mobile
# app and browsers connect here. The database runs from docker-compose.yml.
#
#   docker build -t w-one .
#   docker run -p 127.0.0.1:7420:7420 -v wone-data:/data w-one
#   docker exec <container> node out/server/index.cjs pair   # pairing code

# The full image ships python3/make/g++: node-pty has no Linux prebuilds and
# compiles here. Electron itself is not needed.
FROM node:22-bookworm AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run web:build && npm run server:build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
# git for project detection (and the opt-in remote terminal). Overridable,
# e.g. --build-arg APT_PACKAGES= where no Debian mirror is reachable.
ARG APT_PACKAGES="git ca-certificates"
RUN if [ -n "$APT_PACKAGES" ]; then \
      apt-get update && apt-get install -y --no-install-recommends $APT_PACKAGES \
      && rm -rf /var/lib/apt/lists/*; \
    fi \
  && mkdir -p /data && chown node:node /data
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/out/server ./out/server
COPY --from=build --chown=node:node /app/out/web ./out/web
USER node
ENV NODE_ENV=production \
  WONE_HOME=/data \
  WONE_PORT=7420 \
  WONE_LAN=1 \
  SHELL=/bin/bash
EXPOSE 7420
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:7420/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "out/server/index.cjs"]
