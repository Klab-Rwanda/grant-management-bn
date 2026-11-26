import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'kysely';
import { runner } from 'node-pg-migrate';
import { resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { ENV_CONFIG, parseEnv } from '../src/config/env';
import { DatabaseService } from '../src/database/database.service';

describe('PostgreSQL Foundation Integration (Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let dbService: DatabaseService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('grant_ledger_test')
      .withUsername('grant_ledger')
      .withPassword('grant_ledger_test')
      .start();

    const databaseUrl = container.getConnectionUri();

    await runner({
      databaseUrl,
      dir: resolve(__dirname, '../migrations'),
      direction: 'up',
      migrationsTable: 'pgmigrations',
      checkOrder: true,
      log: () => undefined,
    });

    const testEnv = parseEnv({
      NODE_ENV: 'test',
      API_PORT: '3001',
      LOG_LEVEL: 'silent',
      DATABASE_URL: databaseUrl,
      REDIS_URL: 'redis://localhost:6379',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'grant-ledger-vault',
      S3_ACCESS_KEY: 'minioadmin',
      S3_SECRET_KEY: 'minioadmin',
      S3_FORCE_PATH_STYLE: 'true',
      SMTP_HOST: 'localhost',
      SMTP_PORT: '1025',
      SMTP_SECURE: 'false',
      SMTP_FROM: 'noreply@grantledger.local',
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ENV_CONFIG)
      .useValue(testEnv)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    dbService = app.get(DatabaseService);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (container) {
      await container.stop();
    }
  });

  it('applies SQL migrations (pgcrypto) and executes Kysely queries', async () => {
    const result = await sql<{ extname: string; sample_uuid: string }>`
      SELECT extname, gen_random_uuid()::text AS sample_uuid
      FROM pg_extension
      WHERE extname = 'pgcrypto'
    `.execute(dbService.db);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.extname).toBe('pgcrypto');
    expect(result.rows[0]?.sample_uuid).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('serves GET /health as ok against real PostgreSQL', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      service: 'grant-ledger-api',
      checks: { postgres: 'up' },
    });
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});
