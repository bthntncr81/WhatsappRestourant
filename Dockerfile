# WhatRes API - Production Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Install build tools
RUN apk add --no-cache openssl python3 make g++

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json ./

# Install pnpm and dependencies
RUN npm install -g pnpm@9 && pnpm install --frozen-lockfile

# Copy source code
COPY apps/api ./apps/api
COPY libs ./libs

# Generate Prisma client
RUN cd apps/api && npx prisma generate

# Build API with esbuild directly (bypass Nx project graph)
RUN npx esbuild apps/api/src/main.ts \
  --bundle \
  --platform=node \
  --format=cjs \
  --outfile=dist/apps/api/main.js \
  --minify \
  --sourcemap \
  --external:@prisma/client \
  --external:bcrypt \
  --external:pino \
  --external:pino-pretty \
  --target=node20

# ---- Production Stage ----
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache openssl python3 make g++

# Copy Prisma schema and migrations
COPY --from=builder /app/apps/api/prisma ./prisma/

# Copy built output
COPY --from=builder /app/dist/apps/api/main.js ./dist/main.js
COPY --from=builder /app/dist/apps/api/main.js.map ./dist/main.js.map

# Install only runtime dependencies
RUN npm init -y && npm install @prisma/client@7 prisma@7 bcrypt@6 pino@8 pino-pretty@10 dotenv@16

# Generate Prisma client in production
RUN npx prisma generate --schema=./prisma/schema.prisma

ENV NODE_ENV=production
EXPOSE 3000

# Run migrations then start server
CMD sh -c "npx prisma migrate deploy --schema=./prisma/schema.prisma && node dist/main.js"
