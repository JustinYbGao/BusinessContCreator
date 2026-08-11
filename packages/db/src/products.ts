import type { ProductRecord, ProductRepository, ProductSourceRecord, ProductSourceRepository, RepositoryContext } from "./index.js";
import { auditInput, databaseError, type DatabaseClient } from "./client.js";

const mapProduct = (row: Record<string, any>): ProductRecord => ({
  id: row.id, workspaceId: row.workspace_id, name: row.name, slug: row.slug,
  positioning: row.positioning, brandProfile: row.brand_profile, deletedAt: row.deleted_at,
});
const mapSource = (row: Record<string, any>): ProductSourceRecord => ({
  id: row.id, workspaceId: row.workspace_id, productId: row.product_id, kind: row.kind, locator: row.locator,
});

export class SupabaseProductRepository implements ProductRepository {
  constructor(private readonly db: DatabaseClient) {}
  async create(ctx: RepositoryContext, input: Pick<ProductRecord, "name" | "slug" | "positioning" | "brandProfile">) {
    const { data, error } = await this.db.from("products").insert({
      workspace_id: ctx.workspaceId, name: input.name, slug: input.slug,
      positioning: input.positioning, brand_profile: input.brandProfile,
    }).select("*").single();
    if (error || !data) throw databaseError(error);
    return mapProduct(data);
  }
  async list(ctx: Pick<RepositoryContext, "workspaceId">) {
    const { data, error } = await this.db.from("products").select("*")
      .eq("workspace_id", ctx.workspaceId).is("deleted_at", null).order("created_at");
    if (error) throw databaseError(error);
    return (data ?? []).map(mapProduct);
  }
  async softDelete(ctx: RepositoryContext, id: string, exactName: string) {
    const { data, error } = await this.db.rpc("soft_delete_product", {
      p_workspace_id: ctx.workspaceId, p_product_id: id, p_exact_name: exactName,
      p_audit_event: auditInput(ctx, { productId: id, action: "product.soft_deleted", entityType: "product", entityId: id }),
    });
    if (error || !data) {
      if (error?.message.includes("PRODUCT_NOT_FOUND")) throw new Error("PRODUCT_NOT_FOUND");
      throw databaseError(error);
    }
    return mapProduct(data as Record<string, any>);
  }
}

export class SupabaseProductSourceRepository implements ProductSourceRepository {
  constructor(private readonly db: DatabaseClient) {}
  async create(ctx: RepositoryContext, input: Omit<ProductSourceRecord, "id" | "workspaceId">) {
    const { data, error } = await this.db.from("product_sources").insert({
      workspace_id: ctx.workspaceId, product_id: input.productId, kind: input.kind, locator: input.locator,
    }).select("*").single();
    if (error || !data) throw databaseError(error);
    return mapSource(data);
  }
  async list(ctx: Pick<RepositoryContext, "workspaceId">, productId: string) {
    const { data, error } = await this.db.from("product_sources").select("*")
      .eq("workspace_id", ctx.workspaceId).eq("product_id", productId).order("created_at");
    if (error) throw databaseError(error);
    return (data ?? []).map(mapSource);
  }
}
