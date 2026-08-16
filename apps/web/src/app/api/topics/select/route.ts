import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { HttpError } from "../../../../lib/auth";
import { parseTopicSelectionRequest } from "../../../../lib/api-inputs";
import { createSupabaseServiceRoleClient, requireServerInternalAdmin } from "../../../../lib/supabase/server";

function errorCode(error: unknown): string {
  if (error instanceof HttpError) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message;
  return "INTERNAL_ERROR";
}

function errorStatus(code: string): number {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "ADMIN_REQUIRED") return 403;
  if (code === "INVALID_TOPIC_SELECTION_INPUT") return 400;
  if (code === "CAMPAIGN_NOT_FOUND") return 404;
  if (code === "TOPIC_SCOPE_MISMATCH") return 409;
  return 500;
}

async function requestBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return request.json();
  const form = await request.formData();
  return {
    campaignId: form.get("campaignId"),
    topicIds: form.getAll("topicId"),
  };
}

export async function POST(request: Request) {
  try {
    const identity = await requireServerInternalAdmin();
    const body = await requestBody(request).catch(() => { throw new Error("INVALID_TOPIC_SELECTION_INPUT"); });
    const input = parseTopicSelectionRequest(body);
    const supabase = createSupabaseServiceRoleClient();
    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .select("id,product_id")
      .eq("workspace_id", identity.workspaceId)
      .eq("id", input.campaignId)
      .maybeSingle();
    if (campaignError || !campaign) throw new Error("CAMPAIGN_NOT_FOUND");

    const { error } = await supabase.rpc("select_weekly_topics", {
      p_workspace_id: identity.workspaceId,
      p_campaign_id: input.campaignId,
      p_topic_ids: input.topicIds,
      p_actor_type: "user",
      p_actor_id: identity.userId,
      p_request_id: request.headers.get("x-request-id")?.trim() || randomUUID(),
    });
    if (error) {
      if (error.message.includes("TOPIC_SCOPE_MISMATCH")) throw new Error("TOPIC_SCOPE_MISMATCH");
      throw new Error("TOPIC_SELECTION_FAILED");
    }
    return NextResponse.json({ campaignId: input.campaignId, topicIds: input.topicIds }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = errorCode(error);
    return NextResponse.json({ ok: false, error: code }, { status: errorStatus(code), headers: { "Cache-Control": "no-store" } });
  }
}
