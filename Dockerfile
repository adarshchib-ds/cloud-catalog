# ============================================
# Cloud Catalog - Production Dockerfile
# Multi-stage build for optimized image size
# ============================================

# ============================================
# Stage 1: Builder
# ============================================
FROM node:22-alpine AS builder

# Install pnpm
RUN npm install -g pnpm

# Set working directory
WORKDIR /app

# Copy dependency manifests
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/

# Install ALL dependencies (including devDependencies)
# We need devDependencies to compile TypeScript
RUN pnpm install --frozen-lockfile

# Copy application source
COPY . .

# Generate Prisma Client
RUN pnpm exec prisma generate

# Build the application (TypeScript -> JavaScript)
RUN pnpm run build

# ============================================
# Stage 2: Production
# ============================================
FROM node:22-alpine AS production

# Install pnpm
RUN npm install -g pnpm

# Set environment
ENV NODE_ENV=production
ENV PORT=8080

# Set working directory
WORKDIR /app

# Install only production dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile && pnpm store prune

# Copy compiled application from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/prisma ./prisma

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership to non-root user
RUN chown -R nodejs:nodejs /app
USER nodejs

# Expose application port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/api/v1/health/live', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["node", "dist/server.js"]