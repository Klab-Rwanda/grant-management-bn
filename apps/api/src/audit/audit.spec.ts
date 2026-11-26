import { describe, expect, it } from 'vitest';
import { computeAuditHash, GENESIS_PREV_HASH } from './audit-hash.util';

describe('AuditHashUtil', () => {
  it('computes deterministic SHA-256 hash irrespective of key order in state objects', () => {
    const payload1 = {
      tenant_id: '11111111-1111-1111-1111-111111111111',
      seq_no: 1,
      actor_id: '22222222-2222-2222-2222-222222222222',
      actor_type: 'USER',
      action: 'ORGANIZATION_CREATED',
      entity_type: 'Organization',
      entity_id: '11111111-1111-1111-1111-111111111111',
      before_state: null,
      after_state: { name: 'Acme', code: 'ACM', active: true },
      prev_hash: GENESIS_PREV_HASH,
    };

    const payload2 = {
      ...payload1,
      after_state: { active: true, code: 'ACM', name: 'Acme' }, // Reordered keys
    };

    const hash1 = computeAuditHash(payload1);
    const hash2 = computeAuditHash(payload2);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('detects state tampering with a completely different hash', () => {
    const original = {
      tenant_id: '11111111-1111-1111-1111-111111111111',
      seq_no: 1,
      actor_id: null,
      actor_type: 'SYSTEM',
      action: 'UPDATE',
      entity_type: 'Setting',
      entity_id: null,
      before_state: { val: 100 },
      after_state: { val: 200 },
      prev_hash: GENESIS_PREV_HASH,
    };

    const tampered = {
      ...original,
      after_state: { val: 201 },
    };

    expect(computeAuditHash(original)).not.toBe(computeAuditHash(tampered));
  });
});
