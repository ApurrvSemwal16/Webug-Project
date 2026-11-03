# ============================================
# Stage 1: Build the React frontend
# ============================================
FROM node:20-slim AS frontend-builder

WORKDIR /build/apps/web
COPY apps/web/package*.json ./
RUN npm install

COPY apps/web/ ./
COPY packages/types/ /build/packages/types/
COPY packages/types/ /packages/types/

# Fix the path alias for the build
RUN npm run build

# ============================================
# Stage 2: Final runtime (Playwright + Bun)
# ============================================
FROM mcr.microsoft.com/playwright:v1.52.0-noble

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

WORKDIR /app

# Copy engine package.json and install dependencies
COPY apps/engine/package.json ./apps/engine/
COPY packages/types/ ./packages/types/

# Create a minimal workspace package.json for bun
RUN echo '{"name":"agentqa-workspace","workspaces":["apps/engine","packages/types"]}' > /app/package.json

WORKDIR /app/apps/engine
RUN bun install

WORKDIR /app

# Copy engine source
COPY apps/engine/ ./apps/engine/

# Copy built frontend
COPY --from=frontend-builder /build/apps/web/dist ./apps/web/dist

# Create storage directory
RUN mkdir -p /app/.agentqa/runs

# Install curl for healthcheck
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD curl -f http://localhost:3001/api/health || exit 1

CMD ["bun", "run", "/app/apps/engine/src/server/index.ts"]
