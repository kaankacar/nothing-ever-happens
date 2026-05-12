# Next.js web frontend — production build.

FROM node:20-bookworm-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.33.4 --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web

RUN pnpm install --frozen-lockfile --filter @mirofish/web... --filter @mirofish/shared

# NEXT_PUBLIC_* vars are baked at build time — pass them in via build args.
ARG NEXT_PUBLIC_ORACLE_URL
ARG NEXT_PUBLIC_RUNNER_URL
ARG NEXT_PUBLIC_LIVE_ROUND_CONTRACT_ID
ENV NEXT_PUBLIC_ORACLE_URL=$NEXT_PUBLIC_ORACLE_URL
ENV NEXT_PUBLIC_RUNNER_URL=$NEXT_PUBLIC_RUNNER_URL
ENV NEXT_PUBLIC_LIVE_ROUND_CONTRACT_ID=$NEXT_PUBLIC_LIVE_ROUND_CONTRACT_ID

WORKDIR /app/apps/web
RUN pnpm build

FROM node:20-bookworm-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.33.4 --activate

COPY --from=builder /app /app

WORKDIR /app/apps/web
EXPOSE 3000

CMD ["pnpm", "start"]
