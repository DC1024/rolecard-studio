# Multi-stage production Dockerfile for RoleCard Studio (GHCR)
FROM --platform=$BUILDPLATFORM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY pnpm-lock.yaml* ./
COPY packages/shared/package.json packages/shared/tsconfig.json ./packages/shared/
COPY packages/core/package.json packages/core/tsconfig.json ./packages/core/
COPY packages/mcp/package.json packages/mcp/tsconfig.json ./packages/mcp/
COPY apps/server/package.json apps/server/tsconfig.json ./apps/server/
COPY apps/web/package.json apps/web/tsconfig.json ./apps/web/

RUN pnpm install --frozen-lockfile || pnpm install

COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts
COPY plugins ./plugins
COPY README.md ./

RUN pnpm -r build && node scripts/build-bundle.mjs

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV ROLECARD_DATA_DIR=/app/data
ENV ROLECARD_WEB_DIST=/app/public

COPY --from=builder /app/release/bundle/app ./

RUN mkdir -p /app/data/uploads && chown -R node:node /app
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]
