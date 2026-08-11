import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { AssetRecordSchema, ProductAssetDecisionSchema } from "@social-agent/contracts/product";
import { z } from "zod";
import { HttpError } from "../../../../../lib/auth";
import { createSupabaseServiceRoleClient, requireServerInternalAdmin } from "../../../../../lib/supabase/server";

const AssetActionSchema = z.object({ assetId: z.string().uuid(), ...ProductAssetDecisionSchema.shape }).strict();
type RouteContext = { params: Promise<{ productId: string }> };

export function parseAssetAction(input: unknown) {
  const parsed = AssetActionSchema.safeParse(input);
  if (!parsed.success) throw new Error("INVALID_ASSET_ACTION");
  return parsed.data;
}

function codeOf(error: unknown): string {
  if (error instanceof HttpError) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message;
  return "INTERNAL_ERROR";
}

function statusOf(code: string): number {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "ADMIN_REQUIRED") return 403;
  if (code === "INVALID_ASSET_ACTION") return 400;
  if (code === "PRODUCT_NOT_FOUND" || code === "ASSET_NOT_FOUND") return 404;
  if (code === "ASSET_MUST_BE_VERIFIED") return 409;
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
    throw new Error("INVALID_ASSET_ACTION");
  }
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const identity = await requireServerInternalAdmin();
    const { productId } = await context.params;
    const supabase = createSupabaseServiceRoleClient();
    await requireProduct(supabase, identity.workspaceId, productId);
    const { data, error } = await supabase.from("assets")
      .select("id,workspace_id,product_id,kind,provenance,source_locator,verification_status,public_use_allowed,verified_by,verified_at,object_key,mime_type,byte_size,width,height,sha256,created_at")
      .eq("workspace_id", identity.workspaceId).eq("product_id", productId).eq("provenance", "source").order("created_at");
    if (error) throw new Error("ASSETS_UNAVAILABLE");
    return NextResponse.json({ assets: (data ?? []).map((row) => AssetRecordSchema.parse(row)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const identity = await requireServerInternalAdmin();
    const { productId } = await context.params;
    const input = parseAssetAction(await readBody(request));
    const supabase = createSupabaseServiceRoleClient();
    await requireProduct(supabase, identity.workspaceId, productId);
    const { data: existing, error: existingError } = await supabase.from("assets")
      .select("id,verification_status,public_use_allowed,verified_by,verified_at")
      .eq("workspace_id", identity.workspaceId).eq("product_id", productId).eq("id", input.assetId).eq("provenance", "source").maybeSingle();
    if (existingError) throw new Error("ASSET_LOOKUP_FAILED");
    if (!existing) throw new Error("ASSET_NOT_FOUND");
    if (input.decision === "public-use" && existing.verification_status !== "verified") throw new Error("ASSET_MUST_BE_VERIFIED");

    const values = input.decision === "block"
      ? { verification_status: "blocked", public_use_allowed: false, verified_by: null, verified_at: null }
      : input.decision === "public-use"
        ? { public_use_allowed: true }
        : { verification_status: "verified", public_use_allowed: true, verified_by: identity.userId, verified_at: new Date().toISOString() };
    const { data: asset, error } = await supabase.from("assets")
      .update(values)
      .eq("workspace_id", identity.workspaceId).eq("product_id", productId).eq("id", input.assetId).eq("provenance", "source")
      .select("id,workspace_id,product_id,kind,provenance,source_locator,verification_status,public_use_allowed,verified_by,verified_at,object_key,mime_type,byte_size,width,height,sha256,created_at")
      .maybeSingle();
    if (error) throw new Error("ASSET_UPDATE_FAILED");
    if (!asset) throw new Error("ASSET_NOT_FOUND");
    const assetRecord = AssetRecordSchema.parse(asset);
    const { error: auditError } = await supabase.rpc("append_audit_event", {
      p_workspace_id: identity.workspaceId,
      p_event: {
        product_id: productId,
        actor_type: "user",
        actor_id: identity.userId,
        action: `asset.${input.decision}`,
        entity_type: "asset",
        entity_id: assetRecord.id,
        request_id: request.headers.get("x-request-id")?.trim() || randomUUID(),
        payload: { verificationStatus: assetRecord.verification_status, publicUseAllowed: assetRecord.public_use_allowed },
      },
    });
    if (auditError) {
      await supabase.from("assets").update({
        verification_status: existing.verification_status,
        public_use_allowed: existing.public_use_allowed,
        verified_by: existing.verified_by,
        verified_at: existing.verified_at,
      }).eq("workspace_id", identity.workspaceId).eq("product_id", productId).eq("id", asset.id)
        .eq("verification_status", assetRecord.verification_status).eq("public_use_allowed", assetRecord.public_use_allowed);
      throw new Error("AUDIT_WRITE_FAILED");
    }
    return NextResponse.json({ asset: assetRecord }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
