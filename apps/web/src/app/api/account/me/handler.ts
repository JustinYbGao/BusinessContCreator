import { NextResponse } from "next/server";
import { HttpError, type InternalMemberIdentity } from "../../../../lib/auth";
import { requireServerInternalAdmin } from "../../../../lib/supabase/server";

interface AccountMeRouteDependencies {
  requireIdentity?: () => Promise<InternalMemberIdentity>;
}

function codeOf(error: unknown): string {
  if (error instanceof HttpError) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message;
  if (typeof error === "object" && error && "code" in error && typeof error.code === "string") return error.code;
  return "INTERNAL_ERROR";
}

function statusOf(code: string): number {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "ADMIN_REQUIRED" || code === "MEMBER_REQUIRED" || code === "MEMBER_REVOKED") return 403;
  return 500;
}

export async function handleAccountMeGet(
  _request: Request,
  deps: AccountMeRouteDependencies = {},
) {
  try {
    const identity = await (deps.requireIdentity ?? requireServerInternalAdmin)();
    return NextResponse.json({
      member: {
        userId: identity.userId,
        email: identity.email,
        workspaceId: identity.workspaceId,
        role: identity.role,
        status: identity.status,
        mustChangePassword: identity.mustChangePassword,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = codeOf(error);
    return NextResponse.json({ ok: false, error: code }, { status: statusOf(code), headers: { "Cache-Control": "no-store" } });
  }
}
