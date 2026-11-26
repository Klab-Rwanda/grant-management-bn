/**
 * Exact Decimal utility backed by BigInt scaled integer representation (default scale: 4).
 * Completely eliminates IEEE-754 floating point inaccuracies and enforces Rule 1 of AGENTS.md.
 */

const DEFAULT_SCALE = 4;
const DEFAULT_MULTIPLIER = 10000n; // 10^4

export class Decimal {
  private readonly value: bigint; // scaled by 10^DEFAULT_SCALE

  private constructor(scaledValue: bigint) {
    this.value = scaledValue;
  }

  static from(input: string | bigint | Decimal): Decimal {
    if (input instanceof Decimal) {
      return input;
    }
    if (typeof input === 'number') {
      throw new Error(
        'Decimal.from(number) is prohibited by Rule 1 of AGENTS.md. Pass a DecimalString instead.',
      );
    }
    if (typeof input === 'bigint') {
      return new Decimal(input * DEFAULT_MULTIPLIER);
    }

    const trimmed = input.trim();
    if (!trimmed || trimmed === 'NaN') {
      throw new Error(`Invalid decimal string: "${input}"`);
    }

    const isNegative = trimmed.startsWith('-');
    const cleanStr = isNegative ? trimmed.slice(1) : trimmed;

    const parts = cleanStr.split('.');
    if (parts.length > 2) {
      throw new Error(`Malformed decimal string: "${input}"`);
    }

    const intPart = parts[0] ?? '0';
    let fracPart = parts[1] ?? '';

    if (!/^\d+$/.test(intPart) || (fracPart && !/^\d+$/.test(fracPart))) {
      throw new Error(`Invalid characters in decimal string: "${input}"`);
    }

    // Pad or round fractional part to 4 digits
    if (fracPart.length < DEFAULT_SCALE) {
      fracPart = fracPart.padEnd(DEFAULT_SCALE, '0');
    } else if (fracPart.length > DEFAULT_SCALE) {
      // Truncate/round to 4 digits
      const nextDigit = Number(fracPart[DEFAULT_SCALE]);
      let keep = BigInt(fracPart.slice(0, DEFAULT_SCALE));
      if (nextDigit >= 5) {
        keep += 1n;
      }
      fracPart = keep.toString().padStart(DEFAULT_SCALE, '0');
    }

    const raw = BigInt(intPart) * DEFAULT_MULTIPLIER + BigInt(fracPart);
    return new Decimal(isNegative ? -raw : raw);
  }

  static zero(): Decimal {
    return new Decimal(0n);
  }

  static readonly ZERO = new Decimal(0n);
  static readonly ONE = new Decimal(DEFAULT_MULTIPLIER);

  static add(a: Decimal | string, b: Decimal | string): Decimal {
    return Decimal.from(a).add(b);
  }

  static sub(a: Decimal | string, b: Decimal | string): Decimal {
    return Decimal.from(a).sub(b);
  }

  static subtract(a: Decimal | string, b: Decimal | string): Decimal {
    return Decimal.from(a).sub(b);
  }

  static mul(a: Decimal | string, b: Decimal | string): Decimal {
    return Decimal.from(a).mul(b);
  }

  static multiply(a: Decimal | string, b: Decimal | string): Decimal {
    return Decimal.from(a).mul(b);
  }

  static div(a: Decimal | string, b: Decimal | string): Decimal {
    return Decimal.from(a).div(b);
  }

  static divide(
    a: Decimal | string,
    b: Decimal | string,
    _fractionDigits = DEFAULT_SCALE,
  ): Decimal {
    return Decimal.from(a).div(b);
  }

  add(other: Decimal | string): Decimal {
    const o = Decimal.from(other);
    return new Decimal(this.value + o.value);
  }

  sub(other: Decimal | string): Decimal {
    const o = Decimal.from(other);
    return new Decimal(this.value - o.value);
  }

  mul(other: Decimal | string): Decimal {
    const o = Decimal.from(other);
    // (a * 10^4 * b * 10^4) / 10^4 = (a * b) * 10^4
    const prod = (this.value * o.value) / DEFAULT_MULTIPLIER;
    return new Decimal(prod);
  }

  div(other: Decimal | string): Decimal {
    const o = Decimal.from(other);
    if (o.value === 0n) {
      throw new Error('Division by zero');
    }
    // (a * 10^4 * 10^4) / (b * 10^4) = (a / b) * 10^4
    const quotient = (this.value * DEFAULT_MULTIPLIER) / o.value;
    return new Decimal(quotient);
  }

  neg(): Decimal {
    return new Decimal(-this.value);
  }

  abs(): Decimal {
    return new Decimal(this.value < 0n ? -this.value : this.value);
  }

  eq(other: Decimal | string): boolean {
    return this.value === Decimal.from(other).value;
  }

  gt(other: Decimal | string): boolean {
    return this.value > Decimal.from(other).value;
  }

  gte(other: Decimal | string): boolean {
    return this.value >= Decimal.from(other).value;
  }

  lt(other: Decimal | string): boolean {
    return this.value < Decimal.from(other).value;
  }

  lte(other: Decimal | string): boolean {
    return this.value <= Decimal.from(other).value;
  }

  isZero(): boolean {
    return this.value === 0n;
  }

  isPositive(): boolean {
    return this.value > 0n;
  }

  isNegative(): boolean {
    return this.value < 0n;
  }

  toFixed(fractionDigits = DEFAULT_SCALE): string {
    const isNeg = this.value < 0n;
    const absVal = isNeg ? -this.value : this.value;

    const intPart = (absVal / DEFAULT_MULTIPLIER).toString();
    const fracVal = (absVal % DEFAULT_MULTIPLIER).toString().padStart(DEFAULT_SCALE, '0');

    let formattedFrac = fracVal;
    if (fractionDigits < DEFAULT_SCALE) {
      formattedFrac = fracVal.slice(0, fractionDigits);
    } else if (fractionDigits > DEFAULT_SCALE) {
      formattedFrac = fracVal.padEnd(fractionDigits, '0');
    }

    const sign = isNeg ? '-' : '';
    return fractionDigits > 0 ? `${sign}${intPart}.${formattedFrac}` : `${sign}${intPart}`;
  }

  toString(): string {
    return this.toFixed(DEFAULT_SCALE);
  }

  toJSON(): string {
    return this.toFixed(DEFAULT_SCALE);
  }
}
