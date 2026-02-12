import { config as dotenvConfig } from 'dotenv';
import { envSchema, EnvSchema } from './env.schema';
import { AppConfig } from './config.types';

let cachedConfig: AppConfig | null = null;

export function loadEnv(): EnvSchema {
  dotenvConfig();

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Invalid environment variables:');
    console.error(result.error.format());
    throw new Error('Invalid environment configuration');
  }

  return result.data;
}

export function getConfig(): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const env = loadEnv();

  cachedConfig = {
    server: {
      port: env.PORT,
      nodeEnv: env.NODE_ENV,
      apiPrefix: env.API_PREFIX,
      corsOrigin: env.CORS_ORIGIN,
    },
    database: {
      host: env.DATABASE_HOST,
      port: env.DATABASE_PORT,
      name: env.DATABASE_NAME,
      user: env.DATABASE_USER,
      password: env.DATABASE_PASSWORD,
      url: env.DATABASE_URL,
    },
    redis: {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
    },
    log: {
      level: env.LOG_LEVEL,
    },
    jwt: {
      secret: env.JWT_SECRET,
      expiresIn: env.JWT_EXPIRES_IN,
    },
    openai: {
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL,
    },
  };

  return cachedConfig;
}

export function resetConfig(): void {
  cachedConfig = null;
}

