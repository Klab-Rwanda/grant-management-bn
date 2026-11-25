import { model, models, Schema } from "mongoose";

const teamTaskSchema = new Schema(
  {
    startup: { type: Schema.Types.ObjectId, ref: "Startup", required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User", required: true },
    assignedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, required: true },
    dueDate: Date,
    completedAt: Date,
  },
  { timestamps: true },
);

export const TeamTask = models.TeamTask ?? model("TeamTask", teamTaskSchema);