import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ChannelRecordSchema, ProductCreateInputSchema, ProductRecordSchema } from "@social-agent/contracts/product";
import { createSupabaseServiceRoleClient, requireServerInternalAdmin } from "../../../lib/supabase/server";
import { HttpError } from "../../../lib/auth";

function normalizeProductRequest(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;
  return { ...record, slug: typeof record.slug === "string" ? record.slug.trim().toLowerCase() : record.slug };
}

export function parseProductRequest(input: unknown) {
  const parsed = ProductCreateInputSchema.safeParse(normalizeProductRequest(input));
  if (!parsed.success) throw new Error("INVALID_PRODUCT_INPUT");
  return parsed.data;
}

function errorCode(error: unknown): string {
  if (error instanceof HttpError) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message;
  if (typeof error === "object" && error && "code" in error && typeof error.code === "string") {
    if (error.code === "23505") return "PRODUCT_ALREADY_EXISTS";
  }
  return "INTERNAL_ERROR";
}

function errorStatus(code: string): number {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "ADMIN_REQUIRED") return 403;
  if (code === "INVALID_PRODUCT_INPUT" || code === "IDEMPOTENCY_KEY_INVALID") return 400;
  if (code === "PRODUCT_ALREADY_EXISTS") return 409;
  return 500;
}

function responseError(error: unknown) {
  const code = errorCode(error);
  return NextResponse.json({ ok: false, error: code }, { status: errorStatus(code), headers: { "Cache-Control": "no-store" } });
}

async function appendAudit(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  identity: { userId: string; workspaceId: string },
  requestId: string,
  productId: string,
  entityId: string,
  action: string,
  payload: unknown,
) {
  const { error } = await supabase.rpc("append_audit_event", {
    p_workspace_id: identity.workspaceId,
    p_event: {
      product_id: productId,
      actor_type: "user",
      actor_id: identity.userId,
      action,
      entity_type: "product",
      entity_id: entityId,
      request_id: requestId,
      payload,
    },
  });
  if (error) throw new Error("AUDIT_WRITE_FAILED");
}

function idempotencyKeyFrom(request: Request): string | null {
  const value = request.headers.get("idempotency-key")?.trim() ?? "";
  if (value.length > 200) throw new Error("IDEMPOTENCY_KEY_INVALID");
  return value || null;
}

async function findIdempotentProduct(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  workspaceId: string,
  idempotencyKey: string,
) {
  const { data: audit, error: auditError } = await supabase
    .from("audit_events")
    .select("entity_id")
    .eq("workspace_id", workspaceId)
    .eq("request_id", idempotencyKey)
    .eq("action", "product.created")
    .eq("entity_type", "product")
    .limit(1)
    .maybeSingle();
  if (auditError) throw new Error("PRODUCT_IDEMPOTENCY_LOOKUP_FAILED");
  if (!audit?.entity_id) return null;

  const [productResult, channelResult] = await Promise.all([
    supabase.from("products").select("id,workspace_id,name,slug,positioning,brand_profile,deleted_at,created_at").eq("workspace_id", workspaceId).eq("id", audit.entity_id).maybeSingle(),
    supabase.from("channels").select("id,workspace_id,product_id,kind,status,settings,created_at").eq("workspace_id", workspaceId).eq("product_id", audit.entity_id).eq("kind", "xiaohongshu").maybeSingle(),
  ]);
  if (productResult.error || channelResult.error || !productResult.data || !channelResult.data) {
    throw new Error("PRODUCT_IDEMPOTENCY_LOOKUP_FAILED");
  }
  return { product: ProductRecordSchema.parse(productResult.data), channel: ChannelRecordSchema.parse(channelResult.data) };
}

export async function GET() {
  try {
    const identity = await requireServerInternalAdmin();
    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase
      .from("products")
      .select("id,workspace_id,name,slug,positioning,brand_profile,deleted_at,created_at")
      .eq("workspace_id", identity.workspaceId)
      .is("deleted_at", null)
      .order("created_at");
    if (error) throw new Error("PRODUCTS_UNAVAILABLE");
    return NextResponse.json({ products: (data ?? []).map((row) => ProductRecordSchema.parse(row)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return responseError(error);
  }
}

export async function POST(request: Request) {
  try {
    const identity = await requireServerInternalAdmin();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new Error("INVALID_PRODUCT_INPUT");
    }
    const input = parseProductRequest(body);
    const supabase = createSupabaseServiceRoleClient();
    const idempotencyKey = idempotencyKeyFrom(request);
    const requestId = idempotencyKey || request.headers.get("x-request-id")?.trim() || randomUUID();
    if (idempotencyKey) {
      const existing = await findIdempotentProduct(supabase, identity.workspaceId, idempotencyKey);
      if (existing) return NextResponse.json(existing, { headers: { "Cache-Control": "no-store" } });
    }
    const { data: product, error: productError } = await supabase
      .from("products")
      .insert({
        workspace_id: identity.workspaceId,
        name: input.name,
        slug: input.slug,
        positioning: input.positioning,
        brand_profile: input.brandProfile,
      })
      .select("id,workspace_id,name,slug,positioning,brand_profile,deleted_at,created_at")
      .single();
    if (productError || !product) {
      if (productError?.code === "23505") throw new Error("PRODUCT_ALREADY_EXISTS");
      throw new Error("PRODUCT_CREATE_FAILED");
    }
    const productRecord = ProductRecordSchema.parse(product);

    const { data: channel, error: channelError } = await supabase
      .from("channels")
      .insert({ workspace_id: identity.workspaceId, product_id: product.id, kind: "xiaohongshu", status: "active", settings: {} })
      .select("id,workspace_id,product_id,kind,status,settings,created_at")
      .single();
    if (channelError || !channel) {
      await supabase.from("products").delete().eq("workspace_id", identity.workspaceId).eq("id", product.id);
      throw new Error("PRODUCT_CHANNEL_CREATE_FAILED");
    }
    const channelRecord = ChannelRecordSchema.parse(channel);

    try {
      await appendAudit(supabase, identity, requestId, productRecord.id, productRecord.id, "product.created", { slug: productRecord.slug, channelId: channelRecord.id, idempotencyKey });
    } catch (error) {
      await supabase.from("channels").delete().eq("workspace_id", identity.workspaceId).eq("id", channel.id);
      await supabase.from("products").delete().eq("workspace_id", identity.workspaceId).eq("id", product.id);
      throw error;
    }

    return NextResponse.json({ product: productRecord, channel: channelRecord }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return responseError(error);
  }
}
