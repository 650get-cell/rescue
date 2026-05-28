# Production container for the MarTech Rescue scheduler.
# Multi-stage so the final image only carries what's needed at runtime.

# ---- build stage: install production deps with reproducible lockfile ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- runtime stage ----
FROM node:20-alpine
WORKDIR /app

# Run as a non-root user
RUN addgroup -S app && adduser -S app -G app

# Bring in node_modules from the build stage, then the source
COPY --from=build /app/node_modules ./node_modules
COPY --chown=app:app server.js package.json ./
COPY --chown=app:app public ./public

# Persistence: bind-mount or named-volume this directory in production
RUN mkdir -p /app/data && chown -R app:app /app/data
VOLUME ["/app/data"]

USER app

# PORT is read by server.js (defaults to 3000). Override via -p and -e.
EXPOSE 3000
ENV NODE_ENV=production

# Healthcheck hits the root, which redirects to availability.html — a 302 is success.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:${PORT:-3000}/ || exit 1

CMD ["node", "server.js"]
