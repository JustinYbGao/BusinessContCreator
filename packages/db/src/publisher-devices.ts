import type { PublisherDeviceRepository, RepositoryContext } from "./index.js";
import { databaseError, type DatabaseClient } from "./client.js";

export class SupabasePublisherDeviceRepository implements PublisherDeviceRepository {
  constructor(private readonly db: DatabaseClient) {}
  async create(ctx: RepositoryContext, name: string, tokenSha256: string) {
    const { data, error } = await this.db.from("publisher_devices").insert({
      workspace_id: ctx.workspaceId, name, token_sha256: tokenSha256,
    }).select("id,workspace_id").single();
    if (error || !data) throw databaseError(error);
    return { id: data.id, workspaceId: data.workspace_id };
  }
  async revoke(ctx: RepositoryContext, id: string) {
    const { data, error } = await this.db.from("publisher_devices")
      .update({ revoked_at: new Date().toISOString() }).eq("workspace_id", ctx.workspaceId)
      .eq("id", id).is("revoked_at", null).select("id").maybeSingle();
    if (error) throw databaseError(error);
    if (!data) throw new Error("DEVICE_NOT_FOUND");
  }
  async resolveByTokenHash(tokenSha256: string) {
    const { data, error } = await this.db.from("publisher_devices").select("id,workspace_id")
      .eq("token_sha256", tokenSha256).is("revoked_at", null).maybeSingle();
    if (error) throw databaseError(error);
    return data ? { id: data.id, workspaceId: data.workspace_id } : null;
  }
}
