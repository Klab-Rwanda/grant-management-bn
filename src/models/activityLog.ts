import { model, models, Schema } from "mongoose";

const activityLogSchema = new Schema(
  {
    startup: { type: Schema.Types.ObjectId, ref: "Startup", required: true },
    grantProgram: { type: Schema.Types.ObjectId, ref: "GrantProgram" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true, trim: true },
    details: { type: String, required: true, trim: true },
    activityDate: { type: Date, required: true },
  },
  { timestamps: true },
);

export const ActivityLog =
  models.ActivityLog ?? model("ActivityLog", activityLogSchema);