# W-ONE web image — the renderer as a static site behind nginx, for a server
# deploy. The desktop app (Electron) is not containerized; the database runs
# from docker-compose.yml. Build: docker build -t w-one-web .
#
# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
# The web build needs no Electron binary and no native modules (node-pty).
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run web:build

FROM nginx:1.29-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/out/web /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz || exit 1
