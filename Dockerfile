# syntax=docker/dockerfile:1.6
# ---------- Stage 1: (optional) build ----------
# If your portfolio has a build step (e.g. `npm run build`), uncomment this stage
# and change the COPY line in the runtime stage to copy from --from=builder.
#
# FROM node:20-alpine AS builder
# WORKDIR /app
# COPY package*.json ./
# RUN npm ci --no-audit --no-fund
# COPY . .
# RUN npm run build
# # Output is expected at /app/dist (Vite) or /app/build (CRA) — adjust below.

# ---------- Stage 2: runtime ----------
FROM nginx:1.27-alpine AS runtime

# Metadata
LABEL org.opencontainers.image.title="portfoliotracker" \
      org.opencontainers.image.description="Static portfolio site served by nginx" \
      org.opencontainers.image.source="https://github.com/OWNER/portfoliotracker" \
      org.opencontainers.image.licenses="MIT"

# Install curl for healthcheck (nginx:alpine doesn't ship it)
RUN apk add --no-cache curl tini \
 && rm -rf /var/cache/apk/*

# Custom nginx config (gzip, caching, security headers, SPA fallback)
COPY nginx.conf /etc/nginx/nginx.conf

# Copy static site contents.
# If you enabled the builder stage above, change this to:
#   COPY --from=builder /app/dist /usr/share/nginx/html
COPY --chown=nginx:nginx ./site/ /usr/share/nginx/html/

# Make nginx run as non-root: rewrite the default config dirs to be writable
# by the existing 'nginx' user (uid 101 in alpine image).
RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/log/nginx \
 && touch /var/run/nginx.pid \
 && chown nginx:nginx /var/run/nginx.pid

USER nginx

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["nginx", "-g", "daemon off;"]
