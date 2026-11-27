import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const DUMMY_SALT = Buffer.alloc(16, 0x5a);

@Injectable()
export class PasswordHasherService {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derivedKey = await this.derive(password, salt);
    return `scrypt$32768$8$1$${salt.toString('hex')}$${derivedKey.toString('hex')}`;
  }

  async verify(password: string, encodedHash: string | null): Promise<boolean> {
    const parts = encodedHash?.split('$') ?? [];
    const validFormat =
      parts?.length === 6 &&
      parts[0] === 'scrypt' &&
      parts[1] === '32768' &&
      parts[2] === '8' &&
      parts[3] === '1' &&
      /^[0-9a-f]{32}$/i.test(parts[4] ?? '') &&
      /^[0-9a-f]{128}$/i.test(parts[5] ?? '');
    const salt = validFormat ? Buffer.from(parts[4] ?? '', 'hex') : DUMMY_SALT;
    const expected = validFormat ? Buffer.from(parts[5] ?? '', 'hex') : Buffer.alloc(KEY_LENGTH);
    const actual = await this.derive(password, salt);
    return validFormat && timingSafeEqual(actual, expected);
  }

  private derive(password: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS, (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      });
    });
  }
}
