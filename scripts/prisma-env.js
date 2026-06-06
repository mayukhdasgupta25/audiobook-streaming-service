/**
 * Prisma Environment Setup Script
 *
 * Loads the correct .env.{NODE_ENV} file before running Prisma CLI commands,
 * matching the bootstrap logic in src/config/env.ts.
 */
const dotenv = require('dotenv');
const path = require('path');
const { execSync } = require('child_process');

const ENV_FILE_BY_NODE_ENV = {
   development: '.env.development',
   test: null,
   testing: '.env.testing',
   staging: '.env.staging',
   production: '.env.production',
};

function getEnvFileForBootstrap() {
   const bootstrapEnv = process.env.NODE_ENV ?? 'development';
   return ENV_FILE_BY_NODE_ENV[bootstrapEnv] ?? `.env.${bootstrapEnv}`;
}

function loadEnvFiles() {
   const envFile = getEnvFileForBootstrap();
   if (envFile) {
      dotenv.config({ path: path.resolve(process.cwd(), envFile) });
   }
}

loadEnvFiles();

if (!process.env.DATABASE_URL) {
   console.error('DATABASE_URL is not set. Ensure the correct .env.{NODE_ENV} file exists.');
   process.exit(1);
}

const prismaCommand = process.argv.slice(2);

if (prismaCommand.length === 0) {
   console.error('Usage: node scripts/prisma-env.js <prisma-command> [args...]');
   process.exit(1);
}

try {
   execSync(`npx prisma ${prismaCommand.join(' ')}`, {
      stdio: 'inherit',
      env: process.env,
   });
} catch (error) {
   process.exit(error.status || 1);
}
