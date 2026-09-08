import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ProductSourceRecordSchema } from "@social-agent/contracts/product";
import { HttpError } from "../../../../../lib/workspace-context";
import { createSupabaseServiceRoleClient, requireServerInternalWorkspace } from "../../../../../lib/supabase/server";
import { parseProductSourceRequest } from "../../../../../lib/api-inputs";

type RouteContext = { params: Promise<{ productId: string }> };

function codeOf(error: unknown): string {
  if (error instanceof HttpError) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message;
  if (typeof error === "object" && error && "code" in error && error.code === "23505") return "SOURCE_ALREADY_EXISTS";
  return "INTERNAL_ERROR";
}

function statusOf(code: string): number {
  if (code === "INVALID_SOURCE_INPUT" || code === "SOURCE_LOCATOR_INVALID" || code === "IDEMPOTENCY_KEY_INVALID") return 400;
  if (code === "PRODUCT_NOT_FOUND") return 404;
  if (code === "SOURCE_ALREADY_EXISTS") return 409;
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

function idempotencyKeyFrom(request: Request): string | null {
  const value = request.headers.get("idempotency-key")?.trim() ?? "";
  if (value.length > 200) throw new Error("IDEMPOTENCY_KEY_INVALID");
  return value || null;
}

async function findIdempotentSource(
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
    .eq("action", "product_source.created")
    .eq("entity_type", "product_source")
    .limit(1)
    .maybeSingle();
  if (auditError) throw new Error("SOURCE_IDEMPOTENCY_LOOKUP_FAILED");
  if (!audit?.entity_id) return null;
  const { data: source, error } = await supabase.from("product_sources")
    .select("id,workspace_id,product_id,kind,locator,last_synced_at,created_at")
    .eq("workspace_id", workspaceId).eq("product_id", productId).eq("id", audit.entity_id).maybeSingle();
  if (error || !source) throw new Error("SOURCE_IDEMPOTENCY_LOOKUP_FAILED");
  return { source: ProductSourceRecordSchema.parse(source) };
}

export async function GET(_request: Request, routeContext: RouteContext) {
  try {
    const context = await requireServerInternalWorkspace();
    const { productId } = await routeContext.params;
    const supabase = createSupabaseServiceRoleClient();
    await requireProduct(supabase, context.workspaceId, productId);
    const { data: sources, error } = await supabase.from("product_sources").select("id,workspace_id,product_id,kind,locator,last_synced_at,created_at").eq("workspace_id", context.workspaceId).eq("product_id", productId).order("created_at");
    if (error) throw new Error("SOURCES_UNAVAILABLE");
    return NextResponse.json({ sources: (sources ?? []).map((row) => ProductSourceRecordSchema.parse(row)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, routeContext: RouteContext) {
  try {
    const context = await requireServerInternalWorkspace();
    const { productId } = await routeContext.params;
    let body: unknown;
    try {
      body = request.headers.get("content-type")?.includes("application/json") ? await request.json() : Object.fromEntries((await request.formData()).entries());
    } catch {
      throw new Error("INVALID_SOURCE_INPUT");
    }
    const input = parseProductSourceRequest(body);
    const supabase = createSupabaseServiceRoleClient();
    await requireProduct(supabase, context.workspaceId, productId);
    const idempotencyKey = idempotencyKeyFrom(request);
    const requestId = idempotencyKey || request.headers.get("x-request-id")?.trim() || randomUUID();
    if (idempotencyKey) {
      const existing = await findIdempotentSource(supabase, context.workspaceId, productId, idempotencyKey);
      if (existing) return NextResponse.json(existing, { headers: { "Cache-Control": "no-store" } });
    }
    const { data: source, error: sourceError } = await supabase.from("product_sources").insert({ workspace_id: context.workspaceId, product_id: productId, kind: input.kind, locator: input.locator }).select("id,workspace_id,product_id,kind,locator,last_synced_at,created_at").single();
    if (sourceError || !source) throw new Error("SOURCE_CREATE_FAILED");
    const sourceRecord = ProductSourceRecordSchema.parse(source);
    const { error: auditError } = await supabase.rpc("append_audit_event", {
      p_workspace_id: context.workspaceId,
      p_event: {
        product_id: productId,
        actor_type: "user",
        actor_id: context.actorId,
        action: "product_source.created",
        entity_type: "product_source",
        entity_id: sourceRecord.id,
        request_id: requestId,
        payload: { kind: sourceRecord.kind, locator: sourceRecord.locator },
      },
    });
    if (auditError) {
      const { error: rollbackError } = await supabase.from("product_sources").delete()
        .eq("workspace_id", context.workspaceId).eq("product_id", productId).eq("id", source.id);
      if (rollbackError) throw new Error("SOURCE_ROLLBACK_FAILED");
      throw new Error("AUDIT_WRITE_FAILED");
    }
    return NextResponse.json({ source: sourceRecord }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
