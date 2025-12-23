# FlowMint Server Dockerfile
# Multi-stage build for optimized production image

# ============================================
# Stage 1: Build Stage
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY server/package*.json ./server/
COPY app/package*.json ./app/

# Install dependencies
WORKDIR /app/server
RUN npm ci

WORKDIR /app/app
RUN npm ci

# Copy source code
WORKDIR /app
COPY server ./server
COPY app ./app

# Build server
WORKDIR /app/server
RUN npm run build 2>/dev/null || npx tsc

# Build frontend
WORKDIR /app/app
RUN npm run build

# ============================================
# Stage 2: Production Server
# ============================================
FROM node:20-alpine AS server

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S flowmint && \
    adduser -S flowmint -u 1001 -G flowmint

# Install production dependencies only
COPY --from=builder /app/server/package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy built application
COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/server/src ./src

# Create data directory for SQLite
RUN mkdir -p /app/data && chown -R flowmint:flowmint /app/data

# Switch to non-root user
USER flowmint

# Environment variables
ENV NODE_ENV=production
ENV PORT=3001
ENV DATABASE_URL=file:/app/data/flowmint.db

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/health || exit 1

# Expose port
EXPOSE 3001

# Start server
CMD ["node", "dist/index.js"]

# ============================================
# Stage 3: Production Frontend (Nginx)
# ============================================
FROM nginx:alpine AS frontend

# Copy nginx configuration
COPY docker/nginx.conf /etc/nginx/nginx.conf

# Copy built frontend
COPY --from=builder /app/app/.next/standalone ./app
COPY --from=builder /app/app/.next/static ./app/.next/static
COPY --from=builder /app/app/public ./app/public

# Create non-root user
RUN addgroup -g 1001 -S flowmint && \
    adduser -S flowmint -u 1001 -G flowmint && \
    chown -R flowmint:flowmint /app && \
    chown -R flowmint:flowmint /var/cache/nginx && \
    touch /var/run/nginx.pid && \
    chown -R flowmint:flowmint /var/run/nginx.pid

USER flowmint

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
