FROM node:22-slim AS base
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/page/package.json packages/page/
COPY packages/schemas/package.json packages/schemas/
COPY packages/framework/package.json packages/framework/
COPY packages/server/package.json packages/server/
RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/*/node_modules ./packages/*/node_modules
COPY . .
RUN pnpm build

FROM base AS runtime
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/packages/*/dist ./packages/*/dist
COPY --from=build /app/packages/*/package.json ./packages/*/
COPY --from=build /app/sites ./sites
EXPOSE 3000
CMD ["node", "packages/server/dist/index.js"]
