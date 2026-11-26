import { AuditChainVerificationResult } from '@grant-ledger/shared';
import { Injectable } from '@nestjs/common';
import { Kysely, Transaction } from 'kysely';
import { Database } from '../database/database.types';
import { computeAuditHash, GENESIS_PREV_HASH } from './audit-hash.util';

@Injectable()
export class AuditVerifierService {
  /**
   * Cryptographically verifies the unbroken SHA-256 hash chain for an organization.
   */
  async verifyTenantChain(
    dbOrTx: Kysely<Database> | Transaction<Database>,
    tenantId: string,
  ): Promise<AuditChainVerificationResult> {
    const records = await dbOrTx
      .selectFrom('audit_logs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('seq_no', 'asc')
      .execute();

    if (records.length === 0) {
      return { valid: true, checkedCount: 0 };
    }

    let expectedPrevHash = GENESIS_PREV_HASH;
    let expectedSeqNo = 1;

    for (const record of records) {
      const currentSeqNo = Number(record.seq_no);

      if (currentSeqNo !== expectedSeqNo) {
        return {
          valid: false,
          checkedCount: expectedSeqNo - 1,
          brokenAtSeqNo: currentSeqNo,
          reason: `Sequence break: expected ${expectedSeqNo}, found ${currentSeqNo}`,
        };
      }

      if (record.prev_hash !== expectedPrevHash) {
        return {
          valid: false,
          checkedCount: currentSeqNo - 1,
          brokenAtSeqNo: currentSeqNo,
          reason: `prev_hash mismatch: expected ${expectedPrevHash}, found ${record.prev_hash}`,
        };
      }

      // Recompute hash
      const recomputedHash = computeAuditHash({
        tenant_id: record.tenant_id,
        seq_no: currentSeqNo,
        actor_id: record.actor_id,
        actor_type: record.actor_type,
        action: record.action,
        entity_type: record.entity_type,
        entity_id: record.entity_id,
        before_state: record.before_state,
        after_state: record.after_state,
        prev_hash: record.prev_hash,
      });

      if (recomputedHash !== record.hash) {
        return {
          valid: false,
          checkedCount: currentSeqNo - 1,
          brokenAtSeqNo: currentSeqNo,
          reason: `Row content hash tampered at sequence ${currentSeqNo}`,
        };
      }

      expectedPrevHash = record.hash;
      expectedSeqNo++;
    }

    return {
      valid: true,
      checkedCount: records.length,
    };
  }
}
