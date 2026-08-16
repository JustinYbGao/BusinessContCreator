import type { LearningRecord, LearningRepository, RepositoryContext } from "./index.js";
import { databaseError, type DatabaseClient } from "./client.js";

const mapLearning = (row: Record<string, any>): LearningRecord => ({
  id: row.id, workspaceId: row.workspace_id, productId: row.product_id,
  publicationId: row.publication_id, evidenceWindow: row.evidence_window, payload: row.payload,
});
export class SupabaseLearningRepository implements LearningRepository {
  constructor(private readonly db: DatabaseClient) {}
  async create(ctx: RepositoryContext, input: Omit<LearningRecord, "id" | "workspaceId">) {
    const { data, error } = await this.db.rpc("create_learning", {
      p_workspace_id: ctx.workspaceId,
      p_product_id: input.productId,
      p_publication_id: input.publicationId,
      p_evidence_window: input.evidenceWindow,
      p_payload: input.payload,
      p_actor_id: ctx.actor.id,
      p_request_id: ctx.requestId,
    });
    if (error || !data) throw databaseError(error);
    return mapLearning(data);
  }
  async listEligible(ctx: Pick<RepositoryContext, "workspaceId">, productId: string, campaignId: string) {
    const { data, error } = await this.db.from("learnings")
      .select("*,publications!inner(campaign_id)").eq("workspace_id", ctx.workspaceId)
      .eq("product_id", productId).eq("publications.campaign_id", campaignId).order("created_at");
    if (error) throw databaseError(error);
    return (data ?? []).map(mapLearning);
  }
}
