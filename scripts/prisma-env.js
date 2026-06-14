/**
 * Prisma Environment Setup Script
 *
 * Loads the correct .env.{NODE_ENV} file before running Prisma CLI commands,
 * matching the bootstrap logic in src/config/env.ts.
 */
const dotenv = require('dotenv');
const fs = require('fs');
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

function loadEnvFile(filename, override = false) {
   const filePath = path.resolve(process.cwd(), filename);
   if (fs.existsSync(filePath)) {
      dotenv.config({ path: filePath, override });
   }
}

function loadEnvFiles() {
   // Base local env, then environment-specific overrides, then local overrides
   loadEnvFile('.env');
   const envFile = getEnvFileForBootstrap();
   if (envFile) {
      loadEnvFile(envFile, true);
   }
   loadEnvFile('.env.local', true);
}

loadEnvFiles();

if (!process.env.DATABASE_URL) {
   const nodeEnv = process.env.NODE_ENV ?? 'development';
   const envFile = getEnvFileForBootstrap();
   console.error('DATABASE_URL is not set.');
   console.error(`Checked: .env${envFile ? `, ${envFile}` : ''}, .env.local (NODE_ENV=${nodeEnv})`);
   console.error('Copy .env.example to .env.development or set DATABASE_URL in .env');
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
