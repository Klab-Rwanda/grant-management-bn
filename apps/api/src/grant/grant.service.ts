import type { AuthUserContext } from '@grant-ledger/shared';
import { Decimal, isValidDecimalString } from '@grant-ledger/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { Transaction } from 'kysely';
import { AuditLogService } from '../audit/audit.service';
import { PasswordHasherService } from '../auth/password-hasher.service';
import { SegregationOfDutiesService } from '../auth/sod.service';
import type { Database, TrancheReviewStatus } from '../database/database.types';
import { TenantContextService } from '../database/tenant-context.service';
import { StateMachineService } from '../state-machine/state-machine.service';
import { EvidenceVaultService } from './evidence-vault.service';

const REJECTION_REASONS = new Set([
  'INVALID_RECEIPT',
  'INELIGIBLE_CATEGORY',
  'AMOUNT_MISMATCH',
  'DUPLICATE_CLAIM',
]);
const MILESTONE_REJECTION_REASONS = new Set([
  'MISSING_DELIVERABLE',
  'INVALID_DELIVERABLE',
  'MILESTONE_NOT_MET',
]);
const ATTESTATION_VERSION = 'grant-submission-v1';
const ATTESTATION_TEXT =
  'I attest that the expenses and milestone evidence in this frozen submission are complete and accurate to the best of my knowledge.';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface EligibleCategoryInput {
  code: string;
  name: string;
}

interface TrancheCategoryInput extends EligibleCategoryInput {
  capAmount: string;
  capPercentage?: string | null;
  varianceTolerancePct?: string;
}

interface TrancheMilestoneInput {
  code: string;
  title: string;
  dueDate: string;
  deliverableRequired?: boolean;
}

export interface CreateProgramInput {
  title: string;
  description?: string | null;
  totalPoolAmount: string;
  currency: string;
  varianceTolerancePct: string;
  eligibleCategories: EligibleCategoryInput[];
}

export interface CreateAwardInput {
  startupOrgId: string;
  title: string;
  awardedAmount: string;
  currency: string;
  tranches: Array<{
    amount: string;
    categories: TrancheCategoryInput[];
    milestones?: TrancheMilestoneInput[];
  }>;
}

export interface CreateAllocationInput {
  journalLineId: string;
  trancheBudgetLineId: string;
  allocatedAmount: string;
  fxRateToGrant: string;
}

export interface ReviewSubmissionInput {
  items: Array<{
    submissionItemId: string;
    decision: 'APPROVED' | 'REJECTED';
    reasonCode?: string;
    comment?: string;
  }>;
  milestones: Array<{
    milestoneId: string;
    decision: 'APPROVED' | 'REJECTED';
    reasonCode?: string;
    notes?: string;
  }>;
}

export interface RecordDisbursementInput {
  submissionId: string;
  bankReference: string;
  paidDate: string;
  amountPaid: string;
  fxRate: string;
  confirmationEvidenceDocumentId: string;
}

export interface RequestMetadata {
  ip?: string;
  userAgent?: string;
}

interface EvidenceSnapshot {
  document_id: string;
  storage_key: string;
  doc_type: string;
  sha256: string | null;
  size_bytes: string;
  created_at: string;
}

interface AllocationRow {
  allocation_id: string;
  tenant_id: string;
  institution_tenant_id: string;
  startup_org_id: string;
  journal_line_id: string;
  tranche_budget_line_id: string;
  allocated_amount: string;
  fx_rate_to_grant: string | null;
  converted_amount: string | null;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'DROPPED';
  locked_by_submission_id: string | null;
  tranche_amount: string;
  grant_currency: string;
  category_code: string;
  category_name: string;
  cap_amount: string;
  cap_percentage: string | null;
  variance_tolerance_pct: string;
  transaction_date: string;
  memo: string;
  account_type: string;
  amount_functional: string;
  functional_currency: string;
}

@Injectable()
export class GrantService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly auditLog: AuditLogService,
    private readonly stateMachine: StateMachineService,
    private readonly passwordHasher: PasswordHasherService,
    private readonly sod: SegregationOfDutiesService,
    private readonly vault: EvidenceVaultService,
  ) {}

  async listStartups(actor: AuthUserContext) {
    this.requireInstitution(actor);
    return await this.tenantContext.withTenantContext(actor.tenant_id, (tx) =>
      tx
        .selectFrom('organizations')
        .select(['id', 'legal_name', 'country', 'functional_currency'])
        .where('org_type', '=', 'STARTUP')
        .where('status', '=', 'ACTIVE')
        .orderBy('legal_name')
        .execute(),
    );
  }

  async listPrograms(actor: AuthUserContext) {
    this.requireInstitution(actor);
    return await this.tenantContext.withTenantContext(actor.tenant_id, (tx) =>
      tx
        .selectFrom('grant_programs')
        .select(['id', 'title', 'total_pool_amount', 'currency', 'status'])
        .where('tenant_id', '=', actor.tenant_id)
        .orderBy('created_at', 'desc')
        .execute(),
    );
  }

  async createProgram(actor: AuthUserContext, input: CreateProgramInput) {
    this.requireInstitution(actor);
    const title = this.requiredText(input?.title, 'Program title', 160);
    const description = this.optionalText(input?.description, 4000);
    const poolAmount = this.positiveMoney(input?.totalPoolAmount, 'Total program pool');
    const currency = this.currency(input?.currency);
    const tolerance = this.nonNegativeMoney(input?.varianceTolerancePct, 'Variance tolerance');
    const categories = this.validateCategories(input?.eligibleCategories);
    if (categories.length === 0) {
      throw new BadRequestException('At least one eligible cost category is required');
    }

    return await this.tenantContext.withTenantContext(actor.tenant_id, async (tx) => {
      const now = new Date().toISOString();
      const programId = randomUUID();
      const termVersionId = randomUUID();
      const program = await tx
        .insertInto('grant_programs')
        .values({
          id: programId,
          tenant_id: actor.tenant_id,
          title,
          description,
          total_pool_amount: poolAmount,
          currency,
          funding_model: 'REIMBURSEMENT',
          status: 'ACTIVE',
          created_at: now,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await tx
        .insertInto('grant_term_versions')
        .values({
          id: termVersionId,
          tenant_id: actor.tenant_id,
          grant_program_id: programId,
          version_number: 1,
          eligible_categories: JSON.stringify(categories),
          caps_per_tranche: JSON.stringify([]),
          variance_tolerance_pct: tolerance,
          effective_date: new Date().toISOString().slice(0, 10),
          created_by_user_id: actor.user_id,
        })
        .execute();

      await this.auditLog.appendAuditLog(tx, {
        tenant_id: actor.tenant_id,
        actor_id: actor.user_id,
        actor_type: 'USER',
        action: 'GRANT_PROGRAM_CREATED',
        entity_type: 'grant_program',
        entity_id: programId,
        after_state: {
          title,
          total_pool_amount: poolAmount,
          currency,
          eligible_category_count: categories.length,
          variance_tolerance_pct: tolerance,
        },
      });
      return { ...program, term_version_id: termVersionId, eligible_categories: categories };
    });
  }

  async createAward(actor: AuthUserContext, programId: string, input: CreateAwardInput) {
    this.requireInstitution(actor);
    this.requireUuid(programId, 'Program id');
    const startupId = this.requireUuid(input?.startupOrgId, 'Startup id');
    const title = this.requiredText(input?.title, 'Grant title', 160);
    const awardedAmount = this.positiveMoney(input?.awardedAmount, 'Awarded amount');
    const currency = this.currency(input?.currency);
    if (
      !Array.isArray(input?.tranches) ||
      input.tranches.length === 0 ||
      input.tranches.length > 20
    ) {
      throw new BadRequestException('An award must contain between 1 and 20 tranches');
    }

    return await this.tenantContext.withTenantContext(actor.tenant_id, async (tx) => {
      const program = await tx
        .selectFrom('grant_programs')
        .selectAll()
        .where('id', '=', programId)
        .where('tenant_id', '=', actor.tenant_id)
        .where('status', '=', 'ACTIVE')
        .executeTakeFirst();
      if (!program) throw new NotFoundException('Active grant program not found');
      if (program.funding_model !== 'REIMBURSEMENT') {
        throw new ConflictException('This lifecycle supports reimbursement grants only');
      }
      if (program.currency !== currency) {
        throw new BadRequestException('Award currency must match the grant program currency');
      }

      const startup = await tx
        .selectFrom('organizations')
        .select(['id', 'org_type', 'status'])
        .where('id', '=', startupId)
        .executeTakeFirst();
      if (!startup || startup.org_type !== 'STARTUP' || startup.status !== 'ACTIVE') {
        throw new BadRequestException('An active startup workspace is required');
      }

      const termVersion = await tx
        .selectFrom('grant_term_versions')
        .select(['id', 'eligible_categories', 'variance_tolerance_pct'])
        .where('tenant_id', '=', actor.tenant_id)
        .where('grant_program_id', '=', program.id)
        .orderBy('version_number', 'desc')
        .executeTakeFirst();
      if (!termVersion) throw new ConflictException('The grant program has no active terms');
      const allowedCategories = this.readCategories(termVersion.eligible_categories);
      const categoryCodes = new Set(allowedCategories.map((category) => category.code));

      const trancheInputs = input.tranches.map((tranche, index) => {
        const amount = this.positiveMoney(tranche?.amount, `Tranche ${index + 1} amount`);
        if (!Array.isArray(tranche.categories) || tranche.categories.length === 0) {
          throw new BadRequestException(
            `Tranche ${index + 1} requires at least one budget category`,
          );
        }
        const categories = tranche.categories.map((category) => {
          const code = this.requiredText(category?.code, 'Category code', 60);
          const name = this.requiredText(category?.name, 'Category name', 120);
          if (!categoryCodes.has(code)) {
            throw new BadRequestException(`Category '${code}' is not eligible for this program`);
          }
          const capAmount =
            category.capAmount === undefined
              ? '0.0000'
              : this.nonNegativeMoney(category.capAmount, `${name} cap`);
          const capPercentage =
            category.capPercentage == null
              ? null
              : this.nonNegativePercentage(category.capPercentage, `${name} cap percentage`);
          if (capAmount === '0.0000' && capPercentage === null) {
            throw new BadRequestException(`${name} requires a monetary or percentage cap`);
          }
          return {
            code,
            name,
            capAmount,
            capPercentage,
            varianceTolerancePct:
              category.varianceTolerancePct === undefined
                ? termVersion.variance_tolerance_pct
                : this.nonNegativeMoney(
                    category.varianceTolerancePct,
                    `${name} variance tolerance`,
                  ),
          };
        });
        if (new Set(categories.map((category) => category.code)).size !== categories.length) {
          throw new BadRequestException(`Tranche ${index + 1} has duplicate category codes`);
        }
        const milestones = this.validateMilestones(tranche.milestones ?? []);
        return { amount, categories, milestones };
      });

      const trancheTotal = trancheInputs.reduce(
        (total, tranche) => total.add(tranche.amount),
        Decimal.ZERO,
      );
      if (!trancheTotal.eq(awardedAmount)) {
        throw new BadRequestException('The tranche amounts must sum exactly to the awarded amount');
      }
      const existingAwards = await sql<{ total: string }>`
        SELECT COALESCE(SUM(awarded_amount), 0)::text AS total
        FROM grants
        WHERE institution_tenant_id = ${actor.tenant_id}
          AND grant_program_id = ${program.id}
      `.execute(tx);
      const nextPoolTotal = Decimal.from(existingAwards.rows[0]?.total ?? '0').add(awardedAmount);
      if (nextPoolTotal.gt(program.total_pool_amount)) {
        throw new BadRequestException('This award would exceed the program’s remaining pool');
      }

      const grantId = randomUUID();
      const now = new Date().toISOString();
      await tx
        .insertInto('grants')
        .values({
          id: grantId,
          institution_tenant_id: actor.tenant_id,
          startup_org_id: startupId,
          grant_program_id: program.id,
          term_version_id: termVersion.id,
          title,
          awarded_amount: awardedAmount,
          currency,
          status: 'ACTIVE',
          signed_at: null,
          created_at: now,
          updated_at: now,
        })
        .execute();

      const trancheIds: string[] = [];
      for (let index = 0; index < trancheInputs.length; index += 1) {
        const trancheInput = trancheInputs[index]!;
        const trancheId = randomUUID();
        trancheIds.push(trancheId);
        const sequenceOrder = index + 1;
        await tx
          .insertInto('tranches')
          .values({
            id: trancheId,
            grant_id: grantId,
            institution_tenant_id: actor.tenant_id,
            startup_org_id: startupId,
            sequence_order: sequenceOrder,
            amount: trancheInput.amount,
            currency,
            availability_status: sequenceOrder === 1 ? 'ACTIVE' : 'LOCKED',
            review_status: sequenceOrder === 1 ? 'DRAFT' : 'NOT_STARTED',
            version: 1,
            unlocked_at: sequenceOrder === 1 ? now : null,
            closed_at: null,
            created_at: now,
          })
          .execute();

        for (const category of trancheInput.categories) {
          await tx
            .insertInto('tranche_budget_lines')
            .values({
              id: randomUUID(),
              tranche_id: trancheId,
              institution_tenant_id: actor.tenant_id,
              startup_org_id: startupId,
              category_code: category.code,
              category_name: category.name,
              cap_amount: category.capAmount,
              cap_percentage: category.capPercentage,
              variance_tolerance_pct: category.varianceTolerancePct,
            })
            .execute();
        }

        for (const milestone of trancheInput.milestones) {
          await tx
            .insertInto('milestones')
            .values({
              id: randomUUID(),
              tranche_id: trancheId,
              institution_tenant_id: actor.tenant_id,
              startup_org_id: startupId,
              code: milestone.code,
              title: milestone.title,
              due_date: milestone.dueDate,
              completion_status: 'PENDING',
              owner_user_id: null,
              deliverable_required: milestone.deliverableRequired,
            })
            .execute();
        }

        if (sequenceOrder > 1) {
          await tx
            .insertInto('unlock_rules')
            .values({
              id: randomUUID(),
              tranche_id: trancheId,
              institution_tenant_id: actor.tenant_id,
              startup_org_id: startupId,
              prerequisite_tranche_id: trancheIds[index - 1]!,
              require_prev_disbursed_reconciled: true,
              prerequisite_milestone_id: null,
              require_milestone_verified: false,
            })
            .execute();
        }
      }

      await this.appendPartyAudit(tx, actor, actor.tenant_id, startupId, {
        action: 'GRANT_AWARDED',
        entity_type: 'grant',
        entity_id: grantId,
        after_state: {
          title,
          program_id: program.id,
          awarded_amount: awardedAmount,
          currency,
          tranche_count: trancheIds.length,
        },
      });
      return {
        id: grantId,
        title,
        awarded_amount: awardedAmount,
        currency,
        tranche_ids: trancheIds,
      };
    });
  }

  async listGrants(actor: AuthUserContext) {
    return await this.tenantContext.withTenantContext(actor.tenant_id, async (tx) => {
      const grants = await tx
        .selectFrom('grants')
        .innerJoin(
          'organizations as institutions',
          'institutions.id',
          'grants.institution_tenant_id',
        )
        .innerJoin('organizations as startups', 'startups.id', 'grants.startup_org_id')
        .select([
          'grants.id',
          'grants.title',
          'grants.status',
          'grants.awarded_amount',
          'grants.currency',
          'grants.institution_tenant_id',
          'grants.startup_org_id',
          'institutions.legal_name as institution_name',
          'startups.legal_name as startup_name',
          'grants.created_at',
        ])
        .orderBy('grants.created_at', 'desc')
        .execute();
      if (grants.length === 0) return [];
      const tranches = await tx
        .selectFrom('tranches')
        .select([
          'id',
          'grant_id',
          'sequence_order',
          'amount',
          'currency',
          'availability_status',
          'review_status',
        ])
        .where(
          'grant_id',
          'in',
          grants.map((grant) => grant.id),
        )
        .orderBy('sequence_order')
        .execute();
      return grants.map((grant) => ({
        ...grant,
        tranches: tranches.filter((tranche) => tranche.grant_id === grant.id),
      }));
    });
  }

  async getGrant(actor: AuthUserContext, grantId: string) {
    this.requireUuid(grantId, 'Grant id');
    return await this.tenantContext.withTenantContext(actor.tenant_id, async (tx) => {
      const grant = await tx
        .selectFrom('grants')
        .innerJoin(
          'organizations as institutions',
          'institutions.id',
          'grants.institution_tenant_id',
        )
        .innerJoin('organizations as startups', 'startups.id', 'grants.startup_org_id')
        .select([
          'grants.id',
          'grants.title',
          'grants.status',
          'grants.awarded_amount',
          'grants.currency',
          'grants.grant_program_id',
          'grants.institution_tenant_id',
          'grants.startup_org_id',
          'institutions.legal_name as institution_name',
          'startups.legal_name as startup_name',
        ])
        .where('grants.id', '=', grantId)
        .executeTakeFirst();
      if (!grant) throw new NotFoundException('Grant not found');

      const tranches = await tx
        .selectFrom('tranches')
        .selectAll()
        .where('grant_id', '=', grantId)
        .orderBy('sequence_order')
        .execute();
      const trancheIds = tranches.map((tranche) => tranche.id);
      if (trancheIds.length === 0) return { ...grant, tranches: [] };
      const budgetLines = await tx
        .selectFrom('tranche_budget_lines')
        .selectAll()
        .where('tranche_id', 'in', trancheIds)
        .orderBy('category_name')
        .execute();
      const milestones = await tx
        .selectFrom('milestones')
        .selectAll()
        .where('tranche_id', 'in', trancheIds)
        .orderBy('due_date')
        .execute();
      const disbursements = await tx
        .selectFrom('disbursements')
        .select([
          'id',
          'tranche_id',
          'submission_id',
          'status',
          'bank_reference',
          'paid_date',
          'amount_paid',
          'currency',
          'fx_rate',
          'confirmation_evidence_doc_id',
        ])
        .where('tranche_id', 'in', trancheIds)
        .orderBy('created_at', 'desc')
        .execute();
      const submissions = await tx
        .selectFrom('review_submissions')
        .select([
          'id',
          'tranche_id',
          'version_number',
          'status',
          'total_claimable_amount',
          'submitted_at',
        ])
        .where('grant_id', '=', grantId)
        .orderBy('version_number', 'desc')
        .execute();
      return {
        ...grant,
        tranches: tranches.map((tranche) => ({
          ...tranche,
          budget_lines: budgetLines.filter((line) => line.tranche_id === tranche.id),
          milestones: milestones.filter((milestone) => milestone.tranche_id === tranche.id),
          disbursements: disbursements.filter((item) => item.tranche_id === tranche.id),
          submissions: submissions.filter((submission) => submission.tranche_id === tranche.id),
        })),
      };
    });
  }

  async listEligibleJournalLines(actor: AuthUserContext) {
    this.requireStartup(actor);
    return await this.tenantContext.withTenantContext(actor.tenant_id, async (tx) => {
      const functionalCurrency = await tx
        .selectFrom('organizations')
        .select('functional_currency')
        .where('id', '=', actor.tenant_id)
        .executeTakeFirstOrThrow();
      const lines = await tx
        .selectFrom('journal_lines')
        .innerJoin('journal_entries', 'journal_entries.id', 'journal_lines.journal_entry_id')
        .innerJoin('accounts', 'accounts.id', 'journal_lines.account_id')
        .select([
          'journal_lines.id',
          'journal_entries.entry_date',
          'journal_entries.memo',
          'accounts.code as account_code',
          'accounts.name as account_name',
          'accounts.account_type',
          'journal_lines.debit',
          'journal_lines.currency as transaction_currency',
          'journal_lines.amount_functional',
        ])
        .where('journal_lines.tenant_id', '=', actor.tenant_id)
        .where('journal_entries.status', '=', 'POSTED')
        .where('journal_lines.debit', '>', '0')
        .where('accounts.account_type', 'in', ['EXPENSE', 'ASSET'])
        .where('accounts.is_archived', '=', false)
        .orderBy('journal_entries.entry_date', 'desc')
        .limit(200)
        .execute();
      if (lines.length === 0) return [];
      const existing = await tx
        .selectFrom('line_item_allocations')
        .select(['journal_line_id', 'allocated_amount', 'status'])
        .where('tenant_id', '=', actor.tenant_id)
        .where(
          'journal_line_id',
          'in',
          lines.map((line) => line.id),
        )
        .where('status', 'not in', ['REJECTED', 'DROPPED'])
        .execute();
      return lines
        .map((line) => {
          const used = existing
            .filter((allocation) => allocation.journal_line_id === line.id)
            .reduce((sum, allocation) => sum.add(allocation.allocated_amount), Decimal.ZERO);
          const remaining = Decimal.from(line.amount_functional).sub(used);
          return {
            ...line,
            functional_currency: functionalCurrency.functional_currency,
            remaining_functional_amount: remaining.toString(),
          };
        })
        .filter((line) => Decimal.from(line.remaining_functional_amount).isPositive());
    });
  }

  async listTrancheAllocations(actor: AuthUserContext, trancheId: string) {
    this.requireStartup(actor);
    this.requireUuid(trancheId, 'Tranche id');
    return await this.tenantContext.withTenantContext(actor.tenant_id, async (tx) => {
      const tranche = await this.getTrancheForActor(tx, actor, trancheId);
      const allocations = await this.getTrancheAllocations(tx, tranche);
      const evidence = await this.getLineEvidence(
        tx,
        actor.tenant_id,
        allocations.map((allocation) => allocation.journal_line_id),
      );
      return allocations.map((allocation) => ({
        ...allocation,
        evidence: this.publicEvidence(evidence.get(allocation.journal_line_id) ?? []),
      }));
    });
  }

  async createMilestone(actor: AuthUserContext, trancheId: string, input: TrancheMilestoneInput) {
    this.requireInstitution(actor);
    this.requireUuid(trancheId, 'Tranche id');
    const milestone = this.validateMilestones([input])[0]!;
    return await this.tenantContext.withTenantContext(actor.tenant_id, async (tx) => {
      const tranche = await tx
        .selectFrom('tranches')
        .selectAll()
        .where('id', '=', trancheId)
        .forUpdate()
        .executeTakeFirst();
      if (!tranche) throw new NotFoundException('Tranche not found');
      const inserted = await tx
        .insertInto('milestones')
        .values({
          id: randomUUID(),
          tranche_id: tranche.id,
          institution_tenant_id: tranche.institution_tenant_id,
          startup_org_id: tranche.startup_org_id,
          code: milestone.code,
          title: milestone.title,
          due_date: milestone.dueDate,
          completion_status: 'PENDING',
          owner_user_id: null,
          deliverable_required: milestone.deliverableRequired,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.appendPartyAudit(
        tx,
        actor,
        tranche.institution_tenant_id,
        tranche.startup_org_id,
        {
          action: 'GRANT_MILESTONE_CREATED',
          entity_type: 'milestone',
          entity_id: inserted.id,
          after_state: { code: inserted.code, title: inserted.title, due_date: inserted.due_date },
        },
      );
      return inserted;
    });
  }

  async submitMilestone(actor: AuthUserContext, milestoneId: string) {
    this.requireStartup(actor);
    this.requireUuid(milestoneId, 'Milestone id');
    return await this.tenantContext.withTenantContext(actor.tenant_id, async (tx) => {
      const milestone = await tx
        .selectFrom('milestones')
        .selectAll()
        .where('id', '=', milestoneId)
        .where('startup_org_id', '=', actor.tenant_id)
        .forUpdate()
        .executeTakeFirst();
      if (!milestone) throw new NotFoundException('Milestone not found');
      const evidence = await tx
        .selectFrom('milestone_evidence')
        .innerJoin(
          'evidence_documents',
          'evidence_documents.id',
          'milestone_evidence.evidence_document_id',
        )
        .select(['evidence_documents.id', 'evidence_documents.scan_status'])
        .where('milestone_evidence.tenant_id', '=', actor.tenant_id)
        .where('milestone_evidence.milestone_id', '=', milestone.id)
        .where('evidence_documents.scan_status', '=', 'CLEAN')
        .execute();
      if (milestone.deliverable_required && evidence.length === 0) {
        throw new BadRequestException(
          'A clean deliverable file must be attached before submission',
        );
      }
      return await this.stateMachine.transitionMilestone(
        tx,
        actor,
        milestone,
        'SUBMITTED',
        'MILESTONE_DELIVERABLE_SUBMITTED',
      );
    });
  }

  async createAllocation(actor: AuthUserContext, trancheId: string, input: CreateAllocationInput) {
    this.requireStartup(actor);
    this.requireUuid(trancheId, 'Tranche id');
    const lineId = this.requireUuid(input?.journalLineId, 'Journal line id');
    const budgetLineId = this.requireUuid(input?.trancheBudgetLineId, 'Budget line id');
    const amount = this.positiveMoney(input?.allocatedAmount, 'Allocated amount');
    const fxRate = this.positiveFxRate(input?.fxRateToGrant);
    return await this.tenantContext.withTenantContext(actor.tenant_id, async (tx) => {
      const tranche = await tx
        .selectFrom('tranches')
        .selectAll()
        .where('id', '=', trancheId)
        .where('startup_org_id', '=', actor.tenant_id)
        .forUpdate()
        .executeTakeFirst();
      if (!tranche) throw new NotFoundException('Tranche not found');
      this.requireEditableTranche(tranche.availability_status, tranche.review_status);

      const category = await tx
        .selectFrom('tranche_budget_lines')
        .select(['id', 'tranche_id'])
        .where('id', '=', budgetLineId)
        .where('startup_org_id', '=', actor.tenant_id)
        .executeTakeFirst();
      if (!category || category.tranche_id !== tranche.id) {
        throw new BadRequestException('Choose an eligible category from this tranche');
      }
      const line = await tx
        .selectFrom('journal_lines')
        .innerJoin('journal_entries', 'journal_entries.id', 'journal_lines.journal_entry_id')
        .innerJoin('accounts', 'accounts.id', 'journal_lines.account_id')
        .select([
          'journal_lines.id',
          'journal_lines.amount_functional',
          'journal_lines.debit',
          'journal_entries.status',
          'accounts.account_type',
        ])
        .where('journal_lines.id', '=', lineId)
        .where('journal_lines.tenant_id', '=', actor.tenant_id)
        .executeTakeFirst();
      if (
        !line ||
        line.status !== 'POSTED' ||
        !Decimal.from(line.debit).isPositive() ||
        (line.account_type !== 'EXPENSE' && line.account_type !== 'ASSET')
      ) {
        throw new BadRequestException(
          'Only posted debit lines in expense or asset accounts are eligible',
        );
      }
      if (Decimal.from(amount).gt(line.amount_functional)) {
        throw new BadRequestException(
          'The allocated amount exceeds the journal line functional amount',
        );
      }

      const inserted = await tx
        .insertInto('line_item_allocations')
        .values({
          id: randomUUID(),
          tenant_id: actor.tenant_id,
          journal_line_id: lineId,
          tranche_budget_line_id: budgetLineId,
          allocated_amount: amount,
          fx_rate_to_grant: fxRate,
          converted_amount: sql<string>`round(${amount}::numeric * ${fxRate}::numeric, 4)`,
          status: 'DRAFT',
          locked_by_submission_id: null,
          created_by_user_id: actor.user_id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.appendPartyAudit(
        tx,
        actor,
        tranche.institution_tenant_id,
        tranche.startup_org_id,
        {
          action: 'GRANT_EXPENSE_ALLOCATED',
          entity_type: 'line_item_allocation',
          entity_id: inserted.id,
          after_state: {
            journal_line_id: lineId,
            tranche_budget_line_id: budgetLineId,
            allocated_amount: amount,
            fx_rate_to_grant: fxRate,
            converted_amount: inserted.converted_amount,
          },
        },
      );
      return inserted;
    });
  }

  async updateAllocation(
    actor: AuthUserContext,
    allocationId: string,
    input: CreateAllocationInput,
  ) {
    this.requireStartup(actor);
    this.requireUuid(allocationId, 'Allocation id');
    const budgetLineId = this.requireUuid(input?.trancheBudgetLineId, 'Budget line id');
    const amount = this.positiveMoney(input?.allocatedAmount, 'Allocated amount');
    const fxRate = this.positiveFxRate(input?.fxRateToGrant);

    return await this.tenantContext.withTenantContext(actor.tenant_id, async (tx) => {
      const allocation = await tx
        .selectFrom('line_item_allocations')
        .innerJoin(
          'tranche_budget_lines',
          'tranche_budget_lines.id',
          'line_item_allocations.tranche_budget_line_id',
        )
        .innerJoin('tranches', 'tranches.id', 'tranche_budget_lines.tranche_id')
        .select([
          'line_item_allocations.id',
          'line_item_allocations.tenant_id',
          'tranches.institution_tenant_id',
          'line_item_allocations.status',
          'line_item_allocations.locked_by_submission_id',
          'line_item_allocations.journal_line_id',
          'tranches.id as tranche_id',
          'tranches.availability_status',
          'tranches.review_status',
        ])
        .where('line_item_allocations.id', '=', allocationId)
        .where('line_item_allocations.tenant_id', '=', actor.tenant_id)
        .forUpdate()
        .executeTakeFirst();
      if (!allocation) throw new NotFoundException('Expense allocation not found');
      this.requireEditableTranche(allocation.availability_status, allocation.review_status);
      if (allocation.status !== 'DRAFT' && allocation.status !== 'REJECTED') {
        throw new ConflictException('Submitted or approved expense allocations cannot be edited');
      }
      const budgetLine = await tx
        .selectFrom('tranche_budget_lines')
        .select(['id', 'tranche_id'])
        .where('id', '=', budgetLineId)
        .where('startup_org_id', '=', actor.tenant_id)
        .executeTakeFirst();
      if (!budgetLine || budgetLine.tranche_id !== allocation.tranche_id) {
        throw new BadRequestException('Choose an eligible category from this tranche');
      }
      const line = await tx
        .selectFrom('journal_lines')
        .select(['amount_functional'])
        .where('id', '=', allocation.journal_line_id)
        .where('tenant_id', '=', actor.tenant_id)
        .executeTakeFirst();
      if (!line || Decimal.from(amount).gt(line.amount_functional)) {
        throw new BadRequestException(
          'The allocated amount exceeds the journal line functional amount',
        );
      }
      if (allocation.status === 'REJECTED') {
        await this.stateMachine.transitionAllocation(tx, actor, allocation, 'DRAFT', null);
      }
      const updated = await tx
        .updateTable('line_item_allocations')
        .set({
          tranche_budget_line_id: budgetLineId,
          allocated_amount: amount,
          fx_rate_to_grant: fxRate,
          converted_amount: sql<string>`round(${amount}::numeric * ${fxRate}::numeric, 4)`,
          updated_at: new Date().toISOString(),
        })
        .where('id', '=', allocation.id)
        .where('tenant_id', '=', actor.tenant_id)
        .where('status', '=', 'DRAFT')
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.appendPartyAudit(tx, actor, allocation.institution_tenant_id, actor.tenant_id, {
        action: 'GRANT_EXPENSE_ALLOCATION_UPDATED',
        entity_type: 'line_item_allocation',
        entity_id: updated.id,
        after_state: {
          tranche_budget_line_id: budgetLineId,
          allocated_amount: amount,
          fx_rate_to_grant: fxRate,
          converted_amount: updated.converted_amount,
        },
      });
      return updated;
    });
  }

  async dropRejectedAllocation(actor: AuthUserContext, allocationId: string) {
    this.requireStartup(actor);
    this.requireUuid(allocationId, 'Allocation id');
    return await this.tenantContext.withTenantContext(actor.tenant_id, async (tx) => {
      const allocation = await tx
        .selectFrom('line_item_allocations')
        .innerJoin(
          'tranche_budget_lines',
          'tranche_budget_lines.id',
          'line_item_allocations.tranche_budget_line_id',
        )
        .innerJoin('tranches', 'tranches.id', 'tranche_budget_lines.tranche_id')
        .select([
          'line_item_allocations.id',
          'line_item_allocations.tenant_id',
          'line_item_allocations.status',
          'line_item_allocations.locked_by_submission_id',
          'tranches.id as tranche_id',
          'tranches.institution_tenant_id',
          'tranches.startup_org_id',
          'tranches.availability_status',
          'tranches.review_status',
        ])
        .where('line_item_allocations.id', '=', allocationId)
        .where('line_item_allocations.tenant_id', '=', actor.tenant_id)
        .forUpdate()
        .executeTakeFirst();
      if (!allocation) throw new NotFoundException('Expense allocation not found');
      if (
        allocation.status !== 'REJECTED' ||
        allocation.availability_status !== 'ACTIVE' ||
        allocation.review_status !== 'CHANGES_REQUESTED'
      ) {
        throw new ConflictException('Only a rejected allocation can be dropped during remediation');
      }
      const updated = await this.stateMachine.transitionAllocation(
        tx,
        actor,
        allocation,
        'DROPPED',
        null,
      );
      return { id: updated.id, status: updated.status };
    });
  }

  async attachLineEvidence(actor: AuthUserContext, allocationId: string, documentId: string) {
    this.requireStartup(actor);
    this.requireUuid(allocationId, 'Allocation id');
    this.requireUuid(documentId, 'Evidence id');
    return await this.tenantContext.withTenantContext(actor.tenant_id, async (tx) => {
      const allocation = await tx
        .selectFrom('line_item_allocations')
        .select(['id', 'journal_line_id', 'status', 'tranche_budget_line_id'])
        .where('id', '=', allocationId)
        .where('tenant_id', '=', actor.tenant_id)
        .executeTakeFirst();
      if (!allocation || (allocation.status !== 'DRAFT' && allocation.status !== 'REJECTED')) {
        throw new ConflictException('Evidence cannot be changed after submission');
      }
      const document = await tx
        .selectFrom('evidence_documents')
        .select(['id', 'scan_status'])
        .where('id', '=', documentId)
        .where('tenant_id', '=', actor.tenant_id)
        .executeTakeFirst();
      if (!document || document.scan_status !== 'CLEAN') {
        throw new BadRequestException(
          'Only clean evidence in this startup workspace can be attached',
        );
      }
      const inserted = await tx
        .insertInto('journal_line_evidence')
        .values({
          id: randomUUID(),
          tenant_id: actor.tenant_id,
          journal_line_id: allocation.journal_line_id,
          evidence_document_id: document.id,
          linked_by_user_id: actor.user_id,
        })
        .onConflict((conflict) =>
          conflict.columns(['tenant_id', 'journal_line_id', 'evidence_document_id']).doNothing(),
        )
        .returning('id')
        .executeTakeFirst();
      await this.auditLog.appendAuditLog(tx, {
        tenant_id: actor.tenant_id,
        actor_id: actor.user_id,
        actor_type: 'USER',
        action: 'GRANT_EXPENSE_EVIDENCE_LINKED',
        entity_type: 'line_item_allocation',
        entity_id: allocation.id,
        after_state: { evidence_document_id: document.id },
      });
      return { linked: true, id: inserted?.id ?? null };
    });
  }

  async attachMilestoneEvidence(actor: AuthUserContext, milestoneId: string, documentId: string) {
    this.requireStartup(actor);
    this.requireUuid(milestoneId, 'Milestone id');
    this.requireUuid(documentId, 'Evidence id');
    return await this.tenantContext.withTenantContext(actor.tenant_id, async (tx) => {
      const milestone = await tx
        .selectFrom('milestones')
        .select(['id', 'completion_status'])
        .where('id', '=', milestoneId)
        .where('startup_org_id', '=', actor.tenant_id)
        .executeTakeFirst();
      if (
        !milestone ||
        (milestone.completion_status !== 'PENDING' && milestone.completion_status !== 'REJECTED')
      ) {
        throw new ConflictException('Evidence cannot be changed for this milestone');
      }
      const document = await tx
        .selectFrom('evidence_documents')
        .select(['id', 'scan_status', 'doc_type'])
        .where('id', '=', documentId)
        .where('tenant_id', '=', actor.tenant_id)
        .executeTakeFirst();
      if (!document || document.scan_status !== 'CLEAN' || document.doc_type !== 'DELIVERABLE') {
        throw new BadRequestException(
          'A clean deliverable document from this workspace is required',
        );
      }
      const inserted = await tx
        .insertInto('milestone_evidence')
        .values({
          id: randomUUID(),
          tenant_id: actor.tenant_id,
          milestone_id: milestone.id,
          evidence_document_id: document.id,
          linked_by_user_id: actor.user_id,
        })
        .onConflict((conflict) =>
          conflict.columns(['tenant_id', 'milestone_id', 'evidence_document_id']).doNothing(),
        )
        .returning('id')
        .executeTakeFirst();
      await this.auditLog.appendAuditLog(tx, {
        tenant_id: actor.tenant_id,
        actor_id: actor.user_id,
        actor_type: 'USER',
        action: 'GRANT_MILESTONE_EVIDENCE_LINKED',
        entity_type: 'milestone',
        entity_id: milestone.id,
        after_state: { evidence_document_id: document.id },
      });
      return { linked: true, id: inserted?.id ?? null };
    });
  }

  async getReadiness(actor: AuthUserContext, trancheId: string) {
    this.requireStartup(actor);
    this.requireUuid(trancheId, 'Tranche id');
    return await this.tenantContext.withTenantContext(actor.tenant_id, async (tx) => {
      const tranche = await this.getTrancheForActor(tx, actor, trancheId);
      this.requireEditableTranche(tranche.availability_status, tranche.review_status);
      return await this.buildReadiness(tx, tranche);
    });
  }

  async submitForReview(
    actor: AuthUserContext,
    trancheId: string,
    input: { idempotencyKey: string; password: string },
    metadata: RequestMetadata,
  ) {
    if (actor.role !== 'FDR' || actor.org_type !== 'STARTUP') {
      throw new ForbiddenException('Only a startup Founder/CEO may attest and submit a tranche');
    }
    this.requireUuid(trancheId, 'Tranche id');
    const key = this.requiredText(input?.idempotencyKey, 'Idempotency key', 128);
    if (key.length < 16)
      throw new BadRequestException('Idempotency key must be at least 16 characters');
    if (typeof input?.password !== 'string' || input.password.length === 0) {
      throw new BadRequestException('Your current password is required to sign the submission');
    }

    return await this.tenantContext.withTenantContext(actor.tenant_id, async (tx) => {
      const existing = await tx
        .selectFrom('review_submissions')
        .select(['id', 'version_number', 'status', 'snapshot_hash'])
        .where('tranche_id', '=', trancheId)
        .where('startup_org_id', '=', actor.tenant_id)
        .where('idempotency_key', '=', key)
        .executeTakeFirst();
      if (existing) return existing;

      const tranche = await this.getTrancheForActor(tx, actor, trancheId, true);
      this.requireEditableTranche(tranche.availability_status, tranche.review_status);
      const readiness = await this.buildReadiness(tx, tranche);
      if (!readiness.ready) {
        throw new BadRequestException({
          message: 'The tranche is not ready to submit',
          blockers: readiness.blockers,
        });
      }

      const user = await tx
        .selectFrom('users')
        .select('password_hash')
        .where('id', '=', actor.user_id)
        .executeTakeFirst();
      if (!(await this.passwordHasher.verify(input.password, user?.password_hash ?? null))) {
        throw new UnauthorizedException('Password confirmation failed');
      }

      const grant = await tx
        .selectFrom('grants')
        .select(['id', 'institution_tenant_id', 'startup_org_id', 'currency'])
        .where('id', '=', tranche.grant_id)
        .executeTakeFirstOrThrow();
      const allocations = (await this.getTrancheAllocations(tx, tranche)).filter(
        (allocation) => allocation.status !== 'REJECTED',
      );
      const milestones = await this.getMilestoneSnapshot(tx, tranche);
      const previousApprovals = await this.getCarriedApprovals(tx, tranche);
      const currentEvidence = await this.getLineEvidence(
        tx,
        tranche.startup_org_id,
        allocations.map((allocation) => allocation.journal_line_id),
      );
      const currentAllocations = allocations.filter((allocation) => allocation.status === 'DRAFT');
      const itemSnapshots = [
        ...previousApprovals,
        ...currentAllocations.map((allocation) =>
          this.toSubmissionItemSnapshot(
            allocation,
            false,
            currentEvidence.get(allocation.journal_line_id) ?? [],
          ),
        ),
      ].sort((a, b) => a.line_item_allocation_id.localeCompare(b.line_item_allocation_id));
      const functionalTotal = currentAllocations
        .concat(allocations.filter((allocation) => allocation.status === 'APPROVED'))
        .reduce((total, allocation) => total.add(allocation.allocated_amount), Decimal.ZERO);
      const grantTotal = itemSnapshots.reduce(
        (total, item) => total.add(item.allocated_amount),
        Decimal.ZERO,
      );
      const versionRow = await sql<{ version: number }>`
        SELECT COALESCE(MAX(version_number), 0) + 1 AS version
        FROM review_submissions
        WHERE tranche_id = ${tranche.id}
      `.execute(tx);
      const version = Number(versionRow.rows[0]?.version ?? 1);
      if (!Number.isSafeInteger(version) || version < 1) {
        throw new ConflictException('A valid submission version could not be allocated');
      }
      const snapshot = {
        grant_id: grant.id,
        tranche_id: tranche.id,
        version_number: version,
        total_allocated_amount: functionalTotal.toString(),
        total_claimable_amount: grantTotal.toString(),
        currency: grant.currency,
        items: itemSnapshots,
        milestones,
      };
      const snapshotHash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
      const now = new Date().toISOString();
      const submissionId = randomUUID();
      await tx
        .insertInto('review_submissions')
        .values({
          id: submissionId,
          grant_id: grant.id,
          tranche_id: tranche.id,
          institution_tenant_id: grant.institution_tenant_id,
          startup_org_id: grant.startup_org_id,
          version_number: version,
          idempotency_key: key,
          status: 'SUBMITTED_PENDING_REVIEW',
          total_allocated_amount: functionalTotal.toString(),
          total_claimable_amount: grantTotal.toString(),
          milestone_snapshot: JSON.stringify(milestones),
          snapshot_hash: snapshotHash,
          submitted_by_user_id: actor.user_id,
          submitted_at: now,
        })
        .execute();

      for (const item of itemSnapshots) {
        await tx
          .insertInto('submission_items')
          .values({
            id: randomUUID(),
            submission_id: submissionId,
            institution_tenant_id: grant.institution_tenant_id,
            startup_org_id: grant.startup_org_id,
            line_item_allocation_id: item.line_item_allocation_id,
            tranche_budget_line_id: item.tranche_budget_line_id,
            category_code: item.category_code,
            category_name: item.category_name,
            allocated_amount: item.allocated_amount,
            functional_amount: item.functional_amount,
            functional_currency: item.functional_currency,
            fx_rate_to_grant: item.fx_rate_to_grant,
            transaction_date: item.transaction_date,
            vendor_name: null,
            vendor_tax_id: null,
            line_memo: item.line_memo,
            evidence_snapshot: JSON.stringify(item.evidence_snapshot),
            carried_forward_approval: item.carried_forward_approval,
          })
          .execute();
      }
      const attestationTextHash = createHash('sha256').update(ATTESTATION_TEXT).digest('hex');
      await tx
        .insertInto('signatures')
        .values({
          id: randomUUID(),
          submission_id: submissionId,
          institution_tenant_id: grant.institution_tenant_id,
          startup_org_id: grant.startup_org_id,
          signer_user_id: actor.user_id,
          signer_role: actor.role,
          snapshot_hash: snapshotHash,
          attestation_text_version: ATTESTATION_VERSION,
          attestation_text_hash: attestationTextHash,
          ip: metadata.ip ?? null,
          user_agent: metadata.userAgent?.slice(0, 512) ?? null,
          reauth_verified_at: now,
          signed_at: now,
        })
        .execute();

      for (const allocation of currentAllocations) {
        await this.stateMachine.transitionAllocation(
          tx,
          actor,
          {
            id: allocation.allocation_id,
            tenant_id: allocation.tenant_id,
            institution_tenant_id: allocation.institution_tenant_id,
            status: 'DRAFT',
            locked_by_submission_id: allocation.locked_by_submission_id,
          },
          'SUBMITTED',
          submissionId,
        );
      }
      await this.stateMachine.transitionTranche(
        tx,
        actor,
        tranche,
        { availability_status: 'ACTIVE', review_status: 'SUBMITTED_PENDING_REVIEW' },
        'SUBMISSION_CREATED',
      );
      return {
        id: submissionId,
        version_number: version,
        status: 'SUBMITTED_PENDING_REVIEW',
        snapshot_hash: snapshotHash,
        signed_at: now,
      };
    });
  }

  async reviewSubmission(
    actor: AuthUserContext,
    submissionId: string,
    input: ReviewSubmissionInput,
  ) {
    if (actor.role !== 'REV' || actor.org_type !== 'INSTITUTION') {
      throw new ForbiddenException('Only an institutional reviewer may review a submission');
    }
    this.requireUuid(submissionId, 'Submission id');
    if (!Array.isArray(input?.items) || !Array.isArray(input?.milestones)) {
      throw new BadRequestException('Line-item and milestone decisions are required');
    }

    return await this.tenantContext.withTenantContext(actor.tenant_id, async (tx) => {
      const submission = await tx
        .selectFrom('review_submissions')
        .selectAll()
        .where('id', '=', submissionId)
        .where('institution_tenant_id', '=', actor.tenant_id)
        .forUpdate()
        .executeTakeFirst();
      if (!submission || submission.status !== 'SUBMITTED_PENDING_REVIEW') {
        throw new ConflictException('This submission is not awaiting review');
      }
      const tranche = await tx
        .selectFrom('tranches')
        .selectAll()
        .where('id', '=', submission.tranche_id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const items = await tx
        .selectFrom('submission_items')
        .selectAll()
        .where('submission_id', '=', submission.id)
        .orderBy('id')
        .execute();
      const reviewableItems = items.filter((item) => !item.carried_forward_approval);
      this.requireExactDecisionSet(
        reviewableItems.map((item) => item.id),
        input.items.map((item) => this.requireUuid(item.submissionItemId, 'Submission item id')),
        'line item',
      );
      const milestoneSnapshot = this.parseMilestoneSnapshot(submission.milestone_snapshot);
      const requiredMilestoneIds = milestoneSnapshot
        .filter((milestone) => milestone.deliverable_required)
        .map((milestone) => milestone.milestone_id);
      this.requireExactDecisionSet(
        requiredMilestoneIds,
        input.milestones.map((item) => this.requireUuid(item.milestoneId, 'Milestone id')),
        'required milestone',
      );

      const itemDecisions = new Map(input.items.map((item) => [item.submissionItemId, item]));
      let hasRejection = false;
      for (const item of reviewableItems) {
        const decision = itemDecisions.get(item.id)!;
        this.validateDecision(
          decision.decision,
          decision.reasonCode,
          decision.comment,
          REJECTION_REASONS,
        );
        hasRejection ||= decision.decision === 'REJECTED';
        await tx
          .insertInto('review_decisions')
          .values({
            id: randomUUID(),
            submission_id: submission.id,
            submission_item_id: item.id,
            line_item_allocation_id: item.line_item_allocation_id,
            institution_tenant_id: submission.institution_tenant_id,
            startup_org_id: submission.startup_org_id,
            decision: decision.decision,
            reason_code: decision.decision === 'REJECTED' ? decision.reasonCode! : null,
            comment: this.optionalText(decision.comment, 2000),
            decided_by_user_id: actor.user_id,
          })
          .execute();
        await this.stateMachine.transitionAllocation(
          tx,
          actor,
          {
            id: item.line_item_allocation_id,
            tenant_id: submission.startup_org_id,
            institution_tenant_id: submission.institution_tenant_id,
            status: 'SUBMITTED',
            locked_by_submission_id: submission.id,
          },
          decision.decision,
          submission.id,
        );
      }

      const milestoneDecisions = new Map(input.milestones.map((item) => [item.milestoneId, item]));
      for (const milestoneId of requiredMilestoneIds) {
        const decision = milestoneDecisions.get(milestoneId)!;
        this.validateDecision(
          decision.decision,
          decision.reasonCode,
          decision.notes,
          MILESTONE_REJECTION_REASONS,
        );
        hasRejection ||= decision.decision === 'REJECTED';
        await tx
          .insertInto('milestone_decisions')
          .values({
            id: randomUUID(),
            submission_id: submission.id,
            milestone_id: milestoneId,
            institution_tenant_id: submission.institution_tenant_id,
            startup_org_id: submission.startup_org_id,
            decision: decision.decision,
            reason_code: decision.decision === 'REJECTED' ? decision.reasonCode! : null,
            notes: this.optionalText(decision.notes, 2000),
            decided_by_user_id: actor.user_id,
          })
          .execute();
        const milestone = await tx
          .selectFrom('milestones')
          .selectAll()
          .where('id', '=', milestoneId)
          .where('institution_tenant_id', '=', submission.institution_tenant_id)
          .executeTakeFirst();
        if (!milestone) throw new ConflictException('A milestone in the snapshot no longer exists');
        await this.stateMachine.transitionMilestone(
          tx,
          actor,
          milestone,
          decision.decision === 'APPROVED' ? 'VERIFIED' : 'REJECTED',
          decision.decision === 'APPROVED'
            ? 'MILESTONE_DELIVERABLE_VERIFIED'
            : 'MILESTONE_DELIVERABLE_REJECTED',
        );
      }

      const target = hasRejection ? 'CHANGES_REQUESTED' : 'VERIFIED_PENDING_APPROVAL';
      await this.stateMachine.transitionSubmission(tx, actor, submission, target);
      await this.stateMachine.transitionTranche(
        tx,
        actor,
        tranche,
        { availability_status: 'ACTIVE', review_status: target },
        hasRejection ? 'SUBMISSION_CHANGES_REQUESTED' : 'SUBMISSION_VERIFIED',
      );
      return { submission_id: submission.id, status: target };
    });
  }

  async authorizeDisbursement(actor: AuthUserContext, submissionId: string) {
    if (actor.role !== 'APR' || actor.org_type !== 'INSTITUTION') {
      throw new ForbiddenException(
        'Only the institutional committee approver may authorize payment',
      );
    }
    this.requireUuid(submissionId, 'Submission id');
    return await this.tenantContext.withTenantContext(actor.tenant_id, async (tx) => {
      const submission = await tx
        .selectFrom('review_submissions')
        .selectAll()
        .where('id', '=', submissionId)
        .where('institution_tenant_id', '=', actor.tenant_id)
        .forUpdate()
        .executeTakeFirst();
      if (!submission || submission.status !== 'VERIFIED_PENDING_APPROVAL') {
        throw new ConflictException('Only a fully verified submission may be authorized');
      }
      const reviewerIds = await tx
        .selectFrom('review_decisions')
        .select('decided_by_user_id')
        .where('submission_id', '=', submission.id)
        .union(
          tx
            .selectFrom('milestone_decisions')
            .select('decided_by_user_id')
            .where('submission_id', '=', submission.id),
        )
        .execute();
      this.sod.assertReviewerNotCommitteeApprover(
        reviewerIds.map((row) => row.decided_by_user_id),
        actor.user_id,
      );
      const tranche = await tx
        .selectFrom('tranches')
        .selectAll()
        .where('id', '=', submission.tranche_id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      await this.stateMachine.transitionSubmission(
        tx,
        actor,
        submission,
        'APPROVED_FOR_DISBURSEMENT',
      );
      const updatedTranche = await this.stateMachine.transitionTranche(
        tx,
        actor,
        tranche,
        { availability_status: 'ACTIVE', review_status: 'APPROVED_FOR_DISBURSEMENT' },
        'DISBURSEMENT_AUTHORIZED',
      );
      return {
        submission_id: submission.id,
        tranche_id: updatedTranche.id,
        status: updatedTranche.review_status,
        authorized_amount: submission.total_claimable_amount,
      };
    });
  }

  async recordDisbursement(
    actor: AuthUserContext,
    trancheId: string,
    input: RecordDisbursementInput,
  ) {
    if (actor.role !== 'PM' || actor.org_type !== 'INSTITUTION') {
      throw new ForbiddenException(
        'Only the institution program manager may record an executed payout',
      );
    }
    this.requireUuid(trancheId, 'Tranche id');
    const submissionId = this.requireUuid(input?.submissionId, 'Submission id');
    const evidenceId = this.requireUuid(
      input?.confirmationEvidenceDocumentId,
      'Bank confirmation evidence id',
    );
    const bankReference = this.requiredText(input?.bankReference, 'Bank reference', 120);
    const paidDate = this.date(input?.paidDate, 'Transfer date');
    const amountPaid = this.positiveMoney(input?.amountPaid, 'Disbursed amount');
    const fxRate = this.positiveFxRate(input?.fxRate);

    return await this.tenantContext.withTenantContext(actor.tenant_id, async (tx) => {
      const tranche = await tx
        .selectFrom('tranches')
        .selectAll()
        .where('id', '=', trancheId)
        .where('institution_tenant_id', '=', actor.tenant_id)
        .forUpdate()
        .executeTakeFirst();
      if (!tranche || tranche.review_status !== 'APPROVED_FOR_DISBURSEMENT') {
        throw new ConflictException('The tranche is not approved for disbursement');
      }
      const submission = await tx
        .selectFrom('review_submissions')
        .selectAll()
        .where('id', '=', submissionId)
        .where('tranche_id', '=', tranche.id)
        .where('status', '=', 'APPROVED_FOR_DISBURSEMENT')
        .executeTakeFirst();
      if (!submission)
        throw new BadRequestException('Choose the approved submission for this tranche');
      if (!Decimal.from(amountPaid).eq(submission.total_claimable_amount)) {
        throw new BadRequestException(
          'The transfer amount must exactly match the authorized claim amount',
        );
      }
      const grant = await tx
        .selectFrom('grants')
        .select(['currency', 'startup_org_id', 'institution_tenant_id'])
        .where('id', '=', tranche.grant_id)
        .executeTakeFirstOrThrow();
      const proof = await tx
        .selectFrom('evidence_documents')
        .select(['id', 'doc_type', 'scan_status'])
        .where('id', '=', evidenceId)
        .where('tenant_id', '=', actor.tenant_id)
        .executeTakeFirst();
      if (!proof || proof.doc_type !== 'BANK_WIRE_SLIP' || proof.scan_status !== 'CLEAN') {
        throw new BadRequestException('A clean bank confirmation attachment is required');
      }
      const normalizedReference = bankReference.toLowerCase();
      await sql`SELECT pg_advisory_xact_lock(hashtext(${actor.tenant_id}), hashtext(${normalizedReference}))`.execute(
        tx,
      );
      const duplicateReference = await tx
        .selectFrom('disbursements')
        .select('id')
        .where('institution_tenant_id', '=', actor.tenant_id)
        .where(sql<string>`lower(bank_reference)`, '=', normalizedReference)
        .where('status', '!=', 'REVERSED')
        .executeTakeFirst();
      if (duplicateReference) {
        throw new ConflictException('This bank reference has already been used');
      }
      const existingDisbursement = await tx
        .selectFrom('disbursements')
        .select('id')
        .where('tranche_id', '=', tranche.id)
        .where('status', '!=', 'REVERSED')
        .executeTakeFirst();
      if (existingDisbursement) {
        throw new ConflictException('A payout has already been recorded for this tranche');
      }
      const netReceived = await sql<{ amount: string }>`
        SELECT round(${amountPaid}::numeric * ${fxRate}::numeric, 4)::text AS amount
      `.execute(tx);
      const inserted = await tx
        .insertInto('disbursements')
        .values({
          id: randomUUID(),
          tranche_id: tranche.id,
          submission_id: submission.id,
          institution_tenant_id: grant.institution_tenant_id,
          startup_org_id: grant.startup_org_id,
          authorized_amount: submission.total_claimable_amount,
          status: 'RECORDED_BY_INSTITUTION',
          bank_reference: bankReference,
          paid_date: paidDate,
          amount_paid: amountPaid,
          net_received_amount: netReceived.rows[0]!.amount,
          currency: grant.currency,
          fx_rate: fxRate,
          fx_rate_source: 'MANUAL_BANK_CONFIRMED',
          fees: '0',
          confirmation_evidence_doc_id: proof.id,
          recorded_by_user_id: actor.user_id,
          confirmed_by_user_id: null,
          statement_line_id: null,
          linked_journal_entry_id: null,
          dispute_reason: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .returning([
          'id',
          'tranche_id',
          'status',
          'authorized_amount',
          'amount_paid',
          'currency',
          'fx_rate',
        ])
        .executeTakeFirstOrThrow();
      await this.appendPartyAudit(tx, actor, grant.institution_tenant_id, grant.startup_org_id, {
        action: 'PAYOUT_RECORDED',
        entity_type: 'disbursement',
        entity_id: inserted.id,
        after_state: {
          tranche_id: tranche.id,
          submission_id: submission.id,
          bank_reference: bankReference,
          paid_date: paidDate,
          amount_paid: amountPaid,
          currency: grant.currency,
          fx_rate: fxRate,
          confirmation_evidence_document_id: proof.id,
        },
      });
      return inserted;
    });
  }

  async confirmReceipt(actor: AuthUserContext, disbursementId: string) {
    if (actor.org_type !== 'STARTUP' || (actor.role !== 'FIN' && actor.role !== 'FDR')) {
      throw new ForbiddenException('Only startup Finance or Founder/CEO may confirm grant receipt');
    }
    this.requireUuid(disbursementId, 'Disbursement id');
    return await this.tenantContext.withTenantContext(actor.tenant_id, async (tx) => {
      const disbursement = await tx
        .selectFrom('disbursements')
        .selectAll()
        .where('id', '=', disbursementId)
        .where('startup_org_id', '=', actor.tenant_id)
        .forUpdate()
        .executeTakeFirst();
      if (!disbursement) throw new NotFoundException('Disbursement not found');
      if (
        !disbursement.amount_paid ||
        !Decimal.from(disbursement.amount_paid).eq(disbursement.authorized_amount)
      ) {
        throw new ConflictException('The bank transfer does not match the authorized amount');
      }
      this.sod.assertDisbursementRecorderNotConfirmer(
        disbursement.recorded_by_user_id ?? '',
        actor.user_id,
      );
      const tranche = await tx
        .selectFrom('tranches')
        .selectAll()
        .where('id', '=', disbursement.tranche_id)
        .where('startup_org_id', '=', actor.tenant_id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const reconciled = await this.stateMachine.transitionDisbursement(tx, actor, {
        id: disbursement.id,
        institution_tenant_id: disbursement.institution_tenant_id,
        startup_org_id: disbursement.startup_org_id,
        status: 'RECORDED_BY_INSTITUTION',
        recorded_by_user_id: disbursement.recorded_by_user_id,
      });
      await this.stateMachine.transitionTranche(
        tx,
        actor,
        tranche,
        {
          availability_status: 'CLOSED',
          review_status: 'DISBURSED_AND_RECONCILED',
          closed_at: new Date().toISOString(),
        },
        'TRANCHE_DISBURSED_AND_RECONCILED',
      );
      const unlocked = await this.unlockNextTranche(tx, actor, tranche);
      return {
        disbursement_id: reconciled.id,
        status: reconciled.status,
        tranche_id: tranche.id,
        tranche_status: 'DISBURSED_AND_RECONCILED',
        unlocked_tranche_id: unlocked?.id ?? null,
      };
    });
  }

  async getSubmission(actor: AuthUserContext, submissionId: string) {
    this.requireUuid(submissionId, 'Submission id');
    return await this.tenantContext.withTenantContext(actor.tenant_id, async (tx) => {
      const submission = await tx
        .selectFrom('review_submissions')
        .selectAll()
        .where('id', '=', submissionId)
        .executeTakeFirst();
      if (!submission) throw new NotFoundException('Submission not found');
      const items = await tx
        .selectFrom('submission_items')
        .selectAll()
        .where('submission_id', '=', submissionId)
        .orderBy('transaction_date')
        .orderBy('id')
        .execute();
      const decisions = await tx
        .selectFrom('review_decisions')
        .select([
          'submission_item_id',
          'decision',
          'reason_code',
          'comment',
          'decided_by_user_id',
          'decided_at',
        ])
        .where('submission_id', '=', submissionId)
        .execute();
      const milestoneDecisions = await tx
        .selectFrom('milestone_decisions')
        .select([
          'milestone_id',
          'decision',
          'reason_code',
          'notes',
          'decided_by_user_id',
          'decided_at',
        ])
        .where('submission_id', '=', submissionId)
        .execute();
      return {
        ...submission,
        milestone_snapshot: this.parseMilestoneSnapshot(submission.milestone_snapshot).map(
          (milestone) => ({
            ...milestone,
            evidence: this.publicEvidence(milestone.evidence),
            decision: milestoneDecisions.find(
              (decision) => decision.milestone_id === milestone.milestone_id,
            ),
          }),
        ),
        items: items.map((item) => ({
          ...item,
          evidence_snapshot: this.publicEvidence(
            this.parseEvidenceSnapshot(item.evidence_snapshot),
          ),
          decision: decisions.find((decision) => decision.submission_item_id === item.id) ?? null,
        })),
      };
    });
  }

  async getSubmissionEvidenceUrl(
    actor: AuthUserContext,
    submissionId: string,
    documentId: string,
  ): Promise<{ url: string }> {
    this.requireUuid(submissionId, 'Submission id');
    this.requireUuid(documentId, 'Evidence id');
    const submission = await this.tenantContext.withTenantContext(actor.tenant_id, async (tx) => {
      const row = await tx
        .selectFrom('review_submissions')
        .select(['id', 'milestone_snapshot'])
        .where('id', '=', submissionId)
        .executeTakeFirst();
      if (!row) throw new NotFoundException('Submission not found');
      const items = await tx
        .selectFrom('submission_items')
        .select('evidence_snapshot')
        .where('submission_id', '=', submissionId)
        .execute();
      return { ...row, items };
    });
    const evidence = [
      ...submission.items.flatMap((item) => this.parseEvidenceSnapshot(item.evidence_snapshot)),
      ...this.parseMilestoneSnapshot(submission.milestone_snapshot).flatMap(
        (milestone) => milestone.evidence,
      ),
    ].find((item) => item.document_id === documentId);
    if (!evidence) throw new NotFoundException('Evidence is not part of this frozen submission');
    return { url: this.vault.presignSnapshotEvidence(evidence.storage_key) };
  }

  async getDisbursementEvidenceUrl(
    actor: AuthUserContext,
    disbursementId: string,
  ): Promise<{ url: string }> {
    this.requireUuid(disbursementId, 'Disbursement id');
    const storageKey = await this.tenantContext.withTenantContext(actor.tenant_id, async (tx) => {
      const disbursement = await tx
        .selectFrom('disbursements')
        .select(['institution_tenant_id', 'confirmation_evidence_doc_id'])
        .where('id', '=', disbursementId)
        .executeTakeFirst();
      if (!disbursement?.confirmation_evidence_doc_id) {
        throw new NotFoundException('Bank confirmation evidence not found');
      }
      await sql`SELECT set_config('app.current_tenant_id', ${disbursement.institution_tenant_id}, true)`.execute(
        tx,
      );
      const document = await tx
        .selectFrom('evidence_documents')
        .select(['storage_key', 'scan_status', 'doc_type'])
        .where('id', '=', disbursement.confirmation_evidence_doc_id)
        .where('tenant_id', '=', disbursement.institution_tenant_id)
        .executeTakeFirst();
      if (!document || document.scan_status !== 'CLEAN' || document.doc_type !== 'BANK_WIRE_SLIP') {
        throw new NotFoundException('Clean bank confirmation evidence not found');
      }
      return document.storage_key;
    });
    return { url: this.vault.presignSnapshotEvidence(storageKey) };
  }

  async getOwnEvidenceUrl(actor: AuthUserContext, documentId: string): Promise<{ url: string }> {
    this.requireUuid(documentId, 'Evidence id');
    return { url: await this.vault.getOwnDownloadUrl(actor, documentId) };
  }

  async uploadEvidence(
    actor: AuthUserContext,
    file: { buffer: Buffer; mimetype: string; size: number },
    docType: string,
  ) {
    if (!['FDR', 'FIN', 'OPS', 'PM'].includes(actor.role)) {
      throw new ForbiddenException('This workspace role cannot upload evidence');
    }
    return await this.vault.upload(actor, file, docType);
  }

  private async buildReadiness(
    tx: Transaction<Database>,
    tranche: {
      id: string;
      grant_id: string;
      institution_tenant_id: string;
      startup_org_id: string;
      amount: string;
      currency: string;
      availability_status: 'LOCKED' | 'ACTIVE' | 'CLOSED';
      review_status: TrancheReviewStatus;
    },
  ) {
    const allocations = (await this.getTrancheAllocations(tx, tranche)).filter(
      (allocation) => allocation.status !== 'REJECTED',
    );
    const blockers: Array<{ code: string; message: string; entity_id?: string }> = [];
    if (allocations.length === 0) {
      blockers.push({
        code: 'NO_ALLOCATIONS',
        message: 'Tag at least one eligible posted expense to this tranche.',
      });
    }

    const lineEvidence = await this.getLineEvidence(
      tx,
      tranche.startup_org_id,
      allocations.map((allocation) => allocation.journal_line_id),
    );

    let totalClaimable = Decimal.ZERO;
    const categoryTotals = new Map<string, Decimal>();
    for (const allocation of allocations) {
      if (!allocation.fx_rate_to_grant || !allocation.converted_amount) {
        blockers.push({
          code: 'FX_RATE_REQUIRED',
          message: 'Enter the actual expense-to-grant currency rate for this allocation.',
          entity_id: allocation.allocation_id,
        });
      } else {
        totalClaimable = totalClaimable.add(allocation.converted_amount);
        const current = categoryTotals.get(allocation.tranche_budget_line_id) ?? Decimal.ZERO;
        categoryTotals.set(
          allocation.tranche_budget_line_id,
          current.add(allocation.converted_amount),
        );
      }
      if (!(lineEvidence.get(allocation.journal_line_id)?.length ?? 0)) {
        blockers.push({
          code: 'MISSING_CLEAN_EVIDENCE',
          message: 'Attach at least one clean invoice, receipt, or proof of payment.',
          entity_id: allocation.allocation_id,
        });
      }
    }

    for (const [budgetLineId, total] of categoryTotals) {
      const allocation = allocations.find(
        (candidate) => candidate.tranche_budget_line_id === budgetLineId,
      )!;
      const allowed = await this.categoryAllowedAmount(tx, allocation, tranche.amount);
      if (total.gt(allowed)) {
        blockers.push({
          code: 'CATEGORY_CAP_EXCEEDED',
          message: `${allocation.category_name} is ${total.toString()} ${tranche.currency}; its allowed limit is ${allowed}.`,
          entity_id: budgetLineId,
        });
      }
    }
    if (totalClaimable.gt(tranche.amount)) {
      blockers.push({
        code: 'TRANCHE_CAP_EXCEEDED',
        message: `Total tagged expenses exceed the tranche amount of ${tranche.amount} ${tranche.currency}.`,
        entity_id: tranche.id,
      });
    }

    const requiredMilestones = await tx
      .selectFrom('milestones')
      .selectAll()
      .where('tranche_id', '=', tranche.id)
      .where('deliverable_required', '=', true)
      .orderBy('due_date')
      .execute();
    const milestoneIds = requiredMilestones.map((milestone) => milestone.id);
    const milestoneEvidence = milestoneIds.length
      ? await tx
          .selectFrom('milestone_evidence')
          .innerJoin(
            'evidence_documents',
            'evidence_documents.id',
            'milestone_evidence.evidence_document_id',
          )
          .select(['milestone_evidence.milestone_id', 'evidence_documents.scan_status'])
          .where('milestone_evidence.tenant_id', '=', tranche.startup_org_id)
          .where('milestone_evidence.milestone_id', 'in', milestoneIds)
          .execute()
      : [];
    for (const milestone of requiredMilestones) {
      if (
        !['SUBMITTED', 'VERIFIED'].includes(milestone.completion_status) ||
        !milestoneEvidence.some(
          (evidence) => evidence.milestone_id === milestone.id && evidence.scan_status === 'CLEAN',
        )
      ) {
        blockers.push({
          code: 'MILESTONE_DELIVERABLE_MISSING',
          message: `Submit a clean deliverable for required milestone ${milestone.code}.`,
          entity_id: milestone.id,
        });
      }
    }

    return {
      tranche_id: tranche.id,
      status: tranche.review_status,
      currency: tranche.currency,
      total_claimable_amount: totalClaimable.toString(),
      ready: blockers.length === 0,
      blockers,
    };
  }

  private async getTrancheAllocations(
    tx: Transaction<Database>,
    tranche: {
      id: string;
      institution_tenant_id: string;
      startup_org_id: string;
      amount: string;
      currency: string;
    },
  ): Promise<AllocationRow[]> {
    const organization = await tx
      .selectFrom('organizations')
      .select('functional_currency')
      .where('id', '=', tranche.startup_org_id)
      .executeTakeFirstOrThrow();
    return await tx
      .selectFrom('line_item_allocations as allocation')
      .innerJoin('tranche_budget_lines as budget', 'budget.id', 'allocation.tranche_budget_line_id')
      .innerJoin('journal_lines as line', 'line.id', 'allocation.journal_line_id')
      .innerJoin('journal_entries as entry', 'entry.id', 'line.journal_entry_id')
      .innerJoin('accounts as account', 'account.id', 'line.account_id')
      .select([
        'allocation.id as allocation_id',
        'allocation.tenant_id',
        'allocation.status',
        'allocation.locked_by_submission_id',
        'allocation.journal_line_id',
        'allocation.tranche_budget_line_id',
        'allocation.allocated_amount',
        'allocation.fx_rate_to_grant',
        'allocation.converted_amount',
        'budget.institution_tenant_id',
        'budget.startup_org_id',
        'budget.category_code',
        'budget.category_name',
        'budget.cap_amount',
        'budget.cap_percentage',
        'budget.variance_tolerance_pct',
        'line.amount_functional',
        'entry.entry_date as transaction_date',
        'entry.memo',
        'account.account_type',
      ])
      .select(sql<string>`${tranche.amount}::numeric::text`.as('tranche_amount'))
      .select(sql<string>`${tranche.currency}::text`.as('grant_currency'))
      .select(sql<string>`${organization.functional_currency}::text`.as('functional_currency'))
      .where('allocation.tenant_id', '=', tranche.startup_org_id)
      .where('budget.tranche_id', '=', tranche.id)
      .where('allocation.status', 'in', ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'])
      .orderBy('entry.entry_date')
      .orderBy('allocation.id')
      .execute();
  }

  private async getLineEvidence(
    tx: Transaction<Database>,
    startupOrgId: string,
    lineIds: string[],
  ): Promise<Map<string, EvidenceSnapshot[]>> {
    const uniqueIds = [...new Set(lineIds)];
    if (uniqueIds.length === 0) return new Map();
    const documents = await tx
      .selectFrom('journal_line_evidence')
      .innerJoin(
        'evidence_documents',
        'evidence_documents.id',
        'journal_line_evidence.evidence_document_id',
      )
      .select([
        'journal_line_evidence.journal_line_id',
        'evidence_documents.id as document_id',
        'evidence_documents.storage_key',
        'evidence_documents.doc_type',
        'evidence_documents.sha256',
        'evidence_documents.size_bytes',
        'evidence_documents.created_at',
      ])
      .where('journal_line_evidence.tenant_id', '=', startupOrgId)
      .where('journal_line_evidence.journal_line_id', 'in', uniqueIds)
      .where('evidence_documents.scan_status', '=', 'CLEAN')
      .execute();
    const result = new Map<string, EvidenceSnapshot[]>();
    for (const document of documents) {
      const entries = result.get(document.journal_line_id) ?? [];
      entries.push(this.toEvidenceSnapshot(document));
      result.set(document.journal_line_id, entries);
    }
    return result;
  }

  private async categoryAllowedAmount(
    tx: Transaction<Database>,
    allocation: AllocationRow,
    trancheAmount: string,
  ): Promise<string> {
    const result = await sql<{ allowed: string }>`
      SELECT round(
        CASE
          WHEN ${allocation.cap_percentage}::numeric IS NULL THEN ${allocation.cap_amount}::numeric
          WHEN ${allocation.cap_amount}::numeric = 0
            THEN ${trancheAmount}::numeric * ${allocation.cap_percentage}::numeric / 100
          ELSE LEAST(
            ${allocation.cap_amount}::numeric,
            ${trancheAmount}::numeric * ${allocation.cap_percentage}::numeric / 100
          )
        END * (1 + ${allocation.variance_tolerance_pct}::numeric / 100),
        4
      )::text AS allowed
    `.execute(tx);
    return result.rows[0]!.allowed;
  }

  private async getMilestoneSnapshot(
    tx: Transaction<Database>,
    tranche: { id: string; startup_org_id: string },
  ) {
    const milestones = await tx
      .selectFrom('milestones')
      .selectAll()
      .where('tranche_id', '=', tranche.id)
      .orderBy('due_date')
      .orderBy('code')
      .execute();
    const ids = milestones.map((milestone) => milestone.id);
    const evidence = ids.length
      ? await tx
          .selectFrom('milestone_evidence')
          .innerJoin(
            'evidence_documents',
            'evidence_documents.id',
            'milestone_evidence.evidence_document_id',
          )
          .select([
            'milestone_evidence.milestone_id',
            'evidence_documents.id as document_id',
            'evidence_documents.storage_key',
            'evidence_documents.doc_type',
            'evidence_documents.sha256',
            'evidence_documents.size_bytes',
            'evidence_documents.created_at',
            'evidence_documents.scan_status',
          ])
          .where('milestone_evidence.tenant_id', '=', tranche.startup_org_id)
          .where('milestone_evidence.milestone_id', 'in', ids)
          .execute()
      : [];
    return milestones.map((milestone) => ({
      milestone_id: milestone.id,
      code: milestone.code,
      title: milestone.title,
      due_date: milestone.due_date,
      deliverable_required: milestone.deliverable_required,
      completion_status: milestone.completion_status,
      evidence: evidence
        .filter(
          (document) => document.milestone_id === milestone.id && document.scan_status === 'CLEAN',
        )
        .map((document) => this.toEvidenceSnapshot(document)),
    }));
  }

  private async getCarriedApprovals(
    tx: Transaction<Database>,
    tranche: { id: string; startup_org_id: string },
  ) {
    const approvedIds = await tx
      .selectFrom('line_item_allocations')
      .select('id')
      .where('tenant_id', '=', tranche.startup_org_id)
      .where('status', '=', 'APPROVED')
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('tranche_budget_lines')
            .select('id')
            .whereRef(
              'tranche_budget_lines.id',
              '=',
              'line_item_allocations.tranche_budget_line_id',
            )
            .where('tranche_budget_lines.tranche_id', '=', tranche.id),
        ),
      )
      .execute();
    if (approvedIds.length === 0) return [];
    const allocations = await tx
      .selectFrom('line_item_allocations as allocation')
      .innerJoin('tranche_budget_lines as budget', 'budget.id', 'allocation.tranche_budget_line_id')
      .innerJoin('journal_lines as line', 'line.id', 'allocation.journal_line_id')
      .innerJoin('journal_entries as entry', 'entry.id', 'line.journal_entry_id')
      .select([
        'allocation.id as allocation_id',
        'allocation.tenant_id',
        'budget.institution_tenant_id',
        'budget.startup_org_id',
        'allocation.journal_line_id',
        'allocation.tranche_budget_line_id',
        'allocation.allocated_amount',
        'allocation.fx_rate_to_grant',
        'allocation.converted_amount',
        'budget.category_code',
        'budget.category_name',
        'line.amount_functional',
        'entry.entry_date as transaction_date',
        'entry.memo',
      ])
      .where(
        'allocation.id',
        'in',
        approvedIds.map((allocation) => allocation.id),
      )
      .execute();
    if (allocations.length === 0) return [];
    const lineIds = allocations.map((allocation) => allocation.journal_line_id);
    const evidence = await tx
      .selectFrom('journal_line_evidence')
      .innerJoin(
        'evidence_documents',
        'evidence_documents.id',
        'journal_line_evidence.evidence_document_id',
      )
      .select([
        'journal_line_evidence.journal_line_id',
        'evidence_documents.id as document_id',
        'evidence_documents.storage_key',
        'evidence_documents.doc_type',
        'evidence_documents.sha256',
        'evidence_documents.size_bytes',
        'evidence_documents.created_at',
      ])
      .where('journal_line_evidence.tenant_id', '=', tranche.startup_org_id)
      .where('journal_line_evidence.journal_line_id', 'in', lineIds)
      .where('evidence_documents.scan_status', '=', 'CLEAN')
      .execute();
    const currency = await tx
      .selectFrom('organizations')
      .select('functional_currency')
      .where('id', '=', tranche.startup_org_id)
      .executeTakeFirstOrThrow();
    return allocations.map((allocation) =>
      this.toSubmissionItemSnapshot(
        {
          ...allocation,
          status: 'APPROVED',
          locked_by_submission_id: null,
          institution_tenant_id: allocation.institution_tenant_id,
          startup_org_id: allocation.startup_org_id,
          tranche_amount: '0',
          grant_currency: '',
          functional_currency: currency.functional_currency,
          category_code: allocation.category_code,
          category_name: allocation.category_name,
          account_type: 'EXPENSE',
          cap_amount: '0',
          cap_percentage: null,
          variance_tolerance_pct: '0',
        },
        true,
        evidence
          .filter((document) => document.journal_line_id === allocation.journal_line_id)
          .map((document) => this.toEvidenceSnapshot(document)),
      ),
    );
  }

  private toSubmissionItemSnapshot(
    allocation: AllocationRow,
    carriedForward: boolean,
    providedEvidence?: EvidenceSnapshot[],
  ) {
    return {
      line_item_allocation_id: allocation.allocation_id,
      tranche_budget_line_id: allocation.tranche_budget_line_id,
      category_code: allocation.category_code,
      category_name: allocation.category_name,
      allocated_amount: allocation.converted_amount ?? '0',
      functional_amount: allocation.allocated_amount,
      functional_currency: allocation.functional_currency,
      fx_rate_to_grant: allocation.fx_rate_to_grant ?? '0',
      transaction_date: allocation.transaction_date,
      line_memo: allocation.memo,
      evidence_snapshot: providedEvidence ?? [],
      carried_forward_approval: carriedForward,
    };
  }

  private toEvidenceSnapshot(document: {
    document_id?: string;
    id?: string;
    storage_key: string;
    doc_type: string;
    sha256: string | null;
    size_bytes: string | number | bigint;
    created_at: string;
  }): EvidenceSnapshot {
    return {
      document_id: document.document_id ?? document.id!,
      storage_key: document.storage_key,
      doc_type: document.doc_type,
      sha256: document.sha256,
      size_bytes: String(document.size_bytes),
      created_at: document.created_at,
    };
  }

  private async unlockNextTranche(
    tx: Transaction<Database>,
    actor: AuthUserContext,
    completed: {
      id: string;
      grant_id: string;
      institution_tenant_id: string;
      startup_org_id: string;
      sequence_order: number;
    },
  ) {
    const next = await tx
      .selectFrom('tranches')
      .selectAll()
      .where('grant_id', '=', completed.grant_id)
      .where('sequence_order', '>', completed.sequence_order)
      .orderBy('sequence_order')
      .limit(1)
      .forUpdate()
      .executeTakeFirst();
    if (!next || next.availability_status !== 'LOCKED' || next.review_status !== 'NOT_STARTED') {
      return null;
    }
    const rules = await tx
      .selectFrom('unlock_rules')
      .selectAll()
      .where('tranche_id', '=', next.id)
      .execute();
    for (const rule of rules) {
      if (rule.require_prev_disbursed_reconciled && rule.prerequisite_tranche_id) {
        const prerequisite = await tx
          .selectFrom('tranches')
          .select(['availability_status', 'review_status'])
          .where('id', '=', rule.prerequisite_tranche_id)
          .executeTakeFirst();
        if (
          !prerequisite ||
          prerequisite.availability_status !== 'CLOSED' ||
          prerequisite.review_status !== 'DISBURSED_AND_RECONCILED'
        ) {
          return null;
        }
      }
      if (rule.require_milestone_verified && rule.prerequisite_milestone_id) {
        const milestone = await tx
          .selectFrom('milestones')
          .select('completion_status')
          .where('id', '=', rule.prerequisite_milestone_id)
          .executeTakeFirst();
        if (milestone?.completion_status !== 'VERIFIED') return null;
      }
    }
    return await this.stateMachine.transitionTranche(
      tx,
      actor,
      next,
      {
        availability_status: 'ACTIVE',
        review_status: 'DRAFT',
        unlocked_at: new Date().toISOString(),
      },
      'TRANCHE_UNLOCKED',
    );
  }

  private async getTrancheForActor(
    tx: Transaction<Database>,
    actor: AuthUserContext,
    trancheId: string,
    forUpdate = false,
  ) {
    let query = tx
      .selectFrom('tranches')
      .selectAll()
      .where('id', '=', trancheId)
      .where(
        actor.org_type === 'STARTUP' ? 'startup_org_id' : 'institution_tenant_id',
        '=',
        actor.tenant_id,
      );
    if (forUpdate) query = query.forUpdate();
    const tranche = await query.executeTakeFirst();
    if (!tranche) throw new NotFoundException('Tranche not found');
    return tranche;
  }

  private async appendPartyAudit(
    tx: Transaction<Database>,
    actor: AuthUserContext,
    institutionTenantId: string,
    startupOrgId: string,
    entry: {
      action: string;
      entity_type: string;
      entity_id: string;
      after_state: Record<string, unknown>;
    },
  ) {
    for (const tenantId of new Set([institutionTenantId, startupOrgId])) {
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

  private validateCategories(value: unknown): EligibleCategoryInput[] {
    if (!Array.isArray(value) || value.length > 100) {
      throw new BadRequestException('Eligible categories must be a list of at most 100 categories');
    }
    const categories = value.map((category: EligibleCategoryInput) => ({
      code: this.requiredText(category?.code, 'Category code', 60),
      name: this.requiredText(category?.name, 'Category name', 120),
    }));
    if (new Set(categories.map((category) => category.code)).size !== categories.length) {
      throw new BadRequestException('Eligible category codes must be unique');
    }
    return categories;
  }

  private readCategories(value: unknown): EligibleCategoryInput[] {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) {
      throw new ConflictException('The grant program category terms are invalid');
    }
    return parsed.map((category: EligibleCategoryInput) => ({
      code: String(category.code),
      name: String(category.name),
    }));
  }

  private validateMilestones(value: unknown): Array<{
    code: string;
    title: string;
    dueDate: string;
    deliverableRequired: boolean;
  }> {
    if (!Array.isArray(value) || value.length > 100) {
      throw new BadRequestException('Milestones must be a list of at most 100 items');
    }
    const milestones = value.map((milestone: TrancheMilestoneInput) => ({
      code: this.requiredText(milestone?.code, 'Milestone code', 60),
      title: this.requiredText(milestone?.title, 'Milestone title', 160),
      dueDate: this.date(milestone?.dueDate, 'Milestone due date'),
      deliverableRequired: milestone?.deliverableRequired !== false,
    }));
    if (new Set(milestones.map((milestone) => milestone.code)).size !== milestones.length) {
      throw new BadRequestException('Milestone codes must be unique within a tranche');
    }
    return milestones;
  }

  private parseMilestoneSnapshot(value: unknown): Array<{
    milestone_id: string;
    code: string;
    title: string;
    due_date: string;
    deliverable_required: boolean;
    completion_status: string;
    evidence: EvidenceSnapshot[];
  }> {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((milestone) => typeof milestone?.milestone_id === 'string');
  }

  private parseEvidenceSnapshot(value: unknown): EvidenceSnapshot[] {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (document) =>
        typeof document?.document_id === 'string' &&
        typeof document?.storage_key === 'string' &&
        typeof document?.doc_type === 'string',
    );
  }

  private publicEvidence(evidence: EvidenceSnapshot[]) {
    return evidence.map(({ storage_key: _storageKey, ...document }) => document);
  }

  private validateDecision(
    decision: string,
    reasonCode: string | undefined,
    note: string | undefined,
    allowedReasons: ReadonlySet<string>,
  ) {
    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      throw new BadRequestException('Each review decision must be APPROVED or REJECTED');
    }
    if (decision === 'REJECTED' && (!reasonCode || !allowedReasons.has(reasonCode))) {
      throw new BadRequestException('A supported rejection reason code is required');
    }
    if (decision === 'REJECTED' && !this.optionalText(note, 2000)) {
      throw new BadRequestException('A note is required when rejecting an item');
    }
  }

  private requireExactDecisionSet(expected: string[], received: string[], label: string) {
    if (
      expected.length !== received.length ||
      new Set(received).size !== received.length ||
      expected.some((id) => !received.includes(id))
    ) {
      throw new BadRequestException(`Submit exactly one decision for every ${label}`);
    }
  }

  private requireEditableTranche(
    availability: 'LOCKED' | 'ACTIVE' | 'CLOSED',
    reviewStatus: TrancheReviewStatus,
  ) {
    if (
      availability !== 'ACTIVE' ||
      (reviewStatus !== 'DRAFT' && reviewStatus !== 'CHANGES_REQUESTED')
    ) {
      throw new ConflictException('This tranche is not open for startup changes');
    }
  }

  private requireStartup(actor: AuthUserContext) {
    if (actor.org_type !== 'STARTUP' || !['FDR', 'FIN', 'OPS'].includes(actor.role)) {
      throw new ForbiddenException('A startup workspace role is required');
    }
  }

  private requireInstitution(actor: AuthUserContext) {
    if (actor.org_type !== 'INSTITUTION' || !['PM', 'REV', 'APR'].includes(actor.role)) {
      throw new ForbiddenException('An institutional workspace role is required');
    }
  }

  private requiredText(value: unknown, label: string, maxLength: number): string {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
      throw new BadRequestException(
        `${label} is required and must be at most ${maxLength} characters`,
      );
    }
    return value.trim();
  }

  private optionalText(value: unknown, maxLength: number): string | null {
    if (value == null || value === '') return null;
    if (typeof value !== 'string' || value.trim().length > maxLength) {
      throw new BadRequestException(`Text must be at most ${maxLength} characters`);
    }
    return value.trim();
  }

  private positiveMoney(value: unknown, label: string): string {
    const parsed = this.moneyInput(value, label);
    if (!Decimal.from(parsed).isPositive()) {
      throw new BadRequestException(`${label} must be greater than zero`);
    }
    return Decimal.from(parsed).toString();
  }

  private nonNegativeMoney(value: unknown, label: string): string {
    const parsed = this.moneyInput(value, label);
    if (Decimal.from(parsed).isNegative()) {
      throw new BadRequestException(`${label} cannot be negative`);
    }
    return Decimal.from(parsed).toString();
  }

  private moneyInput(value: unknown, label: string): string {
    if (
      typeof value !== 'string' ||
      !isValidDecimalString(value) ||
      !/^\d{1,15}(?:\.\d{1,4})?$/.test(value)
    ) {
      throw new BadRequestException(`${label} must be a decimal string with at most 4 places`);
    }
    return value;
  }

  private nonNegativePercentage(value: unknown, label: string): string {
    const percentage = this.nonNegativeMoney(value, label);
    if (Decimal.from(percentage).gt('100')) {
      throw new BadRequestException(`${label} cannot exceed 100%`);
    }
    return percentage;
  }

  private positiveFxRate(value: unknown): string {
    if (
      typeof value !== 'string' ||
      !/^\d{1,10}(?:\.\d{1,8})?$/.test(value) ||
      BigInt(value.replace('.', '')) <= 0n
    ) {
      throw new BadRequestException(
        'FX rate must be a positive decimal string with up to 8 places',
      );
    }
    return value;
  }

  private currency(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) {
      throw new BadRequestException('Currency must be an uppercase 3-letter code');
    }
    return value;
  }

  private date(value: unknown, label: string): string {
    const parsed =
      typeof value === 'string' && ISO_DATE.test(value) ? new Date(`${value}T00:00:00.000Z`) : null;
    if (
      typeof value !== 'string' ||
      !ISO_DATE.test(value) ||
      !parsed ||
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value
    ) {
      throw new BadRequestException(`${label} must be a valid YYYY-MM-DD date`);
    }
    return value;
  }

  private requireUuid(value: unknown, label: string): string {
    if (typeof value !== 'string' || !UUID.test(value)) {
      throw new BadRequestException(`${label} must be a valid UUID`);
    }
    return value;
  }
}
