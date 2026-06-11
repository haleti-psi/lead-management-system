# Build context = repo root (monorepo):  docker build -f apps/api/Dockerfile .
FROM node:20-slim AS build
WORKDIR /repo
# manifests first (layer caching)
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci
# sources + build (shared before api)
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build:shared && npm run build:api

# --- production runtime ---
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/apps/api/dist apps/api/dist
USER node
EXPOSE 8080
CMD ["node", "apps/api/dist/main.js"]
