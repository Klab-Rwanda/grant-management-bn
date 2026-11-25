import { model, models, Schema } from "mongoose";

const grantProgramSchema = new Schema(
  {
    institution: {
      type: Schema.Types.ObjectId,
      ref: "Institution",
      required: true,
    },
    startup: { type: Schema.Types.ObjectId, ref: "Startup", required: true },
    fund: { type: Schema.Types.ObjectId, ref: "Fund", required: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    awardedAmountMinor: {
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
    status: {
      type: String,
      enum: ["active", "closed"],
      default: "active",
      required: true,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

grantProgramSchema.index({ institution: 1, code: 1 }, { unique: true });

export const GrantProgram =
  models.GrantProgram ?? model("GrantProgram", grantProgramSchema);