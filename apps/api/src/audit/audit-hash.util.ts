import { createHash } from 'node:crypto';

export const GENESIS_PREV_HASH = 'GENESIS' + '0'.repeat(57); // 64 hex-compatible characters

function canonicalStringify(val: unknown): string {
  if (val === null || val === undefined) {
    return 'null';
  }
  if (typeof val !== 'object') {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return `[${val.map((item) => canonicalStringify(item)).join(',')}]`;
  }
  const obj = val as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const parts = sortedKeys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(obj[key])}`);
  return `{${parts.join(',')}}`;
}

export interface AuditHashPayload {
  tenant_id: string;
  seq_no: number | string | bigint;
  actor_id: string | null;
  actor_type: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_state?: unknown;
  after_state?: unknown;
  prev_hash: string;
}

export function computeAuditHash(payload: AuditHashPayload): string {
  const serialized = [
    payload.prev_hash,
    payload.tenant_id,
    payload.seq_no.toString(),
    payload.actor_id ?? 'null',
    payload.actor_type,
    payload.action,
    payload.entity_type,
    payload.entity_id ?? 'null',
    canonicalStringify(payload.before_state),
    canonicalStringify(payload.after_state),
  ].join('|');

  return createHash('sha256').update(serialized, 'utf8').digest('hex');
}
