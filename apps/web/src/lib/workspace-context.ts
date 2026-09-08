import { z } from "zod";

export const INTERNAL_SYSTEM_ACTOR_ID = "00000000-0000-4000-8000-000000000000";

export interface WorkspaceLookupPort {
  exists(workspaceId: string): Promise<boolean>;
}

export interface WorkspaceEnvironment {
  INTERNAL_WORKSPACE_ID?: string;
}

export interface InternalWorkspaceContext {
  workspaceId: string;
  actorId: string;
}

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
    this.name = "HttpError";
  }
}

const WorkspaceIdSchema = z.string().uuid();

const runtimeEnvironment: WorkspaceEnvironment = {};
if (process.env.INTERNAL_WORKSPACE_ID !== undefined) {
  runtimeEnvironment.INTERNAL_WORKSPACE_ID = process.env.INTERNAL_WORKSPACE_ID;
}

export async function requireInternalWorkspace(
  workspaces: WorkspaceLookupPort,
  env: WorkspaceEnvironment = runtimeEnvironment,
): Promise<InternalWorkspaceContext> {
  const parsedWorkspaceId = WorkspaceIdSchema.safeParse(env.INTERNAL_WORKSPACE_ID);
  if (!parsedWorkspaceId.success) {
    throw new HttpError(500, "WORKSPACE_NOT_CONFIGURED");
  }

  let workspaceExists: boolean;
  try {
    workspaceExists = await workspaces.exists(parsedWorkspaceId.data);
  } catch {
    throw new HttpError(500, "WORKSPACE_UNAVAILABLE");
  }
  if (!workspaceExists) {
    throw new HttpError(500, "WORKSPACE_NOT_CONFIGURED");
  }

  return {
    workspaceId: parsedWorkspaceId.data,
    actorId: INTERNAL_SYSTEM_ACTOR_ID,
  };
}
