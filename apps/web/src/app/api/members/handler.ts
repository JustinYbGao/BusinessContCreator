import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, type InternalMemberIdentity } from "../../../lib/auth";
import type { MemberRecord } from "../../../lib/members";
import { parseMemberCreateInput } from "../../../lib/member-inputs";
import { createServerMemberService } from "../../../lib/supabase/members";
import { requireServerMemberAdmin } from "../../../lib/supabase/server";

type MemberServicePort = Pick<ReturnType<typeof createServerMemberService>, "list" | "createMember">;

interface MembersRouteDependencies {
  requireIdentity?: () => Promise<InternalMemberIdentity>;
  createMemberService?: (actor: InternalMemberIdentity) => MemberServicePort;
}

const MemberCreateRequestSchema = z.object({
  email: z.string(),
  displayName: z.string().optional(),
  role: z.enum(["admin", "member"]),
  temporaryPassword: z.string(),
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
  if (code === "INVALID_MEMBER_CREATE_INPUT") return 400;
  if (code === "MEMBER_NOT_FOUND") return 404;
  if (code === "MEMBER_ALREADY_EXISTS") return 409;
  if (code === "AUTH_ADMIN_UNAVAILABLE") return 502;
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
    createdAt: member.createdAt,
    revokedAt: member.revokedAt,
  };
}

function parseCreateRequest(input: unknown) {
  const parsed = MemberCreateRequestSchema.safeParse(input);
  if (!parsed.success) throw new Error("INVALID_MEMBER_CREATE_INPUT");

  try {
    return parseMemberCreateInput({
      email: parsed.data.email,
      displayName: parsed.data.displayName,
      role: parsed.data.role,
      password: parsed.data.temporaryPassword,
    });
  } catch {
    throw new Error("INVALID_MEMBER_CREATE_INPUT");
  }
}

export async function handleMembersGet(
  _request: Request,
  deps: MembersRouteDependencies = {},
) {
  try {
    const identity = await (deps.requireIdentity ?? requireServerMemberAdmin)();
    const service = (deps.createMemberService ?? createServerMemberService)(identity);
    const members = await service.list();
    return NextResponse.json(
      { members: members.map(serializeMember) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleMembersPost(
  request: Request,
  deps: MembersRouteDependencies = {},
) {
  try {
    const identity = await (deps.requireIdentity ?? requireServerMemberAdmin)();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new Error("INVALID_MEMBER_CREATE_INPUT");
    }
    const input = parseCreateRequest(body);
    const service = (deps.createMemberService ?? createServerMemberService)(identity);
    const member = await service.createMember(input);
    return NextResponse.json(
      { member: serializeMember(member) },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
