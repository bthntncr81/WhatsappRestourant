import { z } from 'zod';

export const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3000'),

  // Database
  DATABASE_HOST: z.string().default('localhost'),
  DATABASE_PORT: z.string().transform(Number).default('5432'),
  DATABASE_NAME: z.string().default('whatres_db'),
  DATABASE_USER: z.string().default('postgres'),
  DATABASE_PASSWORD: z.string().default('postgres'),
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/whatres_db?schema=public'),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().transform(Number).default('6379'),

  // API
  API_PREFIX: z.string().default('/api'),
  CORS_ORIGIN: z.string().default('http://localhost:4200'),

  // Logging
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('debug'),

  // JWT
  JWT_SECRET: z.string().default('your-super-secret-jwt-key-change-in-production'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // OpenAI
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_ORG_ID: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-5.2'),

  // iyzico Payment
  IYZICO_API_KEY: z.string().default('sandbox-ifkcjkaPdtshoWkt36gjOwpZ9Z5XsUZM'),
  IYZICO_SECRET_KEY: z.string().default('sandbox-0PfKYCdPshA2ZhqfdGq6JxfB5dXQWeqa'),
  IYZICO_BASE_URL: z.string().default('https://sandbox-api.iyzipay.com'),
  IYZICO_PRODUCT_REF_CODE: z.string().default('4703db20-26dc-45e9-968b-aa0f0ee93b60'),

  // Encryption (for per-tenant WhatsApp credential storage)
  ENCRYPTION_KEY: z.string().optional(), // 32-byte hex key for AES-256-GCM

  // WhatsApp Meta Cloud API (fallback / global defaults)
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().default('whatres-verify-token'),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_API_VERSION: z.string().default('v21.0'),
  WHATSAPP_API_BASE_URL: z.string().default('https://graph.facebook.com/v21.0'),

  // App
  APP_BASE_URL: z.string().default('http://localhost:3000'),
});

export type EnvSchema = z.infer<typeof envSchema>;

