# syntax=docker/dockerfile:1

FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies first for better caching
COPY package*.json ./
RUN npm ci && npm --workspace dashboard ci

# Generate Prisma client before building
COPY prisma ./prisma
RUN npx prisma generate

# Copy build metadata and source, then build
COPY build.env ./
# shellcheck disable=SC2034 -- build args used via ENV assignments
ARG COMMIT_SHA
ARG BUILT_AT
ARG VERSION
ENV COMMIT_SHA=${COMMIT_SHA} BUILT_AT=${BUILT_AT} npm_package_version=${VERSION}
COPY . .
RUN npm --workspace dashboard run build && npm run build

FROM node:20-alpine AS runner
WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Bring over build output, generated Prisma client, and static assets
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/public ./public
COPY --from=builder /app/docs ./docs
COPY --from=builder /app/dashboard/dist ./dashboard/dist
COPY --from=builder /app/build.env ./build.env
# shellcheck disable=SC2034 -- build args used via ENV assignments
ARG COMMIT_SHA
ARG BUILT_AT
ARG VERSION
ENV COMMIT_SHA=${COMMIT_SHA} BUILT_AT=${BUILT_AT} npm_package_version=${VERSION}

ENV NODE_ENV=production HOST=0.0.0.0
EXPOSE 8080
CMD ["node","dist/src/server.js"]
