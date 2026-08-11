import type { RepositoryContext, TopicRepository } from "./index.js";
import { databaseError, type DatabaseClient } from "./client.js";

export class SupabaseTopicRepository implements TopicRepository {
  constructor(private readonly db: DatabaseClient) {}

  async insertCandidates(ctx: RepositoryContext, campaignId: string, candidates: unknown[], idempotencyKey: string) {
    const { data: campaign, error: campaignError } = await this.db.from("campaigns")
      .select("product_id").eq("workspace_id", ctx.workspaceId).eq("id", campaignId).maybeSingle();
    if (campaignError) throw databaseError(campaignError);
    if (!campaign) throw new Error("CAMPAIGN_NOT_FOUND");
    const { data: prior, error: priorError } = await this.db.from("audit_events").select("id")
      .eq("workspace_id", ctx.workspaceId).eq("request_id", idempotencyKey)
      .eq("action", "topics.inserted").maybeSingle();
    if (priorError) throw databaseError(priorError);
    if (prior) return;
    const rows = candidates.map((candidate) => {
      const value = candidate as Record<string, any>;
      return {
        workspace_id: ctx.workspaceId, product_id: campaign.product_id, campaign_id: campaignId,
        title: value.title, angle: value.angle, pillar: value.pillar, fact_ids: value.factIds ?? [],
        scores: value.scores ?? {}, total_score: value.totalScore ?? 0,
      };
    });
    const { error } = await this.db.rpc("insert_topics_with_audit", {
      p_workspace_id: ctx.workspaceId, p_campaign_id: campaignId, p_rows: rows,
      p_actor_type: ctx.actor.type, p_actor_id: ctx.actor.id, p_request_id: idempotencyKey,
    });
    if (error) throw databaseError(error);
  }

  async selectWeekly(ctx: RepositoryContext, campaignId: string, topicIds: string[]) {
    const { error } = await this.db.rpc("select_weekly_topics", {
      p_workspace_id: ctx.workspaceId, p_campaign_id: campaignId, p_topic_ids: topicIds,
      p_actor_type: ctx.actor.type, p_actor_id: ctx.actor.id, p_request_id: ctx.requestId,
    });
    if (error) throw databaseError(error);
  }

  async listByCampaign(ctx: Pick<RepositoryContext, "workspaceId">, campaignId: string) {
    const { data, error } = await this.db.from("topic_candidates").select("*")
      .eq("workspace_id", ctx.workspaceId).eq("campaign_id", campaignId).order("created_at");
    if (error) throw databaseError(error);
    return data ?? [];
  }
}
