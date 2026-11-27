import type { AuthUserContext, MembershipStatus, OrgStatus, Role } from '@grant-ledger/shared';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { Transaction } from 'kysely';
import { AuditLogService } from '../audit/audit.service';
import type { Database, TrancheReviewStatus } from '../database/database.types';

const transitions: Record<string, ReadonlySet<string>> = {
  'organization:ACTIVE': new Set(['SUSPENDED']),
  'organization:SUSPENDED': new Set(['ACTIVE']),
  'membership:ACTIVE': new Set(['SUSPENDED']),
  'membership:SUSPENDED': new Set(['ACTIVE']),
};

const trancheTransitions: Readonly<Record<string, ReadonlySet<string>>> = {
  'LOCKED:NOT_STARTED': new Set(['ACTIVE:DRAFT']),
  'ACTIVE:DRAFT': new Set(['ACTIVE:SUBMITTED_PENDING_REVIEW', 'CLOSED:CANCELLED']),
  'ACTIVE:CHANGES_REQUESTED': new Set(['ACTIVE:SUBMITTED_PENDING_REVIEW', 'CLOSED:CANCELLED']),
  'ACTIVE:SUBMITTED_PENDING_REVIEW': new Set([
    'ACTIVE:CHANGES_REQUESTED',
    'ACTIVE:VERIFIED_PENDING_APPROVAL',
    'CLOSED:CANCELLED',
  ]),
  'ACTIVE:VERIFIED_PENDING_APPROVAL': new Set([
    'ACTIVE:APPROVED_FOR_DISBURSEMENT',
    'ACTIVE:CHANGES_REQUESTED',
    'CLOSED:CANCELLED',
  ]),
  'ACTIVE:APPROVED_FOR_DISBURSEMENT': new Set([
    'CLOSED:DISBURSED_AND_RECONCILED',
    'CLOSED:CANCELLED',
  ]),
};

const submissionTransitions: Readonly<Record<string, ReadonlySet<string>>> = {
  SUBMITTED_PENDING_REVIEW: new Set(['CHANGES_REQUESTED', 'VERIFIED_PENDING_APPROVAL']),
  VERIFIED_PENDING_APPROVAL: new Set(['APPROVED_FOR_DISBURSEMENT']),
};

const milestoneTransitions: Readonly<Record<string, ReadonlySet<string>>> = {
  PENDING: new Set(['SUBMITTED']),
  REJECTED: new Set(['SUBMITTED']),
  SUBMITTED: new Set(['VERIFIED', 'REJECTED']),
};

const allocationTransitions: Readonly<Record<string, ReadonlySet<string>>> = {
  DRAFT: new Set(['SUBMITTED']),
  SUBMITTED: new Set(['APPROVED', 'REJECTED']),
  REJECTED: new Set(['DRAFT', 'DROPPED']),
};

export function isAllowedLifecycleTransition(
  entity: 'organization' | 'membership',
  from: string,
  to: string,
): boolean {
  return transitions[`${entity}:${from}`]?.has(to) ?? false;
}

export function isAllowedTrancheTransition(
  fromAvailability: string,
  fromReview: string,
  toAvailability: string,
  toReview: string,
): boolean {
  return (
    trancheTransitions[`${fromAvailability}:${fromReview}`]?.has(`${toAvailability}:${toReview}`) ??
    false
  );
}

export function isAllowedAllocationTransition(from: string, to: string): boolean {
  return allocationTransitions[from]?.has(to) ?? false;
}

@Injectable()
export class StateMachineService {
  constructor(private readonly auditLog: AuditLogService) {}

  async transitionWorkspace(
    tx: Transaction<Database>,
    actor: AuthUserContext,
    workspace: { id: string; status: OrgStatus },
    target: OrgStatus,
  ) {
    if (!isAllowedLifecycleTransition('organization', workspace.status, target)) {
      throw new BadRequestException(
        `Invalid workspace status transition: ${workspace.status} -> ${target}`,
      );
    }

    const updated = await tx
      .updateTable('organizations')
      .set({ status: target, updated_at: new Date().toISOString() })
      .where('id', '=', workspace.id)
      .returning(['id', 'legal_name', 'org_type', 'status'])
      .executeTakeFirstOrThrow();
    await this.auditLog.appendAuditLog(tx, {
      tenant_id: workspace.id,
      actor_id: actor.user_id,
      actor_type: 'USER',
      action:
        target === 'SUSPENDED' ? 'PLATFORM_WORKSPACE_SUSPENDED' : 'PLATFORM_WORKSPACE_REACTIVATED',
      entity_type: 'organization',
      entity_id: workspace.id,
      before_state: { status: workspace.status },
      after_state: { status: target },
    });
    return updated;
  }

  async transitionMembership(
    tx: Transaction<Database>,
    actor: AuthUserContext,
    membership: {
      id: string;
      tenant_id: string;
      user_id: string;
      role: Role;
      status: MembershipStatus;
    },
    target: Extract<MembershipStatus, 'ACTIVE' | 'SUSPENDED'>,
  ) {
    if (!isAllowedLifecycleTransition('membership', membership.status, target)) {
      throw new BadRequestException(
        `Invalid membership status transition: ${membership.status} -> ${target}`,
      );
    }

    const updated = await tx
      .updateTable('memberships')
      .set({ status: target, updated_at: new Date().toISOString() })
      .where('id', '=', membership.id)
      .returning(['id', 'tenant_id', 'user_id', 'role', 'status'])
      .executeTakeFirstOrThrow();
    await this.auditLog.appendAuditLog(tx, {
      tenant_id: membership.tenant_id,
      actor_id: actor.user_id,
      actor_type: 'USER',
      action:
        target === 'SUSPENDED'
          ? 'PLATFORM_MEMBERSHIP_SUSPENDED'
          : 'PLATFORM_MEMBERSHIP_REACTIVATED',
      entity_type: 'membership',
      entity_id: membership.id,
      before_state: { status: membership.status },
      after_state: { status: target },
    });
    return updated;
  }

  async transitionTranche(
    tx: Transaction<Database>,
    actor: AuthUserContext,
    tranche: {
      id: string;
      institution_tenant_id: string;
      startup_org_id: string;
      availability_status: 'LOCKED' | 'ACTIVE' | 'CLOSED';
      review_status: TrancheReviewStatus;
    },
    target: {
      availability_status: 'LOCKED' | 'ACTIVE' | 'CLOSED';
      review_status: TrancheReviewStatus;
      unlocked_at?: string | null;
      closed_at?: string | null;
    },
    action: string,
  ) {
    if (
      !isAllowedTrancheTransition(
        tranche.availability_status,
        tranche.review_status,
        target.availability_status,
        target.review_status,
      )
    ) {
      throw new BadRequestException(
        `Invalid tranche transition: ${tranche.availability_status}/${tranche.review_status} -> ${target.availability_status}/${target.review_status}`,
      );
    }

    const updated = await tx
      .updateTable('tranches')
      .set({
        availability_status: target.availability_status,
        review_status: target.review_status,
        ...(target.unlocked_at !== undefined ? { unlocked_at: target.unlocked_at } : {}),
        ...(target.closed_at !== undefined ? { closed_at: target.closed_at } : {}),
      })
      .where('id', '=', tranche.id)
      .where('availability_status', '=', tranche.availability_status)
      .where('review_status', '=', tranche.review_status)
      .returningAll()
      .executeTakeFirst();

    if (!updated) {
      throw new ConflictException('The tranche changed while this action was being processed');
    }

    await this.appendSharedLifecycleAudit(tx, actor, tranche, {
      action,
      entity_type: 'tranche',
      entity_id: tranche.id,
      before_state: {
        availability_status: tranche.availability_status,
        review_status: tranche.review_status,
      },
      after_state: {
        availability_status: target.availability_status,
        review_status: target.review_status,
      },
    });
    return updated;
  }

  async transitionSubmission(
    tx: Transaction<Database>,
    actor: AuthUserContext,
    submission: {
      id: string;
      institution_tenant_id: string;
      startup_org_id: string;
      status: TrancheReviewStatus;
    },
    target: 'CHANGES_REQUESTED' | 'VERIFIED_PENDING_APPROVAL' | 'APPROVED_FOR_DISBURSEMENT',
  ) {
    if (!submissionTransitions[submission.status]?.has(target)) {
      throw new BadRequestException(
        `Invalid submission transition: ${submission.status} -> ${target}`,
      );
    }

    const updated = await tx
      .updateTable('review_submissions')
      .set({ status: target })
      .where('id', '=', submission.id)
      .where('status', '=', submission.status)
      .returningAll()
      .executeTakeFirst();
    if (!updated) {
      throw new ConflictException('The submission changed while this action was being processed');
    }

    await this.appendSharedLifecycleAudit(tx, actor, submission, {
      action:
        target === 'CHANGES_REQUESTED'
          ? 'SUBMISSION_CHANGES_REQUESTED'
          : target === 'VERIFIED_PENDING_APPROVAL'
            ? 'SUBMISSION_VERIFIED'
            : 'DISBURSEMENT_AUTHORIZED',
      entity_type: 'review_submission',
      entity_id: submission.id,
      before_state: { status: submission.status },
      after_state: { status: target },
    });
    return updated;
  }

  async transitionMilestone(
    tx: Transaction<Database>,
    actor: AuthUserContext,
    milestone: {
      id: string;
      institution_tenant_id: string;
      startup_org_id: string;
      completion_status: 'PENDING' | 'SUBMITTED' | 'VERIFIED' | 'REJECTED';
    },
    target: 'SUBMITTED' | 'VERIFIED' | 'REJECTED',
    action: string,
  ) {
    if (!milestoneTransitions[milestone.completion_status]?.has(target)) {
      throw new BadRequestException(
        `Invalid milestone transition: ${milestone.completion_status} -> ${target}`,
      );
    }
    const updated = await tx
      .updateTable('milestones')
      .set({ completion_status: target })
      .where('id', '=', milestone.id)
      .where('completion_status', '=', milestone.completion_status)
      .returningAll()
      .executeTakeFirst();
    if (!updated) {
      throw new ConflictException('The milestone changed while this action was being processed');
    }
    await this.appendSharedLifecycleAudit(tx, actor, milestone, {
      action,
      entity_type: 'milestone',
      entity_id: milestone.id,
      before_state: { completion_status: milestone.completion_status },
      after_state: { completion_status: target },
    });
    return updated;
  }

  async transitionAllocation(
    tx: Transaction<Database>,
    actor: AuthUserContext,
    allocation: {
      id: string;
      tenant_id: string;
      institution_tenant_id: string;
      status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'DROPPED';
      locked_by_submission_id: string | null;
    },
    target: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'DRAFT' | 'DROPPED',
    submissionId: string | null,
  ) {
    if (!isAllowedAllocationTransition(allocation.status, target)) {
      throw new BadRequestException(
        `Invalid allocation transition: ${allocation.status} -> ${target}`,
      );
    }

    await sql`SELECT set_config('app.current_tenant_id', ${allocation.tenant_id}, true)`.execute(
      tx,
    );
    const updated = await tx
      .updateTable('line_item_allocations')
      .set({
        status: target,
        locked_by_submission_id:
          target === 'SUBMITTED' || target === 'APPROVED' ? submissionId : null,
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', allocation.id)
      .where('tenant_id', '=', allocation.tenant_id)
      .where('status', '=', allocation.status)
      .returningAll()
      .executeTakeFirst();
    if (!updated) {
      throw new ConflictException('The expense allocation changed while this action was processed');
    }

    await this.appendSharedLifecycleAudit(
      tx,
      actor,
      {
        institution_tenant_id: allocation.institution_tenant_id,
        startup_org_id: allocation.tenant_id,
      },
      {
        action: `GRANT_ALLOCATION_${target}`,
        entity_type: 'line_item_allocation',
        entity_id: allocation.id,
        before_state: { status: allocation.status },
        after_state: { status: target, locked_by_submission_id: updated.locked_by_submission_id },
      },
    );
    return updated;
  }

  async transitionDisbursement(
    tx: Transaction<Database>,
    actor: AuthUserContext,
    disbursement: {
      id: string;
      institution_tenant_id: string;
      startup_org_id: string;
      status: 'RECORDED_BY_INSTITUTION';
      recorded_by_user_id: string | null;
    },
  ) {
    if (disbursement.status !== 'RECORDED_BY_INSTITUTION') {
      throw new BadRequestException(`Invalid disbursement transition: ${disbursement.status}`);
    }
    const updated = await tx
      .updateTable('disbursements')
      .set({
        status: 'RECONCILED',
        confirmed_by_user_id: actor.user_id,
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', disbursement.id)
      .where('status', '=', 'RECORDED_BY_INSTITUTION')
      .where('recorded_by_user_id', '!=', actor.user_id)
      .returningAll()
      .executeTakeFirst();
    if (!updated) {
      throw new ConflictException(
        'The disbursement is not awaiting confirmation or the recorder cannot confirm it',
      );
    }
    await this.appendSharedLifecycleAudit(tx, actor, disbursement, {
      action: 'DISBURSEMENT_RECONCILED',
      entity_type: 'disbursement',
      entity_id: disbursement.id,
      before_state: { status: disbursement.status },
      after_state: { status: updated.status, confirmed_by_user_id: actor.user_id },
    });
    return updated;
  }

  private async appendSharedLifecycleAudit(
    tx: Transaction<Database>,
    actor: AuthUserContext,
    parties: { institution_tenant_id: string; startup_org_id: string },
    entry: {
      action: string;
      entity_type: string;
      entity_id: string;
      before_state: Record<string, unknown> | null;
      after_state: Record<string, unknown> | null;
    },
  ): Promise<void> {
    const tenantIds = new Set([parties.institution_tenant_id, parties.startup_org_id]);
    for (const tenantId of tenantIds) {
      await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`.execute(tx);
      await this.auditLog.appendAuditLog(tx, {
        tenant_id: tenantId,
        actor_id: actor.user_id,
        actor_type: 'USER',
        ...entry,
      });
    }
    await sql`SELECT set_config('app.current_tenant_id', ${actor.tenant_id}, true)`.execute(tx);
  }
}
