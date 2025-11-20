import { PrismaPg } from '@prisma/adapter-pg';
// Import env config to ensure DATABASE_URL is constructed
import './env';

// Create the adapter for Prisma Client
// DATABASE_URL is guaranteed to be set by env.ts when this module is imported
export const adapter = new PrismaPg({
   connectionString: process.env.DATABASE_URL!,
});
