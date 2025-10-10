// src/config.js
import dotenv from 'dotenv';
dotenv.config();

export const PORT = process.env.PORT || 3001;
export const API_KEY = process.env.API_KEY || 'key_test_12345';
export const VAT_RATE = Number(process.env.VAT_RATE ?? 0.21);

// "true" -> DB (Prisma); anything else -> file store
export const USE_DB = String(process.env.USE_DB || 'false').toLowerCase() === 'true';

export const DATABASE_URL = process.env.DATABASE_URL || 'file:./dev.db';

// where the JSON store lives (relative to project root)
export function resolveFileDbPath() {
  // keep compatibility with your current structure
  // prefer ./data/db.json, fall back to ./db.json if you used that earlier
  return './data/db.json';
}
