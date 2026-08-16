import type { RepositoryContext, WeeklyReportRecord, WeeklyReportRepository } from "./index.js";
import { databaseError, type DatabaseClient } from "./client.js";

const mapWeeklyReport = (row: Record<string, any>): WeeklyReportRecord => ({
  id: row.id,
  workspaceId: row.workspace_id,
  productId: row.product_id,
  campaignId: row.campaign_id,
  weekStart: row.week_start,
  payload: row.payload,
  sourceSnapshotIds: row.source_snapshot_ids ?? [],
});

export class SupabaseWeeklyReportRepository implements WeeklyReportRepository {
  constructor(private readonly db: DatabaseClient) {}

  async createOrReplace(ctx: RepositoryContext, input: {
    productId: string;
    campaignId: string;
    weekStart: string;
    payload: unknown;
    sourceSnapshotIds: string[];
  }) {
    const { data, error } = await this.db.rpc("create_weekly_report", {
      p_workspace_id: ctx.workspaceId,
      p_product_id: input.productId,
      p_campaign_id: input.campaignId,
      p_week_start: input.weekStart,
      p_payload: input.payload,
      p_source_snapshot_ids: input.sourceSnapshotIds,
      p_actor_id: ctx.actor.id,
      p_request_id: ctx.requestId,
    });
    if (error || !data) throw databaseError(error);
    return mapWeeklyReport(data as Record<string, any>);
  }

  async getByCampaignWeek(
    ctx: Pick<RepositoryContext, "workspaceId">,
    productId: string,
    campaignId: string,
    weekStart: string,
  ) {
    const { data, error } = await this.db.from("weekly_reports")
      .select("*")
      .eq("workspace_id", ctx.workspaceId)
      .eq("product_id", productId)
      .eq("campaign_id", campaignId)
      .eq("week_start", weekStart)
      .maybeSingle();
    if (error) throw databaseError(error);
    return data ? mapWeeklyReport(data) : null;
  }
}
