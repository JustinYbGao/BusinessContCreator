import type { AuditEventRecord, AuditRepository, RepositoryContext } from "./index.js";
import { auditInput, databaseError, type DatabaseClient } from "./client.js";

const mapAudit = (row: Record<string, any>): AuditEventRecord => ({
  id: row.id, workspaceId: row.workspace_id, productId: row.product_id,
  action: row.action, entityType: row.entity_type, entityId: row.entity_id, payload: row.payload,
});
export class SupabaseAuditRepository implements AuditRepository {
  constructor(private readonly db: DatabaseClient) {}
  async append(ctx: RepositoryContext, input: Pick<AuditEventRecord, "productId" | "action" | "entityType" | "entityId" | "payload">) {
    const { data, error } = await this.db.rpc("append_audit_event", {
      p_workspace_id: ctx.workspaceId,
      p_event: auditInput(ctx, input),
    });
    if (error || !data) throw databaseError(error);
    return mapAudit(data as Record<string, any>);
  }
  async listForEntity(ctx: Pick<RepositoryContext, "workspaceId">, entityType: string, entityId: string) {
    const { data, error } = await this.db.from("audit_events").select("*")
      .eq("workspace_id", ctx.workspaceId).eq("entity_type", entityType)
      .eq("entity_id", entityId).order("created_at");
    if (error) throw databaseError(error);
    return (data ?? []).map(mapAudit);
  }
}
