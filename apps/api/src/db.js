// src/db.js
import { PrismaClient } from '@prisma/client';

let prisma = null;

// Only initialize Prisma when USE_DB=true (and DATABASE_URL exists)
const useDb = String(process.env.USE_DB || '').toLowerCase() === 'true';
if (useDb) {
  prisma = new PrismaClient();
  // Optional: verify connection early
  prisma.$connect().catch((e) => {
    console.error('[DB] Failed to connect:', e);
    process.exit(1);
  });
}

export { prisma, useDb };
