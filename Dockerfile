# Stage 1: Build frontend
FROM node:20-slim AS frontend-builder

WORKDIR /app/apps/web
COPY apps/web/package.json apps/web/bun.lock* ./
RUN npm install

COPY apps/web/ ./
RUN npm run build

# Stage 2: Build engine
FROM oven/bun:1 AS engine-builder

WORKDIR /app
COPY apps/engine/package.json apps/engine/bun.lock* ./apps/engine/
RUN cd apps/engine && bun install

COPY apps/engine/ ./apps/engine/
COPY packages/types/ ./packages/types/
COPY .agentqa/ ./.agentqa/

# Stage 3: Final runtime
FROM mcr.microsoft.com/playwright:v1.52.0-noble

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

WORKDIR /app

# Copy engine
COPY --from=engine-builder /app/apps/engine ./apps/engine
COPY --from=engine-builder /app/node_modules ./node_modules
COPY --from=engine-builder /app/packages/types ./packages/types

# Copy frontend build
COPY --from=frontend-builder /app/apps/web/dist ./apps/web/dist

# Copy shared types
COPY packages/types/ ./packages/types/

# Create storage directory
RUN mkdir -p /app/.agentqa/runs

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3001/api/health || exit 1

CMD ["bun", "run", "apps/engine/src/server/index.ts"]
