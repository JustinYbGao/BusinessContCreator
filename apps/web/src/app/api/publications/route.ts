import { PublicationPackageSchema, type Publication, type PublicationPackage } from "@social-agent/contracts";
import { SupabasePublicationRepository, type RepositoryContext } from "@social-agent/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError } from "../../../lib/workspace-context";
import {
  createSupabaseServiceRoleClient,
  requireServerInternalWorkspace,
} from "../../../lib/supabase/server";

const PublicationRequestSchema = z.object({
  contentVersionId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
}).strict();

interface PublicationContext {
  workspaceId: string;
  actorId: string;
}

interface ExistingPublication {
  publication: Publication;
  idempotencyKey: string;
}

interface PublicationPackagingPort {
  findExisting(workspaceId: string, contentVersionId: string): Promise<ExistingPublication | null>;
  create(
    context: RepositoryContext,
    input: { contentVersionId: string; idempotencyKey: string },
  ): Promise<Publication>;
  findCreationIdempotencyKey(workspaceId: string, publicationId: string): Promise<string | null>;
}

interface CreatePublicationPackageInput {
  context: PublicationContext;
  contentVersionId: string;
  idempotencyKey: string;
  port: PublicationPackagingPort;
}

function validatedPackage(
  publication: Publication,
  workspaceId: string,
  contentVersionId: string,
  requireReadyToPrefill: boolean,
): PublicationPackage {
  if (publication.workspaceId !== workspaceId) throw new Error("WORKSPACE_SCOPE_MISMATCH");
  if (requireReadyToPrefill && publication.status !== "READY_TO_PREFILL") {
    throw new Error("PUBLICATION_STATE_INVALID");
  }
  const parsed = PublicationPackageSchema.safeParse(publication.package);
  if (!parsed.success) throw new Error("PUBLICATION_PACKAGE_INVALID");
  if (
    parsed.data.publicationId !== publication.id
    || parsed.data.contentVersionId !== contentVersionId
  ) {
    throw new Error("PUBLICATION_PACKAGE_INVALID");
  }
  return parsed.data;
}

async function createPublicationPackage(
  input: CreatePublicationPackageInput,
): Promise<PublicationPackage> {
  const existing = await input.port.findExisting(
    input.context.workspaceId,
    input.contentVersionId,
  );
  if (existing) {
    if (existing.idempotencyKey !== input.idempotencyKey) {
      throw new Error("PUBLICATION_ALREADY_PACKAGED");
    }
    return validatedPackage(
      existing.publication,
      input.context.workspaceId,
      input.contentVersionId,
      false,
    );
  }

  const publication = await input.port.create({
    workspaceId: input.context.workspaceId,
    actor: { type: "user", id: input.context.actorId },
    requestId: input.idempotencyKey,
  }, {
    contentVersionId: input.contentVersionId,
    idempotencyKey: input.idempotencyKey,
  });
  const creationKey = await input.port.findCreationIdempotencyKey(
    input.context.workspaceId,
    publication.id,
  );
  if (creationKey !== input.idempotencyKey) {
    throw new Error("PUBLICATION_ALREADY_PACKAGED");
  }
  return validatedPackage(publication, input.context.workspaceId, input.contentVersionId, true);
}

function createPublicationPackagingPort(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
): PublicationPackagingPort {
  const repository = new SupabasePublicationRepository(supabase);

  async function findCreationIdempotencyKey(workspaceId: string, publicationId: string) {
    const { data, error } = await supabase
      .from("audit_events")
      .select("request_id")
      .eq("workspace_id", workspaceId)
      .eq("entity_type", "publication")
      .eq("entity_id", publicationId)
      .eq("action", "publication.created")
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("PUBLICATION_IDEMPOTENCY_LOOKUP_FAILED");
    return data?.request_id ?? null;
  }

  return {
    async findExisting(workspaceId, contentVersionId) {
      const { data, error } = await supabase
        .from("publications")
        .select("id,workspace_id,product_id,status,package")
        .eq("workspace_id", workspaceId)
        .eq("content_version_id", contentVersionId)
        .limit(1)
        .maybeSingle();
      if (error) throw new Error("PUBLICATION_LOOKUP_FAILED");
      if (!data) return null;
      const publication: Publication = {
        id: data.id,
        workspaceId: data.workspace_id,
        productId: data.product_id,
        status: data.status,
        package: data.package,
      };
      const idempotencyKey = await findCreationIdempotencyKey(workspaceId, publication.id);
      if (!idempotencyKey) throw new Error("PUBLICATION_IDEMPOTENCY_LOOKUP_FAILED");
      return { publication, idempotencyKey };
    },
    create(context, input) {
      return repository.create(context, input);
    },
    findCreationIdempotencyKey,
  };
}

function codeOf(error: unknown): string {
  if (error instanceof HttpError) return error.code;
  const knownCodes = [
    "INVALID_PUBLICATION_INPUT",
    "IDEMPOTENCY_KEY_REQUIRED",
    "IDEMPOTENCY_KEY_INVALID",
    "CONTENT_NOT_APPROVED",
    "CURRENT_REVIEW_NOT_PASSED",
    "ASSET_SET_INVALID",
    "PUBLICATION_ALREADY_PACKAGED",
    "PUBLICATION_PACKAGE_INVALID",
    "PUBLICATION_STATE_INVALID",
    "WORKSPACE_SCOPE_MISMATCH",
    "PUBLICATION_LOOKUP_FAILED",
    "PUBLICATION_IDEMPOTENCY_LOOKUP_FAILED",
  ];
  if (error instanceof Error) {
    const matched = knownCodes.find((code) => error.message.includes(code));
    if (matched) return matched;
  }
  return "INTERNAL_ERROR";
}

function statusOf(code: string): number {
  if (
    code === "INVALID_PUBLICATION_INPUT"
    || code === "IDEMPOTENCY_KEY_REQUIRED"
    || code === "IDEMPOTENCY_KEY_INVALID"
  ) return 400;
  if (
    code === "CONTENT_NOT_APPROVED"
    || code === "CURRENT_REVIEW_NOT_PASSED"
    || code === "ASSET_SET_INVALID"
    || code === "PUBLICATION_ALREADY_PACKAGED"
    || code === "PUBLICATION_PACKAGE_INVALID"
    || code === "PUBLICATION_STATE_INVALID"
    || code === "WORKSPACE_SCOPE_MISMATCH"
  ) return 409;
  return 500;
}

export async function POST(request: Request) {
  try {
    const context = await requireServerInternalWorkspace();
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      throw new Error("INVALID_PUBLICATION_INPUT");
    }
    const parsed = PublicationRequestSchema.safeParse(rawBody);
    if (!parsed.success) throw new Error("INVALID_PUBLICATION_INPUT");
    const headerKey = request.headers.get("idempotency-key")?.trim() || null;
    if (headerKey && headerKey.length > 200) throw new Error("IDEMPOTENCY_KEY_INVALID");
    if (headerKey && parsed.data.idempotencyKey && headerKey !== parsed.data.idempotencyKey) {
      throw new Error("IDEMPOTENCY_KEY_INVALID");
    }
    const idempotencyKey = headerKey ?? parsed.data.idempotencyKey;
    if (!idempotencyKey) throw new Error("IDEMPOTENCY_KEY_REQUIRED");

    const supabase = createSupabaseServiceRoleClient();
    const publicationPackage = await createPublicationPackage({
      context,
      contentVersionId: parsed.data.contentVersionId,
      idempotencyKey,
      port: createPublicationPackagingPort(supabase),
    });
    return NextResponse.json(publicationPackage, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const code = codeOf(error);
    return NextResponse.json(
      { ok: false, error: code },
      { status: statusOf(code), headers: { "Cache-Control": "no-store" } },
    );
  }
}
