import { model, models, Schema } from "mongoose";

const startupSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    legalName: { type: String, required: true, trim: true },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    registrationNumber: { type: String, trim: true },
    country: { type: String, required: true, trim: true },
    sector: { type: String, trim: true },
    status: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

export const Startup = models.Startup ?? model("Startup", startupSchema);