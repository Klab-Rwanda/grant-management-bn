import { model, models, Schema } from "mongoose";

const reviewDecisionSchema = new Schema(
  {
    grantProgram: {
      type: Schema.Types.ObjectId,
      ref: "GrantProgram",
      required: true,
    },
    submission: {
      type: Schema.Types.ObjectId,
      ref: "TrancheSubmission",
      required: true,
    },
    reviewer: { type: Schema.Types.ObjectId, ref: "User", required: true },
    targetModel: {
      type: String,
      enum: [
        "TrancheSubmission",
        "Expense",
        "Evidence",
        "MilestoneDeliverable",
      ],
      required: true,
    },
    targetId: {
      type: Schema.Types.ObjectId,
      refPath: "targetModel",
      required: true,
    },
    decision: {
      type: String,
      enum: ["approved", "rejected"],
      required: true,
    },
    comment: { type: String, trim: true },
  },
  { timestamps: true },
);

export const ReviewDecision =
  models.ReviewDecision ?? model("ReviewDecision", reviewDecisionSchema);