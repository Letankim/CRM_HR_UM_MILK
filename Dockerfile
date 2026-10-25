# Build một image cho cả 3 service (api, worker, web); chọn service bằng lệnh chạy.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH TZ=Asia/Ho_Chi_Minh
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm deploy --filter @umbm/api --prod /out/api \
 && pnpm deploy --filter @umbm/worker --prod /out/worker

# ---- api ----
FROM base AS api
WORKDIR /app
COPY --from=build /out/api ./
ENV NODE_ENV=production
EXPOSE 4000
USER node
CMD ["node", "dist/server.js"]

# ---- worker ----
FROM base AS worker
WORKDIR /app
COPY --from=build /out/worker ./
ENV NODE_ENV=production
USER node
CMD ["node", "dist/index.js"]

# ---- web (Next.js standalone) ----
FROM base AS web
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
USER node
CMD ["node", "apps/web/server.js"]
