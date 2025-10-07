// src/config.js
import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: process.env.PORT || 3001,
  apiKey: process.env.API_KEY || 'key_test_12345',
  seller: {
    name: process.env.SELLER_NAME || 'Demo Seller Ltd',
    vatId: process.env.SELLER_VAT_ID || 'BE0123456789',
    peppolEndpoint: process.env.SELLER_PEPPOL_ENDPOINT || '1234567890123',
    city: process.env.SELLER_CITY || 'Brussels',
    zip: process.env.SELLER_ZIP || '1000',
    region: process.env.SELLER_REGION || 'Brussels-Capital',
    country: process.env.SELLER_COUNTRY || 'BE',
  },
  dataDir: process.env.DATA_DIR || 'data',
};
