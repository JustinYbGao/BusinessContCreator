import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, type InternalMemberIdentity } from "../../../../lib/auth";
import { parseMemberPasswordResetInput } from "../../../../lib/member-inputs";
import { createSupabaseServiceRoleClient } from "../../../../lib/supabase/server";
import { createSupabaseServerClient, requireServerInternalAdmin } from "../../../../lib/supabase/server";

interface AccountPasswordRouteDependencies {
  requireIdentity?: () => Promise<InternalMemberIdentity>;
  updateAuthenticatedPassword?: (identity: InternalMemberIdentity, password: string) => Promise<void>;
  clearMustChangePassword?: (identity: InternalMemberIdentity) => Promise<void>;
}

const AccountPasswordRequestSchema = z.object({
  newPassword: z.string(),
  confirmPassword: z.string(),
}).strict();

function codeOf(error: unknown): string {
  if (error instanceof HttpError) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message;
  if (typeof error === "object" && error && "code" in error && typeof error.code === "string") return error.code;
  return "INTERNAL_ERROR";
}

function statusOf(code: string): number {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "ADMIN_REQUIRED" || code === "MEMBER_REQUIRED" || code === "MEMBER_REVOKED") return 403;
  if (code === "INVALID_ACCOUNT_PASSWORD_INPUT") return 400;
  if (code === "ACCOUNT_PASSWORD_UPDATE_FAILED") return 502;
  return 500;
}

function parsePasswordRequest(input: unknown) {
  const parsed = AccountPasswordRequestSchema.safeParse(input);
  if (!parsed.success || parsed.data.newPassword !== parsed.data.confirmPassword) {
    throw new Error("INVALID_ACCOUNT_PASSWORD_INPUT");
  }

  try {
    parseMemberPasswordResetInput({ password: parsed.data.newPassword });
  } catch {
    throw new Error("INVALID_ACCOUNT_PASSWORD_INPUT");
  }

  return parsed.data.newPassword;
}

async function updateAuthenticatedPassword(
  _identity: InternalMemberIdentity,
  password: string,
) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error("ACCOUNT_PASSWORD_UPDATE_FAILED");
}

async function clearMustChangePassword(identity: InternalMemberIdentity) {
  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase
    .from("workspace_members")
    .update({ must_change_password: false })
    .eq("workspace_id", identity.workspaceId)
    .eq("user_id", identity.userId);
  if (error) throw new Error("ACCOUNT_PASSWORD_UPDATE_FAILED");
}

export async function handleAccountPasswordPost(
  request: Request,
  deps: AccountPasswordRouteDependencies = {},
) {
  try {
    const identity = await (deps.requireIdentity ?? requireServerInternalAdmin)();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new Error("INVALID_ACCOUNT_PASSWORD_INPUT");
    }
    const password = parsePasswordRequest(body);
    await (deps.updateAuthenticatedPassword ?? updateAuthenticatedPassword)(identity, password);
    await (deps.clearMustChangePassword ?? clearMustChangePassword)(identity);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = codeOf(error) === "INTERNAL_ERROR" ? "ACCOUNT_PASSWORD_UPDATE_FAILED" : codeOf(error);
    return NextResponse.json({ ok: false, error: code }, { status: statusOf(code), headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request) {
  return handleAccountPasswordPost(request);
}
