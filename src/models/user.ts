import { model, models, Schema } from "mongoose";

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    passwordHash: { type: String, required: true, select: false },
    status: { type: String, required: true },
    platformRole: { type: String, enum: ["ecosystem_admin"] },
  },
  { timestamps: true },
);

export const User = models.User ?? model("User", userSchema);