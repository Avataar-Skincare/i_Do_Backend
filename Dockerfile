# Multi-stage build: compile TypeScript in `build`, ship only dist/ + production
# dependencies in the final image. Built natively on the ring box (arm64 /
# Graviton); nothing here is architecture-specific.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3001}/health >/dev/null || exit 1
# Migrations run as a one-off before rollout, not on every start:
#   docker compose run --rm backend npm run migration:run:prod
CMD ["node", "dist/main.js"]
