import { model, models, Schema } from "mongoose";

const disbursementSchema = new Schema(
  {
    institution: {
      type: Schema.Types.ObjectId,
      ref: "Institution",
      required: true,
    },
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
    signoff: {
      type: Schema.Types.ObjectId,
      ref: "DisbursementSignoff",
      required: true,
    },
    amountMinor: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isSafeInteger,
    },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      match: /^[A-Z]{3}$/,
    },
    paymentReference: { type: String, required: true, trim: true },
    status: { type: String, enum: ["paid"], default: "paid", required: true },
    paymentDate: { type: Date, required: true },
    recordedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

disbursementSchema.index(
  { institution: 1, paymentReference: 1 },
  { unique: true },
);

export const Disbursement =
  models.Disbursement ?? model("Disbursement", disbursementSchema);