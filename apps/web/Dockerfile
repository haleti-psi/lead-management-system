# Build context = repo root:  docker build -f apps/web/Dockerfile .
FROM node:20-slim AS build
WORKDIR /repo
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build:shared && npm run build:web

# --- nginx static server + /api proxy (Cloud Run port 8080) ---
FROM nginx:1.27-alpine AS runtime
# nginx config is rendered from a template at startup (injects API_BACKEND_URL → /api proxy)
COPY apps/web/default.conf.template /etc/nginx/templates/default.conf.template
COPY apps/web/docker-entrypoint.sh /docker-entrypoint-lms.sh
RUN sed -i 's/\r$//' /docker-entrypoint-lms.sh && chmod +x /docker-entrypoint-lms.sh
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
ENTRYPOINT ["/docker-entrypoint-lms.sh"]
