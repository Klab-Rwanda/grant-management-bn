import { model, models, Schema } from "mongoose";

const fundSchema = new Schema(
  {
    institution: {
      type: Schema.Types.ObjectId,
      ref: "Institution",
      required: true,
    },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      match: /^[A-Z]{3}$/,
    },
    totalAmountMinor: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isSafeInteger,
    },
  },
  { timestamps: true },
);

fundSchema.index({ institution: 1, code: 1 }, { unique: true });

export const Fund = models.Fund ?? model("Fund", fundSchema);