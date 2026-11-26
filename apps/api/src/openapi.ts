import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from './app.module';
import { ENV_CONFIG, parseEnv } from './config/env';
import { buildOpenApiDocument } from './swagger';

function ensureOpenApiBuildEnv(): Record<string, string> {
  return {
    NODE_ENV: process.env.NODE_ENV ?? 'test',
    API_PORT: process.env.API_PORT ?? '3001',
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'silent',
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://openapi:openapi@localhost:5432/openapi',
    REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
    S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    S3_REGION: process.env.S3_REGION ?? 'us-east-1',
    S3_BUCKET: process.env.S3_BUCKET ?? 'openapi-bucket',
    S3_ACCESS_KEY: process.env.S3_ACCESS_KEY ?? 'openapi-access',
    S3_SECRET_KEY: process.env.S3_SECRET_KEY ?? 'openapi-secret',
    S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE ?? 'true',
    SMTP_HOST: process.env.SMTP_HOST ?? 'localhost',
    SMTP_PORT: process.env.SMTP_PORT ?? '1025',
    SMTP_SECURE: process.env.SMTP_SECURE ?? 'false',
    SMTP_FROM: process.env.SMTP_FROM ?? 'noreply@grantledger.local',
  };
}

async function generate(): Promise<void> {
  Object.assign(process.env, ensureOpenApiBuildEnv());

  const app = await NestFactory.create(AppModule, { logger: false });
  // Validate env config explicitly through parseEnv as well
  parseEnv(process.env);
  app.get(ENV_CONFIG);

  const document = buildOpenApiDocument(app);
  const outPath = resolve(process.cwd(), 'openapi.json');
  writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

  await app.close();
}

void generate();
