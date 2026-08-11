import type { ProductFactCandidate } from "@social-agent/contracts";
import type { ProductFactRepository, RepositoryContext } from "./index.js";
import { databaseError, type DatabaseClient } from "./client.js";

export class SupabaseProductFactRepository implements ProductFactRepository {
  constructor(private readonly db: DatabaseClient) {}
  async insertCandidates(ctx: RepositoryContext, productId: string, sourceId: string, facts: ProductFactCandidate[]) {
    if (facts.length === 0) return;
    const { error } = await this.db.from("product_facts").insert(facts.map((fact) => ({
      workspace_id: ctx.workspaceId, product_id: productId, source_id: sourceId,
      statement: fact.statement, category: fact.category, source_locator: fact.sourceLocator,
      evidence_excerpt: fact.evidenceExcerpt, status: "candidate",
    })));
    if (error) throw databaseError(error);
  }
  async listUsable(ctx: Pick<RepositoryContext, "workspaceId">, productId: string) {
    const { data, error } = await this.db.from("product_facts").select("id,statement,category")
      .eq("workspace_id", ctx.workspaceId).eq("product_id", productId)
      .eq("status", "verified").eq("public_use_allowed", true).order("created_at");
    if (error) throw databaseError(error);
    return (data ?? []) as { id: string; statement: string; category: string }[];
  }
  async decide(ctx: RepositoryContext, factId: string, decision: "verify" | "block", editedStatement?: string) {
    const values = decision === "verify" ? {
      status: "verified", public_use_allowed: true, verified_by: ctx.actor.id,
      verified_at: new Date().toISOString(), ...(editedStatement ? { statement: editedStatement } : {}),
    } : { status: "blocked", public_use_allowed: false, verified_by: null, verified_at: null };
    const { data, error } = await this.db.from("product_facts").update(values)
      .eq("workspace_id", ctx.workspaceId).eq("id", factId).select("id").maybeSingle();
    if (error) throw databaseError(error);
    if (!data) throw new Error("FACT_NOT_FOUND");
  }
}
