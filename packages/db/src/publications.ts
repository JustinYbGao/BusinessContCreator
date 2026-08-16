import { PublicationTransitionMap, type Publication } from "@social-agent/contracts";
import type { PublicationAnalyticsRecord, PublicationRepository, RepositoryContext } from "./index.js";
import { databaseError, type DatabaseClient } from "./client.js";

const mapPublication = (row: Record<string, any>): Publication => ({
  id: row.id, workspaceId: row.workspace_id, productId: row.product_id,
  status: row.status, package: row.package,
});

const mapPublicationAnalytics = (row: Record<string, any>): PublicationAnalyticsRecord => ({
  ...mapPublication(row),
  campaignId: row.campaign_id,
  publicUrl: row.public_url ?? null,
  publishedAt: row.published_at ?? null,
});

export class SupabasePublicationRepository implements PublicationRepository {
  constructor(private readonly db: DatabaseClient) {}
  async create(ctx: RepositoryContext, input: { contentVersionId: string; idempotencyKey: string }) {
    const { data, error } = await this.db.rpc("create_publication", {
      p_workspace_id: ctx.workspaceId, p_content_version_id: input.contentVersionId,
      p_idempotency_key: input.idempotencyKey, p_actor_type: ctx.actor.type,
      p_actor_id: ctx.actor.id, p_request_id: ctx.requestId,
    });
    if (error || !data) throw databaseError(error);
    return mapPublication(data as Record<string, any>);
  }
  async get(ctx: Pick<RepositoryContext, "workspaceId">, id: string) {
    const { data, error } = await this.db.from("publications").select("*")
      .eq("workspace_id", ctx.workspaceId).eq("id", id).maybeSingle();
    if (error) throw databaseError(error);
    return data ? mapPublication(data) : null;
  }
  async registerPublished(ctx: RepositoryContext, id: string, input: { publicUrl: string; publishedAt: string }) {
    const { data, error } = await this.db.rpc("register_publication", {
      p_workspace_id: ctx.workspaceId,
      p_publication_id: id,
      p_public_url: input.publicUrl,
      p_published_at: input.publishedAt,
      p_actor_id: ctx.actor.id,
      p_request_id: ctx.requestId,
    });
    if (error || !data) throw databaseError(error);
    return mapPublicationAnalytics(data as Record<string, any>);
  }
  async getAnalytics(ctx: Pick<RepositoryContext, "workspaceId">, id: string) {
    const { data, error } = await this.db.from("publications")
      .select("*").eq("workspace_id", ctx.workspaceId).eq("id", id).maybeSingle();
    if (error) throw databaseError(error);
    return data ? mapPublicationAnalytics(data) : null;
  }
  async transition(ctx: RepositoryContext, id: string, expected: Publication["status"], next: Publication["status"]) {
    if (!PublicationTransitionMap[expected].includes(next)) throw new Error("INVALID_PUBLICATION_TRANSITION");
    const { data, error } = await this.db.rpc("transition_publication", {
      p_workspace_id: ctx.workspaceId, p_publication_id: id, p_device_id: null,
      p_expected: expected, p_next: next, p_actor_type: ctx.actor.type,
      p_actor_id: ctx.actor.id, p_request_id: ctx.requestId,
    });
    if (error || !data) throw databaseError(error);
    return mapPublication(data as Record<string, any>);
  }
  async claimNextForDevice(ctx: RepositoryContext, deviceId: string) {
    const { data, error } = await this.db.rpc("claim_publication_for_device", {
      p_workspace_id: ctx.workspaceId, p_device_id: deviceId,
      p_actor_id: ctx.actor.id, p_request_id: ctx.requestId,
    });
    if (error) throw databaseError(error);
    return data ? mapPublication(data as Record<string, any>) : null;
  }
  async transitionClaimedForDevice(ctx: RepositoryContext, deviceId: string, id: string, expected: Publication["status"], next: Publication["status"]) {
    if (!PublicationTransitionMap[expected].includes(next)) throw new Error("INVALID_PUBLICATION_TRANSITION");
    const { data, error } = await this.db.rpc("transition_publication", {
      p_workspace_id: ctx.workspaceId, p_publication_id: id, p_device_id: deviceId,
      p_expected: expected, p_next: next, p_actor_type: ctx.actor.type,
      p_actor_id: ctx.actor.id, p_request_id: ctx.requestId,
    });
    if (error || !data) throw databaseError(error);
    return mapPublication(data as Record<string, any>);
  }
}
