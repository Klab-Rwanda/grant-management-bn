import { model, models, Schema } from "mongoose";

const milestoneDeliverableSchema = new Schema(
  {
    startup: { type: Schema.Types.ObjectId, ref: "Startup", required: true },
    grantProgram: {
      type: Schema.Types.ObjectId,
      ref: "GrantProgram",
      required: true,
    },
    tranche: { type: Schema.Types.ObjectId, ref: "Tranche", required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    evidence: [{ type: Schema.Types.ObjectId, ref: "Evidence" }],
    submittedBy: { type: Schema.Types.ObjectId, ref: "User" },
    submittedAt: Date,
    status: { type: String, required: true },
  },
  { timestamps: true },
);

export const MilestoneDeliverable =
  models.MilestoneDeliverable ??
  model("MilestoneDeliverable", milestoneDeliverableSchema);