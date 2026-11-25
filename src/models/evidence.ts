import { model, models, Schema } from "mongoose";

const evidenceSchema = new Schema(
  {
    startup: { type: Schema.Types.ObjectId, ref: "Startup", required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    originalFilename: { type: String, required: true, trim: true },
    storageKey: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true, min: 1 },
  },
  { timestamps: true },
);

export const Evidence = models.Evidence ?? model("Evidence", evidenceSchema);