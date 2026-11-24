# syntax=docker/dockerfile:1

# Plato runs as one standalone Node server (§12.2).
FROM node:24-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# better-sqlite3 ships prebuilt binaries and loads them without compiling, but
# npm still runs `node-gyp rebuild` for its binding.gyp, which needs Python and
# a toolchain the slim image lacks. The other install scripts (esbuild's binary
# check, macOS-only fsevents) are not needed either.
RUN npm ci --ignore-scripts

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    PLATO_DB_PATH=/data/plato.db
# The SQLite file lives on a persistent volume mounted at /data.
RUN mkdir -p /data && chown node:node /data
# `npm run build` has already copied public/ and .next/static/ beside server.js.
COPY --from=build --chown=node:node /app/.next/standalone ./
USER node
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server.js"]
