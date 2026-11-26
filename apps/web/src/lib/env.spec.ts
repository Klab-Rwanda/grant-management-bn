import { describe, expect, it } from 'vitest';
import { parseWebEnv } from './env';

describe('parseWebEnv', () => {
  it('defaults NEXT_PUBLIC_API_URL when omitted', () => {
    expect(parseWebEnv({})).toEqual({
      NEXT_PUBLIC_API_URL: 'http://localhost:3001',
    });
  });

  it('rejects malformed URLs', () => {
    expect(() => parseWebEnv({ NEXT_PUBLIC_API_URL: 'not-a-url' })).toThrow(/NEXT_PUBLIC_API_URL/);
  });
});
