import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { SupabasePublicationRepository } from "@social-agent/db";
import { z } from "zod";
import { HttpError } from "../../../../../../lib/auth";
import { requirePublisherDevice } from "../../../../../../lib/publisher-auth";
import { createSupabaseServiceRoleClient } from "../../../../../../lib/supabase/server";
import { inspectPng, MAX_IMAGE_BYTES } from "@social-agent/xhs-adapter";

const BUCKET = "social-agent-assets";
const StatusInputSchema = z.object({
  status: z.enum(["READY_TO_PREFILL", "NEEDS_LOGIN", "PREFILL_FAILED", "AWAITING_HUMAN_PUBLISH"]),
  failureReason: z.string().trim().min(1).max(500).optional(),
}).strict();

type RouteContext = { params: Promise<{ jobId: string }> };

function errorCode(error: unknown): string {
  if (error instanceof HttpError) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message;
  return "INTERNAL_ERROR";
}

function errorStatus(code: string): number {
  if (code === "PUBLISHER_AUTH_REQUIRED") return 401;
  if (code === "PUBLISHER_JOB_NOT_FOUND") return 404;
  if (code === "INVALID_PUBLISHER_STATUS" || code === "PREFILL_SCREENSHOT_REQUIRED") return 400;
  if (code === "PUBLISHER_JOB_SCOPE_MISMATCH" || code === "PUBLICATION_TRANSITION_CONFLICT") return 409;
  if (code === "PREFILL_SCREENSHOT_INVALID" || code === "IMAGE_CONTENT_TYPE_INVALID" || code === "IMAGE_BYTE_SIZE_INVALID" || code === "IMAGE_PNG_SIGNATURE_INVALID" || code === "IMAGE_PNG_HEADER_INVALID" || code === "IMAGE_DIMENSIONS_INVALID") return 400;
  return 500;
}

function errorResponse(error: unknown) {
  const code = errorCode(error);
  return NextResponse.json({ ok: false, error: code }, { status: errorStatus(code), headers: { "Cache-Control": "no-store" } });
}

function requestId(request: Request): string {
  const value = request.headers.get("x-request-id")?.trim();
  return value && value.length <= 200 ? value : randomUUID();
}

async function parseInput(request: Request): Promise<{ input: z.infer<typeof StatusInputSchema>; screenshot: File | null }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const parsed = StatusInputSchema.safeParse(await request.json());
    if (!parsed.success) throw new Error("INVALID_PUBLISHER_STATUS");
    return { input: parsed.data, screenshot: null };
  }
  const form = await request.formData();
  const parsed = StatusInputSchema.safeParse({
    status: form.get("status"),
    failureReason: form.get("failureReason") || undefined,
  });
  if (!parsed.success) throw new Error("INVALID_PUBLISHER_STATUS");
  const value = form.get("screenshot");
  return { input: parsed.data, screenshot: value && typeof value !== "string" ? value as File : null };
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { jobId } = await context.params;
    if (!z.string().uuid().safeParse(jobId).success) throw new Error("PUBLISHER_JOB_NOT_FOUND");
    const input = await parseInput(request);
    const supabase = createSupabaseServiceRoleClient();
    const identity = await requirePublisherDevice(request, supabase);
    const currentResult = await supabase.from("publications")
      .select("id,workspace_id,product_id,status,claimed_by_device_id,prefill_screenshot_key")
      .eq("workspace_id", identity.workspaceId)
      .eq("id", jobId)
      .maybeSingle();
    const current = currentResult.data;
    if (currentResult.error || !current) throw new Error("PUBLISHER_JOB_NOT_FOUND");
    if (current.claimed_by_device_id !== identity.deviceId) throw new Error("PUBLISHER_JOB_SCOPE_MISMATCH");
    const retrying = input.input.status === "READY_TO_PREFILL" && (current.status === "NEEDS_LOGIN" || current.status === "PREFILL_FAILED");
    if (current.status !== "PREFILLING" && current.status !== input.input.status && !retrying) {
      throw new Error("PUBLICATION_TRANSITION_CONFLICT");
    }

    if (input.input.status === "READY_TO_PREFILL") {
      const reset = await supabase.from("publications")
        .update({ failure_reason: null, prefill_screenshot_key: null })
        .eq("workspace_id", identity.workspaceId)
        .eq("id", jobId)
        .eq("claimed_by_device_id", identity.deviceId)
        .select("id")
        .maybeSingle();
      if (reset.error || !reset.data) throw new Error("PUBLISHER_STATUS_UPDATE_FAILED");
      const repository = new SupabasePublicationRepository(supabase);
      await repository.transitionClaimedForDevice({
        workspaceId: identity.workspaceId,
        actor: { type: "publisher", id: identity.deviceId },
        requestId: requestId(request),
      }, identity.deviceId, jobId, current.status as "NEEDS_LOGIN" | "PREFILL_FAILED", "READY_TO_PREFILL");
      return NextResponse.json({ publicationId: jobId, status: "READY_TO_PREFILL" }, { headers: { "Cache-Control": "no-store" } });
    }

    let screenshotKey: string | null = current.prefill_screenshot_key;
    if (input.input.status === "AWAITING_HUMAN_PUBLISH" && !input.screenshot && !screenshotKey) {
      throw new Error("PREFILL_SCREENSHOT_REQUIRED");
    }
    if (input.screenshot) {
      if (input.screenshot.size <= 0 || input.screenshot.size > MAX_IMAGE_BYTES) throw new Error("PREFILL_SCREENSHOT_INVALID");
      const bytes = new Uint8Array(await input.screenshot.arrayBuffer());
      const metadata = inspectPng(bytes, input.screenshot.type);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      screenshotKey = `workspaces/${identity.workspaceId}/products/${current.product_id}/publications/${jobId}/prefill-${sha256}.png`;
      const upload = await supabase.storage.from(BUCKET).upload(screenshotKey, bytes, {
        contentType: "image/png",
        upsert: true,
        cacheControl: "31536000",
        metadata: {
          sha256,
          size: String(metadata.byteSize),
          width: String(metadata.width),
          height: String(metadata.height),
        },
      });
      if (upload.error) throw new Error("PREFILL_SCREENSHOT_UPLOAD_FAILED");
    }

    if (current.status === "PREFILLING") {
      const repository = new SupabasePublicationRepository(supabase);
      await repository.transitionClaimedForDevice({
        workspaceId: identity.workspaceId,
        actor: { type: "publisher", id: identity.deviceId },
        requestId: requestId(request),
      }, identity.deviceId, jobId, "PREFILLING", input.input.status);
    }

    const update = await supabase.from("publications")
      .update({
        failure_reason: input.input.status === "PREFILL_FAILED" ? input.input.failureReason ?? "PREFILL_FAILED" : input.input.status === "NEEDS_LOGIN" ? input.input.failureReason ?? "LOGIN_REQUIRED" : null,
        prefill_screenshot_key: screenshotKey,
      })
      .eq("workspace_id", identity.workspaceId)
      .eq("id", jobId)
      .eq("claimed_by_device_id", identity.deviceId)
      .select("status")
      .maybeSingle();
    if (update.error || !update.data) throw new Error("PUBLISHER_STATUS_UPDATE_FAILED");
    return NextResponse.json({ publicationId: jobId, status: update.data.status }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
