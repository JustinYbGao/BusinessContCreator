import { z } from "zod";

export const MEMBER_DISPLAY_NAME_MAX_LENGTH = 120;
export const MEMBER_PASSWORD_MIN_LENGTH = 12;

const MemberEmailSchema = z.string().trim().min(1).max(320).email().transform((value) => value.toLowerCase());

const MemberDisplayNameSchema = z.preprocess((value) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}, z.string().max(MEMBER_DISPLAY_NAME_MAX_LENGTH).nullable());

const ManagedMemberRoleSchema = z.enum(["admin", "member"]);
const ManagedMemberStatusSchema = z.enum(["active", "revoked"]);
const MemberPasswordSchema = z.string().min(MEMBER_PASSWORD_MIN_LENGTH);

const MemberCreateInputSchema = z.object({
  email: MemberEmailSchema,
  displayName: MemberDisplayNameSchema.optional(),
  role: ManagedMemberRoleSchema,
  password: MemberPasswordSchema,
}).strict();

const MemberRoleChangeInputSchema = z.object({
  role: ManagedMemberRoleSchema,
}).strict();

const MemberStatusChangeInputSchema = z.object({
  status: ManagedMemberStatusSchema,
}).strict();

const MemberPasswordResetInputSchema = z.object({
  password: MemberPasswordSchema,
}).strict();

export type MemberCreateInput = z.infer<typeof MemberCreateInputSchema>;
export type MemberRoleChangeInput = z.infer<typeof MemberRoleChangeInputSchema>;
export type MemberStatusChangeInput = z.infer<typeof MemberStatusChangeInputSchema>;
export type MemberPasswordResetInput = z.infer<typeof MemberPasswordResetInputSchema>;

export function parseMemberCreateInput(input: unknown): MemberCreateInput {
  const parsed = MemberCreateInputSchema.safeParse(input);
  if (!parsed.success) throw new Error("INVALID_MEMBER_CREATE_INPUT");
  return {
    ...parsed.data,
    displayName: parsed.data.displayName ?? null,
  };
}

export function parseMemberRoleChangeInput(input: unknown): MemberRoleChangeInput {
  const parsed = MemberRoleChangeInputSchema.safeParse(input);
  if (!parsed.success) throw new Error("INVALID_MEMBER_ROLE_INPUT");
  return parsed.data;
}

export function parseMemberStatusChangeInput(input: unknown): MemberStatusChangeInput {
  const parsed = MemberStatusChangeInputSchema.safeParse(input);
  if (!parsed.success) throw new Error("INVALID_MEMBER_STATUS_INPUT");
  return parsed.data;
}

export function parseMemberPasswordResetInput(input: unknown): MemberPasswordResetInput {
  const parsed = MemberPasswordResetInputSchema.safeParse(input);
  if (!parsed.success) throw new Error("INVALID_MEMBER_PASSWORD_INPUT");
  return parsed.data;
}
