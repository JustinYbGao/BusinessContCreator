import type { RepositoryContext, ReviewRepository, ReviewRunRecord } from "./index.js";
import { databaseError, type DatabaseClient } from "./client.js";

const mapRun = (row: Record<string, any>): ReviewRunRecord => ({
  id: row.id, contentVersionId: row.content_version_id, runNumber: row.run_number,
  isCurrent: row.is_current, result: row.result,
});
export class SupabaseReviewRepository implements ReviewRepository {
  constructor(private readonly db: DatabaseClient) {}
  async replaceCurrentRun(ctx: RepositoryContext, contentVersionId: string, reviewContext: unknown, findings: { code: string; severity: "blocking" | "advisory"; message: string }[]) {
    const { data, error } = await this.db.rpc("replace_current_review_run_with_context", {
      p_workspace_id: ctx.workspaceId, p_content_version_id: contentVersionId,
      p_findings: findings, p_review_context: reviewContext,
      p_actor_type: ctx.actor.type, p_actor_id: ctx.actor.id,
      p_request_id: ctx.requestId,
    });
    if (error || !data) throw databaseError(error);
    return mapRun(data as Record<string, any>);
  }
  async getCurrent(ctx: Pick<RepositoryContext, "workspaceId">, contentVersionId: string) {
    const { data, error } = await this.db.from("review_runs")
      .select("*,content_versions!inner(workspace_id)").eq("content_version_id", contentVersionId)
      .eq("content_versions.workspace_id", ctx.workspaceId).eq("is_current", true).maybeSingle();
    if (error) throw databaseError(error);
    return data ? mapRun(data) : null;
  }
}
