import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const validEnv = {
  NODE_ENV: 'test',
  API_PORT: '3001',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/grant_ledger',
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
};

describe('parseEnv', () => {
  it('parses valid environment configuration with typed coercions', () => {
    const parsed = parseEnv(validEnv);
    expect(parsed.API_PORT).toBe(3001);
    expect(parsed.S3_FORCE_PATH_STYLE).toBe(true);
    expect(parsed.SMTP_SECURE).toBe(false);
  });

  it('rejects missing or invalid DATABASE_URL', () => {
    expect(() => parseEnv({ ...validEnv, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
    expect(() => parseEnv({ ...validEnv, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  it('rejects out-of-range API_PORT', () => {
    expect(() => parseEnv({ ...validEnv, API_PORT: '70000' })).toThrow(/API_PORT/);
  });
});
