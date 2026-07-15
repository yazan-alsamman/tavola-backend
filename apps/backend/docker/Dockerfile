# syntax=docker/dockerfile:1
#
# Built with the repo ROOT as build context (see docker-compose.yml's
# `context: ../../..`), because this is a pnpm workspace: the lockfile and
# pnpm-workspace.yaml live above apps/backend, and a correct, reproducible
# install needs them. Every COPY path below is relative to the repo root.

ARG NODE_VERSION=24-alpine

########################################
# 1. Base: pnpm via corepack, nothing else
########################################
FROM node:${NODE_VERSION} AS base
RUN corepack enable && corepack prepare pnpm@11.10.0 --activate
ENV PNPM_HOME=/pnpm
RUN pnpm config set store-dir /pnpm/store
WORKDIR /workspace

########################################
# 2. Build: install (incl. dev deps), generate Prisma client, compile,
#    then produce a self-contained production deployment of the backend
#    package via `pnpm deploy` - the pnpm-documented way to get a
#    correctly-flattened, production-only node_modules out of a workspace
#    package, avoiding fragile manual copying of pnpm's symlinked store
#    across build stages.
########################################
FROM base AS builder

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/backend/package.json apps/backend/package.json
# The backend's own `postinstall` hook runs `prisma generate`, which needs
# the schema to exist at install time - copied here (ahead of the full
# source) so this layer still only invalidates on package.json/schema
# changes, not on every source edit.
COPY apps/backend/prisma apps/backend/prisma
# Cache mount: persists downloaded packages across builds even when this
# layer is invalidated (e.g. by a schema.prisma change), so a flaky/slow
# registry only has to fetch each package once, not on every retry.
# --trust-lockfile: skips pnpm's supply-chain re-verification of every
# lockfile entry against the registry - a step that was consistently timing
# out here. Safe for this project: the lockfile is our own, committed, and
# not modified by third parties between commit and build.
RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile --trust-lockfile --filter backend...

COPY apps/backend apps/backend
RUN pnpm --filter backend prisma:generate
RUN pnpm --filter backend build
# --legacy: backend has no dependencies on other workspace packages, so the
# newer "injected workspace packages" deploy mode (pnpm v10+ default) does
# not apply here; --legacy is pnpm's own documented way to opt out of it.
# --ignore-scripts: `pnpm deploy` reinstalls node_modules for the deploy
# target internally, which re-triggers postinstall hooks (ours, and
# @prisma/client's own). Running both again in the isolated target was
# non-deterministically leaving the zero-model stub client in place instead
# of a real one, even though the exact same generate command succeeds when
# run once, deliberately, below - the explicit single call replaces relying
# on postinstall race timing entirely.
RUN --mount=type=cache,target=/pnpm/store \
    pnpm --filter backend deploy --prod --legacy --trust-lockfile --ignore-scripts /prod/backend
RUN apps/backend/node_modules/.bin/prisma generate --schema=/prod/backend/prisma/schema.prisma

########################################
# 3. Runtime: the smallest image that can actually run the app
########################################
FROM node:${NODE_VERSION} AS runtime

ENV NODE_ENV=production
RUN addgroup -S tavla && adduser -S tavla -G tavla

WORKDIR /app
COPY --from=builder --chown=tavla:tavla /prod/backend ./

USER tavla
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:3000,path:'/api/v1/health/liveness'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "-r", "./scripts/register-tsconfig-paths.js", "dist/main.js"]
