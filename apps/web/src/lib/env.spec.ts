import { afterEach, describe, expect, it, vi } from 'vitest';
import { getApiBaseUrl } from './auth-session';
import { parseWebEnv } from './env';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('parseWebEnv', () => {
  it('defaults NEXT_PUBLIC_API_URL when omitted', () => {
    expect(parseWebEnv({})).toEqual({
      NEXT_PUBLIC_API_URL: 'http://localhost:3001',
    });
  });

  it('rejects malformed URLs', () => {
    expect(() => parseWebEnv({ NEXT_PUBLIC_API_URL: 'not-a-url' })).toThrow(/NEXT_PUBLIC_API_URL/);
  });

  it('uses the local API default when the server environment does not define a URL', () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', undefined);
    expect(getApiBaseUrl()).toBe('http://localhost:3001');
  });
});
