FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/page/package.json packages/page/
COPY packages/schemas/package.json packages/schemas/
COPY packages/framework/package.json packages/framework/
COPY packages/server/package.json packages/server/
COPY sites/en.wikipedia.org/package.json sites/en.wikipedia.org/
COPY sites/news.ycombinator.com/package.json sites/news.ycombinator.com/
RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/page/node_modules ./packages/page/node_modules
COPY --from=deps /app/packages/schemas/node_modules ./packages/schemas/node_modules
COPY --from=deps /app/packages/framework/node_modules ./packages/framework/node_modules
COPY --from=deps /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=deps /app/sites/en.wikipedia.org/node_modules ./sites/en.wikipedia.org/node_modules
COPY --from=deps /app/sites/news.ycombinator.com/node_modules ./sites/news.ycombinator.com/node_modules
COPY . .
RUN pnpm build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/page/node_modules ./packages/page/node_modules
COPY --from=deps /app/packages/schemas/node_modules ./packages/schemas/node_modules
COPY --from=deps /app/packages/framework/node_modules ./packages/framework/node_modules
COPY --from=deps /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=deps /app/sites/en.wikipedia.org/node_modules ./sites/en.wikipedia.org/node_modules
COPY --from=deps /app/sites/news.ycombinator.com/node_modules ./sites/news.ycombinator.com/node_modules
COPY --from=build /app/packages/page/dist ./packages/page/dist
COPY --from=build /app/packages/schemas/dist ./packages/schemas/dist
COPY --from=build /app/packages/framework/dist ./packages/framework/dist
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/sites/en.wikipedia.org/dist ./sites/en.wikipedia.org/dist
COPY --from=build /app/sites/news.ycombinator.com/dist ./sites/news.ycombinator.com/dist
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/page/package.json packages/page/
COPY packages/schemas/package.json packages/schemas/
COPY packages/framework/package.json packages/framework/
COPY packages/server/package.json packages/server/
COPY sites/en.wikipedia.org/package.json sites/en.wikipedia.org/
COPY sites/news.ycombinator.com/package.json sites/news.ycombinator.com/

EXPOSE 3000
CMD ["node", "packages/server/dist/index.js"]
