# ============================================================================
# Build Stage
# ============================================================================
FROM node:18-alpine AS builder

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy root package files for monorepo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy server package.json
COPY server/package.json ./server/

# Install dependencies
RUN pnpm install --frozen-lockfile --filter server

# Copy server source code
COPY server/tsconfig.json ./server/
COPY server/src ./server/src

# Build server
WORKDIR /app/server
RUN pnpm build

# ============================================================================
# Production Stage
# ============================================================================
FROM node:18-alpine AS production

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy root package files for monorepo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy server package.json
COPY server/package.json ./server/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod --filter server

WORKDIR /app/server

# Copy built files from builder
COPY --from=builder /app/server/dist ./dist

# Create data directory for SQLite
RUN mkdir -p /app/server/data && chown -R nodejs:nodejs /app/server/data

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3001
ENV DATABASE_PATH=/app/server/data/flowmint.db

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/health || exit 1

# Start the application
CMD ["node", "dist/index.js"]
