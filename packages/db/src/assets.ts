import type { AssetRecord, AssetRepository, RepositoryContext } from "./index.js";
import { databaseError, type DatabaseClient } from "./client.js";

const mapAsset = (row: Record<string, any>): AssetRecord => ({
  id: row.id, workspaceId: row.workspace_id, productId: row.product_id,
  contentVersionId: row.content_version_id, objectKey: row.object_key, sha256: row.sha256,
  verificationStatus: row.verification_status, publicUseAllowed: row.public_use_allowed,
});
export class SupabaseAssetRepository implements AssetRepository {
  constructor(private readonly db: DatabaseClient) {}
  async insertCandidates(ctx: RepositoryContext, input: Omit<AssetRecord, "id" | "workspaceId">[]) {
    if (input.length === 0) return [];
    const { data, error } = await this.db.from("assets").insert(input.map((asset) => ({
      workspace_id: ctx.workspaceId, product_id: asset.productId,
      content_version_id: asset.contentVersionId, kind: asset.contentVersionId ? "carousel_page" : "brand_asset",
      provenance: asset.contentVersionId ? "generated" : "source",
      verification_status: asset.verificationStatus, public_use_allowed: asset.publicUseAllowed,
      verified_by: asset.verificationStatus === "verified" ? ctx.actor.id : null,
      verified_at: asset.verificationStatus === "verified" ? new Date().toISOString() : null,
      object_key: asset.objectKey, mime_type: "image/png", byte_size: 1, sha256: asset.sha256,
    }))).select("*");
    if (error) throw databaseError(error);
    return (data ?? []).map(mapAsset);
  }
  async listUsable(ctx: Pick<RepositoryContext, "workspaceId">, productId: string) {
    const { data, error } = await this.db.from("assets").select("*")
      .eq("workspace_id", ctx.workspaceId).eq("product_id", productId)
      .eq("verification_status", "verified").eq("public_use_allowed", true).order("created_at");
    if (error) throw databaseError(error);
    return (data ?? []).map(mapAsset);
  }
  async listGeneratedForVersion(ctx: Pick<RepositoryContext, "workspaceId">, contentVersionId: string) {
    const { data, error } = await this.db.from("assets").select("*")
      .eq("workspace_id", ctx.workspaceId).eq("content_version_id", contentVersionId)
      .eq("provenance", "generated").order("object_key");
    if (error) throw databaseError(error);
    return (data ?? []).map(mapAsset);
  }
}
