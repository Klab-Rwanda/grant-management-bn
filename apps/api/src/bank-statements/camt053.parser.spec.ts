import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { parseCamt053 } from './camt053.parser';

const statement = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <Stmt>
      <Ntry>
        <Amt Ccy="USD">123.4500</Amt>
        <CdtDbtInd>DEBIT</CdtDbtInd>
        <BookgDt><Dt>2026-10-31</Dt></BookgDt>
        <NtryRef>REF-001</NtryRef>
        <NtryDtls><TxDtls><RmtInf><Ustrd>Office supplies</Ustrd></RmtInf></TxDtls></NtryDtls>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

describe('parseCamt053', () => {
  it('preserves decimal strings and extracts transaction review metadata', () => {
    expect(parseCamt053(statement)).toEqual([
      {
        booking_date: '2026-10-31',
        amount: '123.4500',
        currency: 'USD',
        direction: 'DEBIT',
        bank_reference: 'REF-001',
        remittance: 'Office supplies',
      },
    ]);
  });

  it('rejects statements without entries instead of creating empty imports', () => {
    expect(() =>
      parseCamt053('<Document><BkToCstmrStmt><Stmt /></BkToCstmrStmt></Document>'),
    ).toThrow(BadRequestException);
  });

  it('rejects entity declarations and malformed entry amounts', () => {
    expect(() => parseCamt053(`<!DOCTYPE x [<!ENTITY x "x">]>${statement}`)).toThrow(
      BadRequestException,
    );
    expect(() => parseCamt053(statement.replace('123.4500', '9007199254740993'))).toThrow(
      BadRequestException,
    );
  });
});
