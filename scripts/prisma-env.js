/**
 * Prisma Environment Setup Script
 *
 * WHY THIS EXISTS:
 * - Prisma CLI commands (migrate, generate, studio, etc.) run independently of the application
 * - They don't execute TypeScript files like prisma.config.ts or env.ts
 * - Prisma CLI automatically loads .env files, but if DATABASE_URL isn't set and you only
 *   have DB_HOST, DB_PORT, etc., this script constructs DATABASE_URL before running Prisma
 *
 * This script ensures DATABASE_URL is available for Prisma CLI commands by constructing it
 * from individual DB environment variables if not already set in the .env file.
 */
require("dotenv").config();

// Construct DATABASE_URL if not provided directly
if (!process.env.DATABASE_URL) {
  const host = process.env.DB_HOST || "localhost";
  const port = process.env.DB_PORT || "5432";
  const name = process.env.DB_NAME || "streaming_dev";
  const user = process.env.DB_USER || "postgres";
  const password = process.env.DB_PASSWORD || "";

  // URL encode password to handle special characters
  const encodedPassword = encodeURIComponent(password);
  process.env.DATABASE_URL = `postgresql://${user}:${encodedPassword}@${host}:${port}/${name}`;
}

// Execute the Prisma command passed as arguments
const { execSync } = require("child_process");
const prismaCommand = process.argv.slice(2);

try {
  // Use execSync for better cross-platform compatibility
  execSync(`npx prisma ${prismaCommand.join(" ")}`, {
    stdio: "inherit",
    env: process.env,
  });
} catch (error) {
  // Exit with the same code as the command
  process.exit(error.status || 1);
}
