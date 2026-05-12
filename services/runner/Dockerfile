# Runner service — manages hosted-prompt agents, signs commit/reveal txs.
# Persistent JSON store at /data.

FROM node:20-bookworm-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.33.4 --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY services/runner ./services/runner

RUN pnpm install --frozen-lockfile --filter @mirofish/runner... --filter @mirofish/shared

FROM node:20-bookworm-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app /app

ENV RUNNER_DB_PATH=/data/runner.json
RUN mkdir -p /data

WORKDIR /app/services/runner
EXPOSE 4001

CMD ["npx", "tsx", "src/index.ts"]
