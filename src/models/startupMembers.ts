import { model, models, Schema } from "mongoose";

const startupMembershipSchema = new Schema(
  {
    startup: {
      type: Schema.Types.ObjectId,
      ref: "Startup",
      required: true,
    },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: {
      type: String,
      enum: ["founder_ceo", "finance_lead", "operations_lead"],
      required: true,
    },
  },
  { timestamps: true },
);

startupMembershipSchema.index({ startup: 1, user: 1 }, { unique: true });

export const StartupMembership =
  models.StartupMembership ??
  model("StartupMembership", startupMembershipSchema);