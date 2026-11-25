import { model, models, Schema } from "mongoose";

const institutionMembershipSchema = new Schema(
  {
    institution: {
      type: Schema.Types.ObjectId,
      ref: "Institution",
      required: true,
    },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: {
      type: String,
      enum: [
        "grant_program_manager",
        "financial_reviewer",
        "committee_approver",
      ],
      required: true,
    },
  },
  { timestamps: true },
);

institutionMembershipSchema.index(
  { institution: 1, user: 1 },
  { unique: true },
);

export const InstitutionMembership =
  models.InstitutionMembership ??
  model("InstitutionMembership", institutionMembershipSchema);