import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabasePublisherDeviceRepository } from "@social-agent/db";
import { HttpError } from "./workspace-context";

export interface PublisherDeviceIdentity {
  deviceId: string;
  workspaceId: string;
}

function tokenFrom(request: Request): string {
  const header = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+([^\s]+)$/i.exec(header);
  if (!match?.[1]) throw new HttpError(401, "PUBLISHER_AUTH_REQUIRED");
  return match[1];
}

export async function requirePublisherDevice(
  request: Request,
  supabase: SupabaseClient,
): Promise<PublisherDeviceIdentity> {
  const token = tokenFrom(request);
  const tokenSha256 = createHash("sha256").update(token, "utf8").digest("hex");
  const device = await new SupabasePublisherDeviceRepository(supabase).resolveByTokenHash(tokenSha256);
  if (!device) throw new HttpError(401, "PUBLISHER_AUTH_REQUIRED");
  return { deviceId: device.id, workspaceId: device.workspaceId };
}
