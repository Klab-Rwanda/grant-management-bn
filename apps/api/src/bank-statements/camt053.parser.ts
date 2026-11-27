import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { BadRequestException } from '@nestjs/common';

export interface ParsedBankTransaction {
  booking_date: string;
  amount: string;
  currency: string;
  direction: 'CREDIT' | 'DEBIT';
  bank_reference: string | null;
  remittance: string | null;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

export function parseCamt053(xml: string): ParsedBankTransaction[] {
  if (typeof xml !== 'string' || xml.length === 0 || xml.length > 1_000_000) {
    throw new BadRequestException('CAMT.053 statement must contain between 1 byte and 1 MB of XML');
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new BadRequestException('Document type and entity declarations are not supported');
  }
  const validation = XMLValidator.validate(xml);
  if (validation !== true) throw new BadRequestException('Statement is not valid XML');

  let parsed: unknown;
  try {
    parsed = xmlParser.parse(xml);
  } catch {
    throw new BadRequestException('Statement could not be parsed as CAMT.053');
  }
  const root = record(parsed);
  const document = record(root?.Document);
  const statement = record(document?.BkToCstmrStmt)?.Stmt;
  if (!statement) throw new BadRequestException('Statement does not contain a CAMT.053 statement');
  const statementRows = list(statement);
  const entries = statementRows.flatMap((row) => list(record(row)?.Ntry));
  if (entries.length === 0)
    throw new BadRequestException('Statement contains no entries to review');
  if (entries.length > 10_000) throw new BadRequestException('Statement contains too many entries');
  return entries.map(parseEntry);
}

function parseEntry(value: unknown): ParsedBankTransaction {
  const entry = record(value);
  if (!entry) throw new BadRequestException('Statement contains an invalid entry');
  const amountNode = record(entry.Amt);
  const amount = text(amountNode?.['#text']);
  const currencyValue = text(amountNode?.['@_Ccy']);
  const currency = currencyValue?.toUpperCase() ?? '';
  if (
    !amount ||
    !/^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/.test(amount) ||
    /^0(?:\.0{1,4})?$/.test(amount)
  ) {
    throw new BadRequestException(
      'Statement entries must have positive amounts with at most four decimals',
    );
  }
  if (!/^[A-Z]{3}$/.test(currency))
    throw new BadRequestException('Statement entry has an invalid currency');

  const direction = entry.CdtDbtInd;
  if (direction !== 'CREDIT' && direction !== 'DEBIT') {
    throw new BadRequestException('Statement entry has an invalid credit/debit indicator');
  }
  const bookingDate = dateValue(record(entry.BookgDt));
  if (!bookingDate)
    throw new BadRequestException('Statement entry is missing a valid booking date');

  const details = list(entry.NtryDtls).flatMap((detail) => list(record(detail)?.TxDtls));
  const transaction = record(details[0]);
  const references = record(transaction?.Refs);
  const remittanceInfo = record(transaction?.RmtInf);
  const remittanceValue = remittanceInfo?.Ustrd;
  const remittance = list(remittanceValue)
    .map(text)
    .filter((item): item is string => item !== null)
    .join(' ')
    .slice(0, 2000);

  return {
    booking_date: bookingDate,
    amount,
    currency,
    direction,
    bank_reference: text(entry.NtryRef) ?? text(entry.AcctSvcrRef) ?? text(references?.EndToEndId),
    remittance: remittance || null,
  };
}

function dateValue(value: Record<string, unknown> | null): string | null {
  const date = text(value?.Dt) ?? text(value?.DtTm);
  if (!date) return null;
  const normalized = date.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized
    ? null
    : normalized;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function list(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
