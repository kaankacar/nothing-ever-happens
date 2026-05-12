# Oracle service — schedules rounds, runs MiroFish simulator, signs verdicts.
# Persistent SQLite at /data.

FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Native deps for better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.33.4 --activate

# Workspace root files (lockfile must be precise)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
# Shared package + oracle service
COPY packages ./packages
COPY services/oracle ./services/oracle

# Install only the oracle + shared package deps
RUN pnpm install --frozen-lockfile --filter @mirofish/oracle... --filter @mirofish/shared

# Explicitly run the better-sqlite3 install script — pnpm skips it by default
# under the build-script-allowlist policy, and `pnpm rebuild` silently no-ops
# if the package's build script never executed.
RUN cd $(pnpm root -w)/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 \
    && npm run install \
    && test -f build/Release/better_sqlite3.node \
    && echo "better-sqlite3 native binding built at $(pwd)"

FROM node:20-bookworm-slim
WORKDIR /app

# Runtime deps (no toolchain — smaller image)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app /app

# Persistent volume mount goes here.
ENV ORACLE_DB_PATH=/data/arena.db
RUN mkdir -p /data

WORKDIR /app/services/oracle
EXPOSE 4000

CMD ["npx", "tsx", "src/index.ts"]
