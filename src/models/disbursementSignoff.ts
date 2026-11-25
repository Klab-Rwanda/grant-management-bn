import { model, models, Schema } from "mongoose";

const disbursementSignoffSchema = new Schema(
  {
    submission: {
      type: Schema.Types.ObjectId,
      ref: "TrancheSubmission",
      required: true,
    },
    approver: { type: Schema.Types.ObjectId, ref: "User", required: true },
    decision: {
      type: String,
      enum: ["approved", "rejected"],
      required: true,
    },
    comment: { type: String, trim: true },
    decidedAt: { type: Date, required: true },
  },
  { timestamps: true },
);

export const DisbursementSignoff =
  models.DisbursementSignoff ??
  model("DisbursementSignoff", disbursementSignoffSchema);