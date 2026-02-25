export interface DatabaseConfig {
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
  url: string;
}

export interface RedisConfig {
  host: string;
  port: number;
}

export interface ServerConfig {
  port: number;
  nodeEnv: 'development' | 'production' | 'test';
  apiPrefix: string;
  corsOrigin: string;
}

export interface LogConfig {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
}

export interface JwtConfig {
  secret: string;
  expiresIn: string;
}

export interface OpenAIConfig {
  apiKey: string | undefined;
  orgId: string | undefined;
  model: string;
}

export interface AppConfig {
  server: ServerConfig;
  database: DatabaseConfig;
  redis: RedisConfig;
  log: LogConfig;
  jwt: JwtConfig;
  openai: OpenAIConfig;
}

