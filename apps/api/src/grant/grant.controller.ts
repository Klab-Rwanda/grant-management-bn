import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthUserContext } from '@grant-ledger/shared';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/authorization.guard';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import {
  CreateAllocationInput,
  CreateAwardInput,
  CreateProgramInput,
  RecordDisbursementInput,
  ReviewSubmissionInput,
} from './grant.service';
import { GrantService } from './grant.service';
import { UploadedEvidenceFile } from './evidence-vault.service';

@ApiTags('Grant Lifecycle')
@ApiBearerAuth()
@UseGuards(AuthGuard, AuthorizationGuard)
@Controller()
export class GrantController {
  constructor(private readonly grants: GrantService) {}

  @Get('grant-setup/startups')
  @Roles('PM')
  listStartups(@CurrentUser() actor: AuthUserContext) {
    return this.grants.listStartups(actor);
  }

  @Get('grant-programs')
  @Roles('PM')
  listPrograms(@CurrentUser() actor: AuthUserContext) {
    return this.grants.listPrograms(actor);
  }

  @Post('grant-programs')
  @Roles('PM')
  createProgram(@CurrentUser() actor: AuthUserContext, @Body() input: CreateProgramInput) {
    return this.grants.createProgram(actor, input);
  }

  @Post('grant-programs/:programId/grants')
  @Roles('PM')
  createAward(
    @CurrentUser() actor: AuthUserContext,
    @Param('programId') programId: string,
    @Body() input: CreateAwardInput,
  ) {
    return this.grants.createAward(actor, programId, input);
  }

  @Get('grants')
  @Roles('PM', 'REV', 'APR', 'FDR', 'FIN', 'OPS')
  listGrants(@CurrentUser() actor: AuthUserContext) {
    return this.grants.listGrants(actor);
  }

  @Get('grants/:id')
  @Roles('PM', 'REV', 'APR', 'FDR', 'FIN', 'OPS')
  getGrant(@CurrentUser() actor: AuthUserContext, @Param('id') id: string) {
    return this.grants.getGrant(actor, id);
  }

  @Get('journal-lines/grant-eligible')
  @Roles('FDR', 'FIN')
  listEligibleJournalLines(@CurrentUser() actor: AuthUserContext) {
    return this.grants.listEligibleJournalLines(actor);
  }

  @Get('tranches/:id/allocations')
  @Roles('FDR', 'FIN')
  listTrancheAllocations(@CurrentUser() actor: AuthUserContext, @Param('id') trancheId: string) {
    return this.grants.listTrancheAllocations(actor, trancheId);
  }

  @Post('tranches/:id/milestones')
  @Roles('PM')
  createMilestone(
    @CurrentUser() actor: AuthUserContext,
    @Param('id') trancheId: string,
    @Body() input: { code: string; title: string; dueDate: string; deliverableRequired?: boolean },
  ) {
    return this.grants.createMilestone(actor, trancheId, input);
  }

  @Post('milestones/:id/submit')
  @Roles('FDR', 'FIN', 'OPS')
  submitMilestone(@CurrentUser() actor: AuthUserContext, @Param('id') id: string) {
    return this.grants.submitMilestone(actor, id);
  }

  @Post('tranches/:id/allocations')
  @Roles('FDR', 'FIN')
  createAllocation(
    @CurrentUser() actor: AuthUserContext,
    @Param('id') trancheId: string,
    @Body() input: CreateAllocationInput,
  ) {
    return this.grants.createAllocation(actor, trancheId, input);
  }

  @Patch('allocations/:id')
  @Roles('FDR', 'FIN')
  updateAllocation(
    @CurrentUser() actor: AuthUserContext,
    @Param('id') allocationId: string,
    @Body() input: CreateAllocationInput,
  ) {
    return this.grants.updateAllocation(actor, allocationId, input);
  }

  @Post('allocations/:id/drop')
  @Roles('FDR', 'FIN')
  dropRejectedAllocation(@CurrentUser() actor: AuthUserContext, @Param('id') allocationId: string) {
    return this.grants.dropRejectedAllocation(actor, allocationId);
  }

  @Post('allocations/:id/evidence')
  @Roles('FDR', 'FIN', 'OPS')
  attachLineEvidence(
    @CurrentUser() actor: AuthUserContext,
    @Param('id') allocationId: string,
    @Body() input: { documentId: string },
  ) {
    return this.grants.attachLineEvidence(actor, allocationId, input?.documentId);
  }

  @Post('milestones/:id/evidence')
  @Roles('FDR', 'FIN', 'OPS')
  attachMilestoneEvidence(
    @CurrentUser() actor: AuthUserContext,
    @Param('id') milestoneId: string,
    @Body() input: { documentId: string },
  ) {
    return this.grants.attachMilestoneEvidence(actor, milestoneId, input?.documentId);
  }

  @Post('evidence')
  @Roles('FDR', 'FIN', 'OPS', 'PM')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    }),
  )
  uploadEvidence(
    @CurrentUser() actor: AuthUserContext,
    @UploadedFile() file: UploadedEvidenceFile,
    @Body('doc_type') docType: string,
  ) {
    return this.grants.uploadEvidence(actor, file, docType);
  }

  @Get('evidence/:id/download')
  @Roles('FDR', 'FIN', 'OPS', 'PM')
  getOwnEvidenceDownload(@CurrentUser() actor: AuthUserContext, @Param('id') id: string) {
    return this.grants.getOwnEvidenceUrl(actor, id);
  }

  @Get('tranches/:id/readiness')
  @Roles('FDR', 'FIN')
  getReadiness(@CurrentUser() actor: AuthUserContext, @Param('id') trancheId: string) {
    return this.grants.getReadiness(actor, trancheId);
  }

  @Post('tranches/:id/submit')
  @Roles('FDR')
  submitForReview(
    @CurrentUser() actor: AuthUserContext,
    @Param('id') trancheId: string,
    @Body() input: { idempotencyKey: string; password: string },
    @Req() request: Request,
  ) {
    return this.grants.submitForReview(actor, trancheId, input, {
      ip: request.ip,
      userAgent: request.get('user-agent'),
    });
  }

  @Get('submissions/:id')
  @Roles('PM', 'REV', 'APR', 'FDR', 'FIN', 'OPS')
  getSubmission(@CurrentUser() actor: AuthUserContext, @Param('id') id: string) {
    return this.grants.getSubmission(actor, id);
  }

  @Get('submissions/:id/evidence/:documentId/download')
  @Roles('PM', 'REV', 'APR', 'FDR', 'FIN')
  getSubmissionEvidenceDownload(
    @CurrentUser() actor: AuthUserContext,
    @Param('id') submissionId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.grants.getSubmissionEvidenceUrl(actor, submissionId, documentId);
  }

  @Post('submissions/:id/review')
  @Roles('REV')
  reviewSubmission(
    @CurrentUser() actor: AuthUserContext,
    @Param('id') id: string,
    @Body() input: ReviewSubmissionInput,
  ) {
    return this.grants.reviewSubmission(actor, id, input);
  }

  @Post('submissions/:id/authorize')
  @Roles('APR')
  authorizeDisbursement(@CurrentUser() actor: AuthUserContext, @Param('id') id: string) {
    return this.grants.authorizeDisbursement(actor, id);
  }

  @Post('tranches/:id/disbursements')
  @Roles('PM')
  recordDisbursement(
    @CurrentUser() actor: AuthUserContext,
    @Param('id') trancheId: string,
    @Body() input: RecordDisbursementInput,
  ) {
    return this.grants.recordDisbursement(actor, trancheId, input);
  }

  @Post('disbursements/:id/confirm')
  @Roles('FDR', 'FIN')
  confirmReceipt(@CurrentUser() actor: AuthUserContext, @Param('id') id: string) {
    return this.grants.confirmReceipt(actor, id);
  }

  @Get('disbursements/:id/evidence/download')
  @Roles('PM', 'FDR', 'FIN')
  getDisbursementEvidenceDownload(@CurrentUser() actor: AuthUserContext, @Param('id') id: string) {
    return this.grants.getDisbursementEvidenceUrl(actor, id);
  }
}
