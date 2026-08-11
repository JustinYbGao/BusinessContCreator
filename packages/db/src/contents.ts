import type { ContentRecord, ContentRepository, RepositoryContext } from "./index.js";
import { databaseError, type DatabaseClient } from "./client.js";

const mapContent = (row: Record<string, any>): ContentRecord => ({
  id: row.id, workspaceId: row.workspace_id, productId: row.product_id,
  campaignId: row.campaign_id, topicId: row.topic_id, status: row.status,
});
export class SupabaseContentRepository implements ContentRepository {
  constructor(private readonly db: DatabaseClient) {}
  async createWithBrief(ctx: RepositoryContext, input: { productId: string; campaignId: string; topicId: string; brief: unknown; idempotencyKey: string }) {
    const { data, error } = await this.db.rpc("create_content_with_brief", {
      p_workspace_id: ctx.workspaceId, p_product_id: input.productId,
      p_campaign_id: input.campaignId, p_topic_id: input.topicId, p_brief: input.brief,
      p_created_by: ctx.actor.id, p_idempotency_key: input.idempotencyKey,
      p_actor_type: ctx.actor.type, p_request_id: ctx.requestId,
    });
    if (error || !data) throw databaseError(error);
    return mapContent(data as Record<string, any>);
  }
  async get(ctx: Pick<RepositoryContext, "workspaceId">, id: string) {
    const { data, error } = await this.db.from("contents").select("*")
      .eq("workspace_id", ctx.workspaceId).eq("id", id).maybeSingle();
    if (error) throw databaseError(error);
    return data ? mapContent(data) : null;
  }
}
