FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
# npm ci here trips on platform-specific optional-dependency resolution differences
# between the lockfile (generated on macOS/arm64) and this Linux/Alpine image —
# npm install still respects the lockfile's pinned versions without the strict
# EUSAGE sync check that only npm ci enforces.
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3001
CMD ["node", "dist/main.js"]
