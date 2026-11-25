import { model, models, Schema } from "mongoose";

const trancheSchema = new Schema(
  {
    grantProgram: {
      type: Schema.Types.ObjectId,
      ref: "GrantProgram",
      required: true,
    },
    sequence: { type: Number, required: true, min: 1 },
    amountMinor: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isSafeInteger,
    },
    milestone: { type: String, required: true, trim: true },
    plannedDate: Date,
  },
  { timestamps: true },
);

trancheSchema.index({ grantProgram: 1, sequence: 1 }, { unique: true });

export const Tranche = models.Tranche ?? model("Tranche", trancheSchema);