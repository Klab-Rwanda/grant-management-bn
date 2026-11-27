import { describe, expect, it } from 'vitest';
import {
  isAllowedAllocationTransition,
  isAllowedLifecycleTransition,
} from './state-machine.service';

describe('isAllowedLifecycleTransition', () => {
  it('allows reciprocal active/suspended transitions for workspaces and memberships', () => {
    expect(isAllowedLifecycleTransition('organization', 'ACTIVE', 'SUSPENDED')).toBe(true);
    expect(isAllowedLifecycleTransition('organization', 'SUSPENDED', 'ACTIVE')).toBe(true);
    expect(isAllowedLifecycleTransition('membership', 'ACTIVE', 'SUSPENDED')).toBe(true);
    expect(isAllowedLifecycleTransition('membership', 'SUSPENDED', 'ACTIVE')).toBe(true);

    expect(isAllowedLifecycleTransition('organization', 'ACTIVE', 'ACTIVE')).toBe(false);
    expect(isAllowedLifecycleTransition('membership', 'INVITED', 'ACTIVE')).toBe(false);
  });

  describe('isAllowedAllocationTransition', () => {
    it('allows rejected allocations to be repaired or explicitly dropped', () => {
      expect(isAllowedAllocationTransition('REJECTED', 'DRAFT')).toBe(true);
      expect(isAllowedAllocationTransition('REJECTED', 'DROPPED')).toBe(true);
      expect(isAllowedAllocationTransition('APPROVED', 'DROPPED')).toBe(false);
      expect(isAllowedAllocationTransition('DRAFT', 'DROPPED')).toBe(false);
    });
  });
});
