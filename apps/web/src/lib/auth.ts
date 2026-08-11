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

export interface AuthEnvironment {
  ADMIN_EMAIL_ALLOWLIST?: string;
  INTERNAL_WORKSPACE_ID?: string;
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

export async function requireInternalAdmin(
  auth: AuthPort,
  workspaces: WorkspaceLookupPort,
  env: AuthEnvironment = runtimeEnvironment,
): Promise<AdminIdentity> {
  let user: Awaited<ReturnType<AuthPort["getUser"]>>;
  try {
    user = await auth.getUser();
  } catch {
    throw new HttpError(500, "AUTH_UNAVAILABLE");
  }
  const email = user?.email?.trim().toLowerCase();

  if (!user || !email) {
    throw new HttpError(401, "AUTH_REQUIRED");
  }

  const allowedEmails = new Set(
    env.ADMIN_EMAIL_ALLOWLIST
      ?.split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );

  if (!allowedEmails.has(email)) {
    throw new HttpError(403, "ADMIN_REQUIRED");
  }

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

  return { userId: user.id, email, workspaceId };
}
