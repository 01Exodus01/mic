FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat openssl tini

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# npm workspaces: root manifest plus each workspace manifest (and the schema for prisma generate)
COPY package.json package-lock.json* ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY backend/prisma ./backend/prisma/
RUN npm ci

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Dummy build-time secrets to allow Next.js static page analysis / prerender without real production secrets
ENV NEXTAUTH_SECRET=build_phase_dummy_secret_at_least_32_characters_long
ENV WORKER_SECRET=build_phase_dummy_secret_at_least_32_characters_long
ENV PARTICIPANT_SESSION_SECRET=build_phase_dummy_participant_secret_32_chars_min
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"

RUN npx prisma generate
RUN npm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Monorepo standalone output: server at frontend/server.js, dependencies at ./node_modules
# (if a frontend/public folder is added, also copy it to ./frontend/public)
COPY --from=builder --chown=nextjs:nodejs /app/frontend/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/frontend/.next/static ./frontend/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/backend/prisma ./backend/prisma
COPY --from=builder --chown=nextjs:nodejs /app/backend/worker.js ./backend/worker.js
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts

USER nextjs

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "frontend/server.js"]
