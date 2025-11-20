import { PrismaPg } from '@prisma/adapter-pg';

// Create the adapter for Prisma Client
export const adapter = new PrismaPg({
   connectionString: process.env.DATABASE_URL,
});