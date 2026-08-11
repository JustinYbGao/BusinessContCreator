import type { MetricRepository, RepositoryContext } from "./index.js";
import { databaseError, type DatabaseClient } from "./client.js";

export class SupabaseMetricRepository implements MetricRepository {
  constructor(private readonly db: DatabaseClient) {}
  async importSnapshots(ctx: RepositoryContext, input: { productId: string; format: "manual" | "csv" | "json"; rows: unknown[]; filenameSha256?: string }) {
    const { data, error } = await this.db.rpc("import_metric_snapshots", {
      p_workspace_id: ctx.workspaceId, p_product_id: input.productId,
      p_actor_id: ctx.actor.id, p_format: input.format, p_rows: input.rows,
      p_filename_sha256: input.filenameSha256 ?? null, p_request_id: ctx.requestId,
    });
    if (error || !data) throw databaseError(error);
    const row = data as Record<string, any>;
    return { importId: row.import_id as string, acceptedRows: row.accepted_rows as number };
  }
  async listByPublication(ctx: Pick<RepositoryContext, "workspaceId">, publicationId: string) {
    const { data, error } = await this.db.from("metric_snapshots")
      .select("*,publications!inner(workspace_id)").eq("publication_id", publicationId)
      .eq("publications.workspace_id", ctx.workspaceId).order("captured_at");
    if (error) throw databaseError(error);
    return data ?? [];
  }
}
