// src/config.js
import dotenv from 'dotenv';
dotenv.config();

export const PORT = process.env.PORT || 3001;
export const API_KEY = process.env.API_KEY || 'key_test_12345';
export const VAT_RATE = Number(process.env.VAT_RATE ?? '0.21');

export const DATA_PATH = 'data/db.json';
