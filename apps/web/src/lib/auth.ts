import { z } from "zod";

export interface AuthPort {
  getUser(): Promise<{ id: string; email: string | null } | null>;
}

export interface WorkspaceLookupPort {
  exists(workspaceId: string): Promise<boolean>;
}

export interface AdminIdentity {
  userId: string;
  email: string;
  workspaceId: string;
}

export type InternalMemberRole = "owner" | "admin" | "member";

export type InternalMemberStatus = "active" | "revoked";

export interface InternalMemberIdentity {
  userId: string;
  email: string;
  workspaceId: string;
  role: InternalMemberRole;
  status: InternalMemberStatus;
  mustChangePassword: boolean;
}

export interface AuthEnvironment {
  ADMIN_EMAIL_ALLOWLIST?: string;
  INTERNAL_WORKSPACE_ID?: string;
}

export interface MemberLookupPort {
  getByUserId(workspaceId: string, userId: string): Promise<InternalMemberIdentity | null>;
}

export const WorkspaceIdSchema = z.string().uuid();

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
    this.name = "HttpError";
  }
}

const runtimeEnvironment: AuthEnvironment = {};
if (process.env.ADMIN_EMAIL_ALLOWLIST !== undefined) {
  runtimeEnvironment.ADMIN_EMAIL_ALLOWLIST = process.env.ADMIN_EMAIL_ALLOWLIST;
}
if (process.env.INTERNAL_WORKSPACE_ID !== undefined) {
  runtimeEnvironment.INTERNAL_WORKSPACE_ID = process.env.INTERNAL_WORKSPACE_ID;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function getAllowedEmails(env: AuthEnvironment): Set<string> {
  return new Set(
    env.ADMIN_EMAIL_ALLOWLIST
      ?.split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

async function requireAuthenticatedUser(auth: AuthPort): Promise<{ id: string; email: string }> {
  let user: Awaited<ReturnType<AuthPort["getUser"]>>;
  try {
    user = await auth.getUser();
  } catch {
    throw new HttpError(500, "AUTH_UNAVAILABLE");
  }

  const email = user?.email ? normalizeEmail(user.email) : null;
  if (!user || !email) {
    throw new HttpError(401, "AUTH_REQUIRED");
  }

  return { id: user.id, email };
}

async function requireWorkspaceId(
  workspaces: WorkspaceLookupPort,
  env: AuthEnvironment,
): Promise<string> {
  const parsedWorkspaceId = WorkspaceIdSchema.safeParse(env.INTERNAL_WORKSPACE_ID);
  if (!parsedWorkspaceId.success) {
    throw new HttpError(500, "WORKSPACE_NOT_CONFIGURED");
  }

  const workspaceId = parsedWorkspaceId.data;
  let workspaceExists: boolean;
  try {
    workspaceExists = await workspaces.exists(workspaceId);
  } catch {
    throw new HttpError(500, "WORKSPACE_UNAVAILABLE");
  }
  if (!workspaceExists) {
    throw new HttpError(500, "WORKSPACE_NOT_CONFIGURED");
  }

  return workspaceId;
}

export async function requireInternalAdmin(
  auth: AuthPort,
  workspaces: WorkspaceLookupPort,
  env: AuthEnvironment = runtimeEnvironment,
): Promise<AdminIdentity> {
  const user = await requireAuthenticatedUser(auth);
  const allowedEmails = getAllowedEmails(env);
  const workspaceId = await requireWorkspaceId(workspaces, env);
  if (!allowedEmails.has(user.email)) {
    throw new HttpError(403, "ADMIN_REQUIRED");
  }

  return { userId: user.id, email: user.email, workspaceId };
}

export async function requireInternalMember(
  auth: AuthPort,
  workspaces: WorkspaceLookupPort,
  members: MemberLookupPort,
  env: AuthEnvironment = runtimeEnvironment,
): Promise<InternalMemberIdentity> {
  const user = await requireAuthenticatedUser(auth);
  const workspaceId = await requireWorkspaceId(workspaces, env);

  let member: InternalMemberIdentity | null;
  try {
    member = await members.getByUserId(workspaceId, user.id);
  } catch {
    throw new HttpError(500, "MEMBERS_UNAVAILABLE");
  }

  if (member) {
    if (member.status !== "active") {
      throw new HttpError(403, "MEMBER_REVOKED");
    }

    return {
      ...member,
      email: normalizeEmail(member.email),
    };
  }

  if (!getAllowedEmails(env).has(user.email)) {
    throw new HttpError(403, "MEMBER_REQUIRED");
  }

  return {
    userId: user.id,
    email: user.email,
    workspaceId,
    role: "owner",
    status: "active",
    mustChangePassword: false,
  };
}

export async function requireInternalMemberAdmin(
  auth: AuthPort,
  workspaces: WorkspaceLookupPort,
  members: MemberLookupPort,
  env: AuthEnvironment = runtimeEnvironment,
): Promise<InternalMemberIdentity> {
  const identity = await requireInternalMember(auth, workspaces, members, env);
  if (identity.role === "member") {
    throw new HttpError(403, "ADMIN_REQUIRED");
  }

  return identity;
}
