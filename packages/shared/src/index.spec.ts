import { describe, expect, it } from 'vitest';
import {
  isInstitutionRole,
  isPlatformRole,
  isStartupRole,
  isValidDecimalString,
  Role,
} from './index';

describe('isValidDecimalString', () => {
  it('accepts valid integer and decimal strings', () => {
    expect(isValidDecimalString('0')).toBe(true);
    expect(isValidDecimalString('1250.00')).toBe(true);
    expect(isValidDecimalString('-42.5000')).toBe(true);
  });

  it('rejects malformed or float-formatted strings', () => {
    expect(isValidDecimalString('')).toBe(false);
    expect(isValidDecimalString('1,250.00')).toBe(false);
    expect(isValidDecimalString('12.34.56')).toBe(false);
    expect(isValidDecimalString('NaN')).toBe(false);
  });
});

describe('Role category helpers', () => {
  it('correctly maps roles to workspace scopes', () => {
    const startupRoles: Role[] = ['FDR', 'FIN', 'OPS'];
    const institutionRoles: Role[] = ['PM', 'REV', 'APR'];
    const platformRoles: Role[] = ['ADM'];

    for (const r of startupRoles) {
      expect(isStartupRole(r)).toBe(true);
      expect(isInstitutionRole(r)).toBe(false);
      expect(isPlatformRole(r)).toBe(false);
    }

    for (const r of institutionRoles) {
      expect(isStartupRole(r)).toBe(false);
      expect(isInstitutionRole(r)).toBe(true);
      expect(isPlatformRole(r)).toBe(false);
    }

    for (const r of platformRoles) {
      expect(isStartupRole(r)).toBe(false);
      expect(isInstitutionRole(r)).toBe(false);
      expect(isPlatformRole(r)).toBe(true);
    }
  });
});
