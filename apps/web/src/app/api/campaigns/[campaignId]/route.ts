import { NextResponse } from "next/server";
import { CampaignRecordSchema } from "@social-agent/contracts/product";
import { HttpError } from "../../../../lib/auth";
import { createSupabaseServiceRoleClient, requireServerInternalAdmin } from "../../../../lib/supabase/server";

type RouteContext = { params: Promise<{ campaignId: string }> };

function codeOf(error: unknown): string {
  if (error instanceof HttpError) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message;
  return "INTERNAL_ERROR";
}

function statusOf(code: string): number {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "ADMIN_REQUIRED") return 403;
  if (code === "CAMPAIGN_NOT_FOUND") return 404;
  return 500;
}

function errorResponse(error: unknown) {
  const code = codeOf(error);
  return NextResponse.json({ ok: false, error: code }, { status: statusOf(code), headers: { "Cache-Control": "no-store" } });
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const identity = await requireServerInternalAdmin();
    const { campaignId } = await context.params;
    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase.from("campaigns")
      .select("id,workspace_id,product_id,channel_id,name,goal,audience,pillar_quotas,starts_on,ends_on,created_at")
      .eq("workspace_id", identity.workspaceId).eq("id", campaignId).maybeSingle();
    if (error || !data) throw new Error("CAMPAIGN_NOT_FOUND");
    const { data: product, error: productError } = await supabase.from("products").select("id").eq("workspace_id", identity.workspaceId).eq("id", data.product_id).is("deleted_at", null).maybeSingle();
    if (productError || !product) throw new Error("CAMPAIGN_NOT_FOUND");
    return NextResponse.json({ campaign: CampaignRecordSchema.parse(data) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
