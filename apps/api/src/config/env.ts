import { Inject, Injectable } from '@nestjs/common';
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

const booleanFromEnv = z.enum(['true', 'false']).transform((val) => val === 'true');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((val) => val.startsWith('postgres://') || val.startsWith('postgresql://'), {
      message: 'DATABASE_URL must be a postgres:// or postgresql:// connection string',
    }),
  REDIS_URL: z
    .string()
    .min(1)
    .refine((val) => val.startsWith('redis://') || val.startsWith('rediss://'), {
      message: 'REDIS_URL must be a redis:// or rediss:// URL',
    }),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: booleanFromEnv.default('true'),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  SMTP_SECURE: booleanFromEnv.default('false'),
  SMTP_FROM: z.string().email(),
});

export type AppEnv = z.infer<typeof envSchema>;

export function parseEnv(rawEnv: Record<string, string | undefined>): AppEnv {
  const result = envSchema.safeParse(rawEnv);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return result.data;
}

export function loadAppEnv(): AppEnv {
  loadDotenv({ path: resolve(process.cwd(), '../../.env') });
  loadDotenv({ path: resolve(process.cwd(), '.env') });
  return parseEnv(process.env);
}

export const ENV_CONFIG = Symbol('ENV_CONFIG');

@Injectable()
export class EnvService {
  constructor(@Inject(ENV_CONFIG) public readonly config: AppEnv) {}
}
