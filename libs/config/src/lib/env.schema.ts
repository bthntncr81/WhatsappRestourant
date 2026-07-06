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
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters')
    .default('your-super-secret-jwt-key-change-in-production'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // Super-admin (manager.superpersonel.com) — cross-tenant management panel.
  // Single fixed account, isolated from tenant users.
  ADMIN_EMAIL: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),

  // OpenAI
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_ORG_ID: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-5.2'),
  // OpenAI-uyumlu yerel LLM endpoint'i (or. Ollama http://127.0.0.1:11434/v1) - yalniz CHAT istemcileri kullanir
  OPENAI_BASE_URL: z.string().optional(),

  // iyzico Payment — fallback when tenant has not configured its own keys in
  // Settings. No defaults: prod must set these via env or tenant-level config.
  IYZICO_API_KEY: z.string().optional(),
  IYZICO_SECRET_KEY: z.string().optional(),
  IYZICO_BASE_URL: z.string().optional(),

  // iyzico native recurring subscription pricing-plan reference codes.
  // Created in the platform iyzico panel (Abonelik → ürün → ödeme planları).
  // Resolved by billing.service.ts → getPlanIyzicoRef(plan, cycle).
  IYZICO_SILVER_MONTHLY_REF: z.string().optional(),
  IYZICO_SILVER_ANNUAL_REF: z.string().optional(),
  IYZICO_GOLD_MONTHLY_REF: z.string().optional(),
  IYZICO_GOLD_ANNUAL_REF: z.string().optional(),
  IYZICO_PLATINUM_MONTHLY_REF: z.string().optional(),
  IYZICO_PLATINUM_ANNUAL_REF: z.string().optional(),

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

