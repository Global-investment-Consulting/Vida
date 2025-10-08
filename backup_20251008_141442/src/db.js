// src/db.js
import dotenv from 'dotenv';
dotenv.config(); // make sure DATABASE_URL is loaded before PrismaClient

import { PrismaClient } from '@prisma/client';
export const prisma = new PrismaClient();
