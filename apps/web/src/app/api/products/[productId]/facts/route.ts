import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ProductCategorySchema, ProductFactDecisionSchema, ProductFactRecordSchema, ProductSourceRecordSchema } from "@social-agent/contracts/product";
import { z } from "zod";
import { HttpError } from "../../../../../lib/auth";
import { createSupabaseServiceRoleClient, requireServerInternalAdmin } from "../../../../../lib/supabase/server";

const FactActionSchema = z.object({ factId: z.string().uuid(), ...ProductFactDecisionSchema.shape }).strict();
const ManualFactSchema = z.object({ statement: z.string().trim().min(1).max(2_000), category: ProductCategorySchema, sourceNote: z.string().trim().min(1).max(500) }).strict();
type RouteContext = { params: Promise<{ productId: string }> };

export function parseFactAction(input: unknown) {
  const parsed = FactActionSchema.safeParse(input);
  if (!parsed.success || (parsed.data.decision === "edit-and-verify" && !parsed.data.editedStatement)) throw new Error("INVALID_FACT_ACTION");
  return parsed.data;
}

function codeOf(error: unknown): string {
  if (error instanceof HttpError) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message;
  if (typeof error === "object" && error && "code" in error && error.code === "23505") return "FACT_ALREADY_EXISTS";
  return "INTERNAL_ERROR";
}

function statusOf(code: string): number {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "ADMIN_REQUIRED") return 403;
  if (code === "INVALID_FACT_ACTION" || code === "INVALID_MANUAL_FACT" || code === "IDEMPOTENCY_KEY_INVALID") return 400;
  if (code === "PRODUCT_NOT_FOUND" || code === "FACT_NOT_FOUND") return 404;
  if (code === "FACT_ALREADY_EXISTS") return 409;
  return 500;
}

function errorResponse(error: unknown) {
  const code = codeOf(error);
  return NextResponse.json({ ok: false, error: code }, { status: statusOf(code), headers: { "Cache-Control": "no-store" } });
}

async function requireProduct(supabase: ReturnType<typeof createSupabaseServiceRoleClient>, workspaceId: string, productId: string) {
  const { data, error } = await supabase.from("products").select("id").eq("workspace_id", workspaceId).eq("id", productId).is("deleted_at", null).maybeSingle();
  if (error || !data) throw new Error("PRODUCT_NOT_FOUND");
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return request.headers.get("content-type")?.includes("application/json") ? await request.json() : Object.fromEntries((await request.formData()).entries());
  } catch {
    throw new Error("INVALID_FACT_ACTION");
  }
}

async function appendAudit(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  workspaceId: string,
  actorId: string,
  requestId: string,
  productId: string,
  entityType: string,
  entityId: string,
  action: string,
  payload: unknown,
) {
  const { error } = await supabase.rpc("append_audit_event", {
    p_workspace_id: workspaceId,
    p_event: { product_id: productId, actor_type: "user", actor_id: actorId, action, entity_type: entityType, entity_id: entityId, request_id: requestId, payload },
  });
  if (error) throw new Error("AUDIT_WRITE_FAILED");
}

function idempotencyKeyFrom(request: Request): string | null {
  const value = request.headers.get("idempotency-key")?.trim() ?? "";
  if (value.length > 200) throw new Error("IDEMPOTENCY_KEY_INVALID");
  return value || null;
}

async function findIdempotentManualFact(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  workspaceId: string,
  productId: string,
  idempotencyKey: string,
) {
  const { data: audit, error: auditError } = await supabase
    .from("audit_events")
    .select("entity_id")
    .eq("workspace_id", workspaceId)
    .eq("product_id", productId)
    .eq("request_id", idempotencyKey)
    .eq("action", "product_fact.candidate_created")
    .eq("entity_type", "product_fact")
    .limit(1)
    .maybeSingle();
  if (auditError) throw new Error("FACT_IDEMPOTENCY_LOOKUP_FAILED");
  if (!audit?.entity_id) return null;
  const { data: fact, error: factError } = await supabase.from("product_facts")
    .select("id,workspace_id,product_id,source_id,statement,category,source_locator,evidence_excerpt,status,public_use_allowed,verified_by,verified_at,created_at")
    .eq("workspace_id", workspaceId).eq("product_id", productId).eq("id", audit.entity_id).maybeSingle();
  if (factError || !fact) throw new Error("FACT_IDEMPOTENCY_LOOKUP_FAILED");
  const { data: source, error: sourceError } = await supabase.from("product_sources")
    .select("id,workspace_id,product_id,kind,locator,last_synced_at,created_at")
    .eq("workspace_id", workspaceId).eq("product_id", productId).eq("id", fact.source_id).maybeSingle();
  if (sourceError || !source) throw new Error("FACT_IDEMPOTENCY_LOOKUP_FAILED");
  return { source: ProductSourceRecordSchema.parse(source), fact: ProductFactRecordSchema.parse(fact) };
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const identity = await requireServerInternalAdmin();
    const { productId } = await context.params;
    const supabase = createSupabaseServiceRoleClient();
    await requireProduct(supabase, identity.workspaceId, productId);
    const { data, error } = await supabase.from("product_facts")
      .select("id,workspace_id,product_id,source_id,statement,category,source_locator,evidence_excerpt,status,public_use_allowed,verified_by,verified_at,created_at")
      .eq("workspace_id", identity.workspaceId).eq("product_id", productId).order("created_at");
    if (error) throw new Error("FACTS_UNAVAILABLE");
    return NextResponse.json({ facts: (data ?? []).map((row) => ProductFactRecordSchema.parse(row)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const identity = await requireServerInternalAdmin();
    const { productId } = await context.params;
    const body = await readBody(request);
    const supabase = createSupabaseServiceRoleClient();
    await requireProduct(supabase, identity.workspaceId, productId);
    const idempotencyKey = idempotencyKeyFrom(request);
    const requestId = idempotencyKey || request.headers.get("x-request-id")?.trim() || randomUUID();

    if (body && typeof body === "object" && "factId" in body) {
      const input = parseFactAction(body);
      const { data: previousFact, error: previousFactError } = await supabase.from("product_facts")
        .select("id,statement,status,public_use_allowed,verified_by,verified_at")
        .eq("workspace_id", identity.workspaceId).eq("product_id", productId).eq("id", input.factId).maybeSingle();
      if (previousFactError) throw new Error("FACT_LOOKUP_FAILED");
      if (!previousFact) throw new Error("FACT_NOT_FOUND");
      const values = input.decision === "block"
        ? { status: "blocked", public_use_allowed: false, verified_by: null, verified_at: null }
        : { status: "verified", public_use_allowed: true, verified_by: identity.userId, verified_at: new Date().toISOString(), ...(input.editedStatement ? { statement: input.editedStatement.trim() } : {}) };
      const { data: fact, error } = await supabase.from("product_facts")
        .update(values)
        .eq("workspace_id", identity.workspaceId).eq("product_id", productId).eq("id", input.factId)
        .select("id,workspace_id,product_id,source_id,statement,category,source_locator,evidence_excerpt,status,public_use_allowed,verified_by,verified_at,created_at")
        .maybeSingle();
      if (error) throw new Error("FACT_UPDATE_FAILED");
      if (!fact) throw new Error("FACT_NOT_FOUND");
      const factRecord = ProductFactRecordSchema.parse(fact);
      try {
        await appendAudit(supabase, identity.workspaceId, identity.userId, requestId, productId, "product_fact", factRecord.id, `product_fact.${input.decision}`, { publicUseAllowed: factRecord.public_use_allowed, verifiedAt: factRecord.verified_at });
      } catch (auditError) {
        await supabase.from("product_facts").update({
          statement: previousFact.statement,
          status: previousFact.status,
          public_use_allowed: previousFact.public_use_allowed,
          verified_by: previousFact.verified_by,
          verified_at: previousFact.verified_at,
        }).eq("workspace_id", identity.workspaceId).eq("product_id", productId).eq("id", factRecord.id)
          .eq("status", factRecord.status).eq("public_use_allowed", factRecord.public_use_allowed);
        throw auditError;
      }
      return NextResponse.json({ fact: factRecord }, { headers: { "Cache-Control": "no-store" } });
    }

    const manualInput = ManualFactSchema.safeParse(body);
    if (!manualInput.success) throw new Error("INVALID_MANUAL_FACT");
    if (idempotencyKey) {
      const existing = await findIdempotentManualFact(supabase, identity.workspaceId, productId, idempotencyKey);
      if (existing) return NextResponse.json(existing, { headers: { "Cache-Control": "no-store" } });
    }
    const candidate = {
      statement: manualInput.data.statement.trim(),
      category: manualInput.data.category,
      sourceLocator: "manual/operator-note",
      evidenceExcerpt: manualInput.data.sourceNote.trim(),
    };
    const { data: source, error: sourceError } = await supabase.from("product_sources")
      .insert({ workspace_id: identity.workspaceId, product_id: productId, kind: "manual", locator: candidate.sourceLocator })
      .select("id,workspace_id,product_id,kind,locator,last_synced_at,created_at")
      .single();
    if (sourceError || !source) throw new Error("MANUAL_SOURCE_CREATE_FAILED");
    const sourceRecord = ProductSourceRecordSchema.parse(source);
    try {
      await appendAudit(supabase, identity.workspaceId, identity.userId, requestId, productId, "product_source", sourceRecord.id, "product_source.created", { kind: "manual" });
    } catch (error) {
      await supabase.from("product_sources").delete().eq("workspace_id", identity.workspaceId).eq("product_id", productId).eq("id", source.id);
      throw error;
    }
    const { data: fact, error: factError } = await supabase.from("product_facts")
      .insert({ workspace_id: identity.workspaceId, product_id: productId, source_id: sourceRecord.id, statement: candidate.statement, category: candidate.category, source_locator: candidate.sourceLocator, evidence_excerpt: candidate.evidenceExcerpt, status: "candidate", public_use_allowed: false, verified_by: null, verified_at: null })
      .select("id,workspace_id,product_id,source_id,statement,category,source_locator,evidence_excerpt,status,public_use_allowed,verified_by,verified_at,created_at")
      .single();
    if (factError || !fact) {
      await supabase.from("product_sources").delete().eq("workspace_id", identity.workspaceId).eq("product_id", productId).eq("id", source.id);
      throw new Error("MANUAL_FACT_CREATE_FAILED");
    }
    const factRecord = ProductFactRecordSchema.parse(fact);
    try {
      await appendAudit(supabase, identity.workspaceId, identity.userId, requestId, productId, "product_fact", factRecord.id, "product_fact.candidate_created", { sourceId: sourceRecord.id });
    } catch (error) {
      await supabase.from("product_facts").delete().eq("workspace_id", identity.workspaceId).eq("product_id", productId).eq("id", factRecord.id);
      await supabase.from("product_sources").delete().eq("workspace_id", identity.workspaceId).eq("product_id", productId).eq("id", sourceRecord.id);
      throw error;
    }
    return NextResponse.json({ source: sourceRecord, fact: factRecord }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
