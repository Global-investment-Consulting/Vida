// src/config.js
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const envBool = (v, def = false) => {
  if (v === undefined) return def;
  const s = String(v).toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
};

export const USE_DB = envBool(process.env.USE_DB, false); // default to file store
export const VAT_RATE = Number(process.env.VAT_RATE ?? 0.21);
export const PORT = Number(process.env.PORT ?? 3001);

// Windows-safe absolute path for the file DB: <repo>/data/db.json
const here = dirname(fileURLToPath(import.meta.url));
export const DB_FILE = join(here, '..', 'data', 'db.json');

// Access token the tests use for XML/PDF endpoints
export const TEST_ACCESS_TOKEN = process.env.TEST_ACCESS_TOKEN ?? 'key_test_12345';
