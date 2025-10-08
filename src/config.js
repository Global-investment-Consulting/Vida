// src/config.js
import dotenv from "dotenv";
dotenv.config();

export const API_KEY = process.env.API_KEY || "key_test_12345";

export const DB_PATH = process.env.DB_PATH || "./data/db.json";

// simple seller info for XML/PDF
export const SELLER = {
  name: process.env.SELLER_NAME || "VIDA SRL",
  country: process.env.SELLER_COUNTRY || "BE",
  vat: process.env.SELLER_VAT || "BE0123.456.789",
};

// 21% VAT for example
export const VAT_RATE = Number(process.env.VAT_RATE || 0.21);
