import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceRoleClient } from "../../../lib/supabase/server";

const WaitlistRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  website: z.string().optional(),
});

function responseOk() {
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

function keyedAddressHash(address: string, key: string): string {
  return createHmac("sha256", key).update(address).digest("hex").slice(0, 16);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    if (request.headers.get("content-type")?.includes("application/json")) {
      body = await request.json();
    } else {
      const formData = await request.formData();
      body = Object.fromEntries(formData.entries());
    }
  } catch {
    return NextResponse.json({ ok: false, error: "INVALID_REQUEST" }, { status: 400 });
  }

  const parsed = WaitlistRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_EMAIL" }, { status: 400 });
  }

  if (parsed.data.website?.trim()) return responseOk();

  const serviceRoleKey = process.env.SOCIAL_AGENT_SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return NextResponse.json({ ok: false, error: "WAITLIST_NOT_CONFIGURED" }, { status: 500 });
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    const { error } = await supabase.rpc("upsert_waitlist_entry", {
      p_email: parsed.data.email,
      p_source: "website",
      p_rate_limit_key: keyedAddressHash(clientAddress(request), serviceRoleKey),
    });
    if (error) throw new Error("WAITLIST_WRITE_FAILED");
    return responseOk();
  } catch {
    return NextResponse.json({ ok: false, error: "WAITLIST_UNAVAILABLE" }, { status: 500 });
  }
}
