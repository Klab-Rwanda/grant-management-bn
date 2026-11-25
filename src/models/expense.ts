import { model, models, Schema } from "mongoose";

const expenseSchema = new Schema(
  {
    startup: { type: Schema.Types.ObjectId, ref: "Startup", required: true },
    grantProgram: { type: Schema.Types.ObjectId, ref: "GrantProgram" },
    recordedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    expenseDate: { type: Date, required: true },
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
    category: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    evidence: [{ type: Schema.Types.ObjectId, ref: "Evidence" }],
  },
  { timestamps: true },
);

export const Expense = models.Expense ?? model("Expense", expenseSchema);