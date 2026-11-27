import { describe, expect, it } from 'vitest';
import { PasswordHasherService } from './password-hasher.service';

describe('PasswordHasherService', () => {
  const hasher = new PasswordHasherService();

  it('stores a salted password hash and verifies only the matching password', async () => {
    const hash = await hasher.hash('correct horse battery staple');

    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    await expect(hasher.verify('correct horse battery staple', hash)).resolves.toBe(true);
    await expect(hasher.verify('different password', hash)).resolves.toBe(false);
  });

  it('performs the password derivation for accounts without a valid hash and rejects them', async () => {
    await expect(hasher.verify('some password', null)).resolves.toBe(false);
    await expect(hasher.verify('some password', 'invalid')).resolves.toBe(false);
  });
});
