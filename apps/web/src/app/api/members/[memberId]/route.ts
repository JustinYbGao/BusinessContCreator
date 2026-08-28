import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, type InternalMemberIdentity } from "../../../../lib/auth";
import type { MemberRecord } from "../../../../lib/members";
import { parseMemberRoleChangeInput, parseMemberStatusChangeInput } from "../../../../lib/member-inputs";
import { createServerMemberService } from "../../../../lib/supabase/members";
import { requireServerMemberAdmin } from "../../../../lib/supabase/server";

type MemberServicePort = Pick<ReturnType<typeof createServerMemberService>, "changeRole" | "changeStatus">;

interface MemberRouteDependencies {
  requireIdentity?: () => Promise<InternalMemberIdentity>;
  createMemberService?: (actor: InternalMemberIdentity) => MemberServicePort;
}

const MemberRoleRequestSchema = z.object({
  role: z.enum(["admin", "member"]),
}).strict();

const MemberStatusRequestSchema = z.object({
  status: z.enum(["active", "revoked"]),
}).strict();

function codeOf(error: unknown): string {
  if (error instanceof HttpError) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message;
  if (typeof error === "object" && error && "code" in error && typeof error.code === "string") return error.code;
  return "INTERNAL_ERROR";
}

function statusOf(code: string): number {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "ADMIN_REQUIRED" || code === "MEMBER_REQUIRED" || code === "MEMBER_REVOKED" || code === "OWNER_REQUIRED" || code === "OWNER_PROTECTED") return 403;
  if (code === "INVALID_MEMBER_PATCH_INPUT") return 400;
  if (code === "MEMBER_NOT_FOUND") return 404;
  return 500;
}

function errorResponse(error: unknown) {
  const code = codeOf(error);
  return NextResponse.json({ ok: false, error: code }, { status: statusOf(code), headers: { "Cache-Control": "no-store" } });
}

function serializeMember(member: MemberRecord) {
  return {
    id: member.id,
    userId: member.userId,
    email: member.email,
    displayName: member.displayName,
    role: member.role,
    status: member.status,
    mustChangePassword: member.mustChangePassword,
    revokedAt: member.revokedAt,
  };
}

function parsePatchRequest(input: unknown): { role: "admin" | "member" } | { status: "active" | "revoked" } {
  const role = MemberRoleRequestSchema.safeParse(input);
  if (role.success) {
    try {
      parseMemberRoleChangeInput(role.data);
    } catch {
      throw new Error("INVALID_MEMBER_PATCH_INPUT");
    }
    return role.data;
  }

  const status = MemberStatusRequestSchema.safeParse(input);
  if (status.success) {
    try {
      parseMemberStatusChangeInput(status.data);
    } catch {
      throw new Error("INVALID_MEMBER_PATCH_INPUT");
    }
    return status.data;
  }

  throw new Error("INVALID_MEMBER_PATCH_INPUT");
}

export async function handleMemberPatch(
  request: Request,
  { memberId }: { memberId: string },
  deps: MemberRouteDependencies = {},
) {
  try {
    const identity = await (deps.requireIdentity ?? requireServerMemberAdmin)();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new Error("INVALID_MEMBER_PATCH_INPUT");
    }
    const input = parsePatchRequest(body);
    const service = (deps.createMemberService ?? createServerMemberService)(identity);
    const member = "role" in input
      ? await service.changeRole(memberId, input)
      : await service.changeStatus(memberId, input);
    return NextResponse.json(
      { member: serializeMember(member) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ memberId: string }> },
) {
  return handleMemberPatch(request, await params);
}
