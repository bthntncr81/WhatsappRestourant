import path from 'path';
import { defineConfig } from 'prisma/config';
import dotenv from 'dotenv';

// Load .env file
dotenv.config({ path: path.join(__dirname, '.env') });

const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/whatres_db?schema=public';

export default defineConfig({
  earlyAccess: true,
  schema: path.join(__dirname, 'prisma/schema.prisma'),
  datasource: {
    url: databaseUrl,
  },
  migrate: {
    development: {
      url: databaseUrl,
    },
  },
});
