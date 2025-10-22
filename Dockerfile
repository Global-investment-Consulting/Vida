# syntax=docker/dockerfile:1

FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies first for better caching
COPY package*.json ./
RUN npm ci

# Generate Prisma client before building
COPY prisma ./prisma
RUN npx prisma generate

# Copy the rest of the source and build
COPY . .
RUN npm run build

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

ENV NODE_ENV=production HOST=0.0.0.0
EXPOSE 8080
CMD ["node","dist/src/server.js"]
