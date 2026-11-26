import { ConflictException, Injectable } from '@nestjs/common';

@Injectable()
export class SegregationOfDutiesService {
  /**
   * Enforces that the persona preparing or submitting an item is not the approver.
   */
  assertPreparerNotApprover(preparerUserId: string, approverUserId: string): void {
    if (!preparerUserId || !approverUserId) {
      return;
    }

    if (preparerUserId === approverUserId) {
      throw new ConflictException(
        'Segregation of duties violation: The preparer cannot also be the approver.',
      );
    }
  }

  /**
   * Enforces that the reviewer auditing line items/milestones is not the committee approver for the same tranche.
   */
  assertReviewerNotCommitteeApprover(
    reviewerUserIds: string | string[],
    committeeApproverUserId: string,
  ): void {
    if (!reviewerUserIds || !committeeApproverUserId) {
      return;
    }

    const list = Array.isArray(reviewerUserIds) ? reviewerUserIds : [reviewerUserIds];
    if (list.includes(committeeApproverUserId)) {
      throw new ConflictException(
        'Segregation of duties violation: A reviewer cannot act as the committee approver for the same tranche.',
      );
    }
  }

  /**
   * Enforces that the institution user recording an off-platform payment cannot be the startup confirmer.
   */
  assertDisbursementRecorderNotConfirmer(
    recordedByUserId: string,
    confirmedByUserId: string,
  ): void {
    if (!recordedByUserId || !confirmedByUserId) {
      return;
    }

    if (recordedByUserId === confirmedByUserId) {
      throw new ConflictException(
        'Segregation of duties violation: The payment recorder cannot also confirm receipt.',
      );
    }
  }
}
