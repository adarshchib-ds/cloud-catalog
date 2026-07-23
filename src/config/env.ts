import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z
    .string()
    .transform(val => parseInt(val, 10))
    .default('5000'),
  APP_NAME: z.string().default('cloud-catalog'),
  API_VERSION: z.string().default('v1'),
  DATABASE_URL: z
    .string()
    .refine(
      url => url.startsWith('postgresql://'),
      'DATABASE_URL must be a valid PostgreSQL connection string',
    ),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']).default('info'),
  LOG_DIR: z.string().default('./logs'),
  CORS_ORIGINS: z
    .string()
    .transform(val => val.split(',').map(s => s.trim()))
    .default('http://localhost:3000,http://localhost:5000'),
});

const parsedEnv = envSchema.parse(process.env);

export const env = parsedEnv;

export type EnvConfig = z.infer<typeof envSchema>;
