import type { CampaignRecord, CampaignRepository, RepositoryContext } from "./index.js";
import { databaseError, type DatabaseClient } from "./client.js";

const mapCampaign = (row: Record<string, any>): CampaignRecord => ({
  id: row.id, workspaceId: row.workspace_id, productId: row.product_id, channelId: row.channel_id,
  name: row.name, goal: row.goal, audience: row.audience, startsOn: row.starts_on,
  endsOn: row.ends_on, pillarQuotas: row.pillar_quotas,
});
export class SupabaseCampaignRepository implements CampaignRepository {
  constructor(private readonly db: DatabaseClient) {}
  async create(ctx: RepositoryContext, input: Omit<CampaignRecord, "id" | "workspaceId">) {
    const { data, error } = await this.db.from("campaigns").insert({
      workspace_id: ctx.workspaceId, product_id: input.productId, channel_id: input.channelId,
      name: input.name, goal: input.goal, audience: input.audience, starts_on: input.startsOn,
      ends_on: input.endsOn, pillar_quotas: input.pillarQuotas,
    }).select("*").single();
    if (error || !data) throw databaseError(error);
    return mapCampaign(data);
  }
  async get(ctx: Pick<RepositoryContext, "workspaceId">, id: string) {
    const { data, error } = await this.db.from("campaigns").select("*").eq("workspace_id", ctx.workspaceId).eq("id", id).maybeSingle();
    if (error) throw databaseError(error);
    return data ? mapCampaign(data) : null;
  }
  async listByProduct(ctx: Pick<RepositoryContext, "workspaceId">, productId: string) {
    const { data, error } = await this.db.from("campaigns").select("*").eq("workspace_id", ctx.workspaceId).eq("product_id", productId).order("created_at");
    if (error) throw databaseError(error);
    return (data ?? []).map(mapCampaign);
  }
}
