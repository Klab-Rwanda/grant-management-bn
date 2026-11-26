import { describe, expect, it } from 'vitest';
import { Decimal } from './decimal';

describe('Decimal exact arithmetic', () => {
  it('correctly parses integer and decimal strings', () => {
    expect(Decimal.from('0').toString()).toBe('0.0000');
    expect(Decimal.from('12.5').toString()).toBe('12.5000');
    expect(Decimal.from('-42.1250').toString()).toBe('-42.1250');
    expect(Decimal.from('100.9999').toString()).toBe('100.9999');
  });

  it('rejects JS number inputs per Rule 1 of AGENTS.md', () => {
    expect(() => (Decimal.from as (val: unknown) => Decimal)(12.5)).toThrow(/prohibited/i);
  });

  it('performs exact addition and subtraction with zero floating-point drift', () => {
    // Famous float issue: 0.1 + 0.2 = 0.30000000000000004
    const a = Decimal.from('0.1000');
    const b = Decimal.from('0.2000');
    const sum = a.add(b);
    expect(sum.toString()).toBe('0.3000');
    expect(sum.eq('0.3000')).toBe(true);

    const diff = sum.sub(b);
    expect(diff.toString()).toBe('0.1000');
    expect(diff.eq(a)).toBe(true);
  });

  it('supports exact comparison, negation, and zero check', () => {
    const pos = Decimal.from('500.0000');
    const neg = Decimal.from('-500.0000');

    expect(pos.gt('499.9999')).toBe(true);
    expect(pos.gte('500.0000')).toBe(true);
    expect(pos.lt('500.0001')).toBe(true);
    expect(pos.neg().toString()).toBe('-500.0000');
    expect(pos.add(neg).isZero()).toBe(true);
  });

  it('multiplies and divides with correct scaling', () => {
    const rate = Decimal.from('1.5000');
    const amount = Decimal.from('100.0000');
    expect(amount.mul(rate).toString()).toBe('150.0000');
    expect(amount.mul(rate).div(rate).toString()).toBe('100.0000');
  });

  it('throws on division by zero', () => {
    expect(() => Decimal.from('100.0000').div('0')).toThrow(/division by zero/i);
  });
});
