import type {
  CampaignPublicationMetrics,
  MetricRepository,
  MetricSnapshotRecord,
  RepositoryContext,
} from "./index.js";
import { databaseError, type DatabaseClient } from "./client.js";

const mapSnapshot = (row: Record<string, any>): MetricSnapshotRecord => ({
  id: row.id,
  publicationId: row.publication_id,
  window: row.window,
  metrics: row.metrics,
  productConversion: row.product_conversion ?? [],
  importId: row.import_id,
  capturedAt: row.captured_at,
});

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
  async listForCampaign(ctx: Pick<RepositoryContext, "workspaceId">, productId: string, campaignId: string): Promise<CampaignPublicationMetrics[]> {
    const { data: publications, error: publicationError } = await this.db.from("publications")
      .select("id,workspace_id,product_id,campaign_id,status,package,public_url,published_at")
      .eq("workspace_id", ctx.workspaceId)
      .eq("product_id", productId)
      .eq("campaign_id", campaignId)
      .order("created_at");
    if (publicationError) throw databaseError(publicationError);
    const rows = (publications ?? []) as Array<Record<string, any>>;
    if (rows.length === 0) return [];

    const publicationIds = rows.map((row) => row.id as string);
    const { data: snapshots, error: snapshotError } = await this.db.from("metric_snapshots")
      .select("id,publication_id,window,metrics,product_conversion,import_id,captured_at")
      .in("publication_id", publicationIds)
      .order("captured_at");
    if (snapshotError) throw databaseError(snapshotError);

    const snapshotsByPublication = new Map<string, MetricSnapshotRecord[]>();
    for (const row of (snapshots ?? []) as Array<Record<string, any>>) {
      const mapped = mapSnapshot(row);
      const existing = snapshotsByPublication.get(mapped.publicationId) ?? [];
      existing.push(mapped);
      snapshotsByPublication.set(mapped.publicationId, existing);
    }
    return rows.map((row): CampaignPublicationMetrics => ({
      id: row.id,
      workspaceId: row.workspace_id,
      productId: row.product_id,
      campaignId: row.campaign_id,
      status: row.status,
      package: row.package,
      publicUrl: row.public_url ?? null,
      publishedAt: row.published_at ?? null,
      snapshots: snapshotsByPublication.get(row.id) ?? [],
    }));
  }
}
