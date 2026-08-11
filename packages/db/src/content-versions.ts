import type { ContentVersionRecord, ContentVersionRepository, NewContentVersion, RepositoryContext } from "./index.js";
import { databaseError, type DatabaseClient } from "./client.js";

const mapVersion = (row: Record<string, any>): ContentVersionRecord => ({
  id: row.id, workspaceId: row.workspace_id, productId: row.product_id,
  campaignId: row.campaign_id, contentId: row.content_id, topicId: row.topic_id,
  briefId: row.brief_id, version: row.version, payload: row.payload,
  status: row.status, contentSha256: row.content_sha256,
});
export class SupabaseContentVersionRepository implements ContentVersionRepository {
  constructor(private readonly db: DatabaseClient) {}
  async create(ctx: RepositoryContext, input: NewContentVersion) {
    const { data, error } = await this.db.rpc("create_content_version", {
      p_workspace_id: ctx.workspaceId,
      p_input: {
        product_id: input.productId, campaign_id: input.campaignId, content_id: input.contentId,
        topic_id: input.topicId, brief_id: input.briefId, payload: input.payload,
        prompt_version: input.promptVersion, model_name: input.modelName,
        content_sha256: input.contentSha256, created_by: input.createdBy,
      },
      p_actor_type: ctx.actor.type, p_actor_id: ctx.actor.id, p_request_id: ctx.requestId,
    });
    if (error || !data) throw databaseError(error);
    return mapVersion(data as Record<string, any>);
  }
  async get(ctx: Pick<RepositoryContext, "workspaceId">, id: string) {
    const { data, error } = await this.db.from("content_versions").select("*")
      .eq("workspace_id", ctx.workspaceId).eq("id", id).maybeSingle();
    if (error) throw databaseError(error);
    return data ? mapVersion(data) : null;
  }
  async approve(ctx: RepositoryContext, id: string) {
    const stored = await this.get({ workspaceId: ctx.workspaceId }, id);
    if (!stored) throw new Error("CONTENT_VERSION_NOT_FOUND");
    const { data, error } = await this.db.rpc("approve_content_version", {
      p_workspace_id: ctx.workspaceId, p_content_version_id: id,
      p_expected_payload: stored.payload, p_expected_sha256: stored.contentSha256,
      p_approved_by: ctx.actor.id, p_actor_type: ctx.actor.type, p_request_id: ctx.requestId,
    });
    if (error || !data) throw databaseError(error);
    return mapVersion(data as Record<string, any>);
  }
  async getApproved(ctx: Pick<RepositoryContext, "workspaceId">, id: string) {
    const { data, error } = await this.db.from("content_versions").select("*")
      .eq("workspace_id", ctx.workspaceId).eq("id", id).eq("status", "approved").maybeSingle();
    if (error) throw databaseError(error);
    return data ? mapVersion(data) : null;
  }
}
