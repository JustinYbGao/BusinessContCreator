import { createHash, randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { SupabasePublisherDeviceRepository } from "@social-agent/db";
import { z } from "zod";
import { HttpError } from "../../../../lib/workspace-context";
import { createSupabaseServiceRoleClient, requireServerInternalWorkspace } from "../../../../lib/supabase/server";

const DeviceInputSchema = z.object({ name: z.string().trim().min(1).max(120) }).strict();

function requestId(request: Request): string {
  const value = request.headers.get("x-request-id")?.trim();
  return value && value.length <= 200 ? value : randomUUID();
}

function errorCode(error: unknown): string {
  if (error instanceof HttpError) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message;
  return "INTERNAL_ERROR";
}

function errorResponse(error: unknown) {
  const code = errorCode(error);
  const status = code === "INVALID_DEVICE_INPUT" ? 400 : code === "DEVICE_NOT_FOUND" ? 404 : 500;
  return NextResponse.json({ ok: false, error: code }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  try {
    const context = await requireServerInternalWorkspace();
    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase.from("publisher_devices")
      .select("id,name,created_at,revoked_at")
      .eq("workspace_id", context.workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw new Error("DEVICES_UNAVAILABLE");
    return NextResponse.json({ devices: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireServerInternalWorkspace();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new Error("INVALID_DEVICE_INPUT");
    }
    const parsed = DeviceInputSchema.safeParse(body);
    if (!parsed.success) throw new Error("INVALID_DEVICE_INPUT");
    const token = randomBytes(32).toString("base64url");
    const tokenSha256 = createHash("sha256").update(token, "utf8").digest("hex");
    const supabase = createSupabaseServiceRoleClient();
    const device = await new SupabasePublisherDeviceRepository(supabase).create({
      workspaceId: context.workspaceId,
      actor: { type: "user", id: context.actorId },
      requestId: requestId(request),
    }, parsed.data.name, tokenSha256);
    return NextResponse.json({ device: { ...device, name: parsed.data.name }, token }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await requireServerInternalWorkspace();
    const deviceId = new URL(request.url).searchParams.get("id")?.trim();
    if (!deviceId || !z.string().uuid().safeParse(deviceId).success) throw new Error("DEVICE_NOT_FOUND");
    const supabase = createSupabaseServiceRoleClient();
    await new SupabasePublisherDeviceRepository(supabase).revoke({
      workspaceId: context.workspaceId,
      actor: { type: "user", id: context.actorId },
      requestId: requestId(request),
    }, deviceId);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
