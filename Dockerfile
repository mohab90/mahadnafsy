# API image — Node 22 LTS, matching DEPLOY.md and the release manifest.
#
# bookworm-slim rather than alpine: sharp and bcrypt are native modules with
# prebuilt glibc binaries. On musl they fall back to compiling from source,
# which needs a full toolchain in the image and breaks on any base bump.
FROM node:22-bookworm-slim AS deps

WORKDIR /app
COPY api/package.json api/package-lock.json ./
# npm ci from the lockfile, production only — the same dependency set the
# release gate audited. --ignore-scripts is deliberately NOT set: sharp needs
# its install script to place the right prebuilt binary.
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS runtime

# curl is used by the container healthcheck below.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3001

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY api/ ./

# Runs as the image's built-in unprivileged account. Nothing in the app writes
# to its own directory — uploads and cache belong on mounted volumes.
USER node

EXPOSE 3001

# /api/health/live answers without touching the database, so the container is
# reported unhealthy for being down rather than for a slow query.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl --fail --silent --max-time 4 http://127.0.0.1:3001/api/health/live || exit 1

CMD ["node", "server.js"]
