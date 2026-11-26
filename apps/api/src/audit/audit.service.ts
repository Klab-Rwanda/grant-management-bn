import { AuditLogInput } from '@grant-ledger/shared';
import { Injectable } from '@nestjs/common';
import { sql, Transaction } from 'kysely';
import { Database } from '../database/database.types';
import { computeAuditHash, GENESIS_PREV_HASH } from './audit-hash.util';

@Injectable()
export class AuditLogService {
  async appendAuditLog(tx: Transaction<Database>, entry: AuditLogInput) {
    return this.append(tx, entry);
  }

  /**
   * Appends an immutable audit entry inside a database transaction,
   * serializing chain sequence generation per tenant using an advisory transaction lock.
   */
  async append(tx: Transaction<Database>, entry: AuditLogInput) {
    // 1. Acquire tenant-level advisory transaction lock to guarantee sequential seq_no under concurrency
    await sql`SELECT pg_advisory_xact_lock(hashtext(${entry.tenant_id}))`.execute(tx);

    // 2. Fetch the latest sequence and hash for this tenant
    const latest = await tx
      .selectFrom('audit_logs')
      .select(['seq_no', 'hash'])
      .where('tenant_id', '=', entry.tenant_id)
      .orderBy('seq_no', 'desc')
      .limit(1)
      .executeTakeFirst();

    const seqNo = latest ? Number(latest.seq_no) + 1 : 1;
    const prevHash = latest ? latest.hash : GENESIS_PREV_HASH;

    // 3. Compute deterministic cryptographic hash
    const hash = computeAuditHash({
      tenant_id: entry.tenant_id,
      seq_no: seqNo,
      actor_id: entry.actor_id ?? null,
      actor_type: entry.actor_type,
      action: entry.action,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id ?? null,
      before_state: entry.before_state ?? null,
      after_state: entry.after_state ?? null,
      prev_hash: prevHash,
    });

    // 4. Insert the append-only record
    const inserted = await tx
      .insertInto('audit_logs')
      .values({
        tenant_id: entry.tenant_id,
        seq_no: seqNo,
        actor_id: entry.actor_id ?? null,
        actor_type: entry.actor_type,
        action: entry.action,
        entity_type: entry.entity_type,
        entity_id: entry.entity_id ?? null,
        before_state: entry.before_state ? JSON.stringify(entry.before_state) : null,
        after_state: entry.after_state ? JSON.stringify(entry.after_state) : null,
        ip: entry.ip ?? null,
        user_agent: entry.user_agent ?? null,
        prev_hash: prevHash,
        hash,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return inserted;
  }
}
