import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { RepositoryContext } from "./index.js";

export type DatabaseClient = SupabaseClient;

export function createSupabaseClient(url: string, serviceRoleKey: string): DatabaseClient {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function databaseError(error: { message: string; code?: string } | null): Error {
  const result = new Error(error?.message ?? "DATABASE_ERROR");
  if (error?.code) Object.assign(result, { code: error.code });
  return result;
}

export function requireRow<T>(data: T | null, error: { message: string; code?: string } | null): T {
  if (error) throw databaseError(error);
  if (data === null) throw new Error("ROW_NOT_FOUND");
  return data;
}

export function auditInput(ctx: RepositoryContext, input: {
  productId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  payload?: unknown;
}) {
  return {
    product_id: input.productId ?? null,
    actor_type: ctx.actor.type,
    actor_id: ctx.actor.id,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    request_id: ctx.requestId,
    payload: input.payload ?? {},
  };
}

export function mapJob(row: Record<string, any>) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    productId: row.product_id,
    kind: row.kind,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lockedBy: row.locked_by,
  };
}
