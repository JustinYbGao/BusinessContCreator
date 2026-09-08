import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { PublicationPackageSchema, PublisherClaimResponseSchema, type PublicationPackage } from "@social-agent/contracts";
import { SupabasePublicationRepository } from "@social-agent/db";
import { HttpError } from "../../../../../lib/workspace-context";
import { requirePublisherDevice } from "../../../../../lib/publisher-auth";
import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/server";
import { validatePublicationPackage } from "@social-agent/xhs-adapter";

const BUCKET = "social-agent-assets";
const SIGNED_URL_SECONDS = 300;

function errorCode(error: unknown): string {
  if (error instanceof HttpError) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message;
  return "INTERNAL_ERROR";
}

function errorResponse(error: unknown) {
  const code = errorCode(error);
  const status = code === "PUBLISHER_AUTH_REQUIRED" ? 401 : code === "PUBLISHER_NO_JOB" ? 204 : code === "PUBLICATION_PACKAGE_INVALID" || code.endsWith("_SCOPE_MISMATCH") ? 409 : 500;
  if (status === 204) return new NextResponse(null, { status });
  return NextResponse.json({ ok: false, error: code }, { status, headers: { "Cache-Control": "no-store" } });
}

function requestId(request: Request): string {
  const value = request.headers.get("x-request-id")?.trim();
  return value && value.length <= 200 ? value : randomUUID();
}

export async function POST(request: Request) {
  const supabase = createSupabaseServiceRoleClient();
  let identity: Awaited<ReturnType<typeof requirePublisherDevice>> | null = null;
  let claimedPublication: Awaited<ReturnType<SupabasePublicationRepository["claimNextForDevice"]>> = null;
  try {
    identity = await requirePublisherDevice(request, supabase);
    const context = {
      workspaceId: identity.workspaceId,
      actor: { type: "publisher" as const, id: identity.deviceId },
      requestId: requestId(request),
    };
    const repository = new SupabasePublicationRepository(supabase);
    const publication = await repository.claimNextForDevice(context, identity.deviceId);
    if (!publication) return new NextResponse(null, { status: 204 });
    claimedPublication = publication;
    if (publication.status !== "PREFILLING") throw new Error("PUBLISHER_CLAIM_STATE_INVALID");

    let storedPackage: PublicationPackage;
    try {
      storedPackage = PublicationPackageSchema.parse(publication.package);
    } catch {
      throw new Error("PUBLICATION_PACKAGE_INVALID");
    }
    let publicationPackage: PublicationPackage;
    try {
      publicationPackage = validatePublicationPackage(storedPackage, {
        workspaceId: publication.workspaceId,
        productId: publication.productId,
        contentVersionId: storedPackage.contentVersionId,
        publicationId: publication.id,
      });
    } catch {
      throw new Error("PUBLICATION_PACKAGE_INVALID");
    }
    const imageDownloadUrls: string[] = [];
    const storageOrigin = new URL(requiredEnvironment("SOCIAL_AGENT_SUPABASE_URL")).origin;
    for (const objectKey of publicationPackage.imageObjectKeys) {
      const signed = await supabase.storage.from(BUCKET).createSignedUrl(objectKey, SIGNED_URL_SECONDS);
      if (signed.error || !signed.data?.signedUrl) throw new Error("PUBLISHER_SIGNED_URL_FAILED");
      if (new URL(signed.data.signedUrl).origin !== storageOrigin) throw new Error("PUBLISHER_SIGNED_URL_ORIGIN_INVALID");
      imageDownloadUrls.push(signed.data.signedUrl);
    }
    const { imageObjectKeys: _imageObjectKeys, ...publicPackage } = publicationPackage;
    const response = PublisherClaimResponseSchema.parse({
      ...publicPackage,
      imageDownloadUrls,
      expiresAt: new Date(Date.now() + SIGNED_URL_SECONDS * 1000).toISOString(),
    });
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (identity && claimedPublication) {
      try {
        await new SupabasePublicationRepository(supabase).transitionClaimedForDevice({
          workspaceId: identity.workspaceId,
          actor: { type: "publisher", id: identity.deviceId },
          requestId: requestId(request),
        }, identity.deviceId, claimedPublication.id, "PREFILLING", "PREFILL_FAILED");
      } catch {
        // Preserve the original error; a subsequent operator retry can reconcile the claim.
      }
    }
    return errorResponse(error);
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_NOT_CONFIGURED`);
  return value;
}
