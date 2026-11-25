import { model, models, Schema } from "mongoose";

const trancheSubmissionSchema = new Schema(
  {
    grantProgram: {
      type: Schema.Types.ObjectId,
      ref: "GrantProgram",
      required: true,
    },
    tranche: { type: Schema.Types.ObjectId, ref: "Tranche", required: true },
    version: { type: Number, required: true, min: 1 },
    expenses: [{ type: Schema.Types.ObjectId, ref: "Expense" }],
    deliverables: [
      { type: Schema.Types.ObjectId, ref: "MilestoneDeliverable" },
    ],
    submittedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    submittedAt: { type: Date, required: true },
  },
  { timestamps: true },
);

trancheSubmissionSchema.index(
  { grantProgram: 1, tranche: 1, version: 1 },
  { unique: true },
);

export const TrancheSubmission =
  models.TrancheSubmission ??
  model("TrancheSubmission", trancheSubmissionSchema);