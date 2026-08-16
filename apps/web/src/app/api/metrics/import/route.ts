import {
  IMPORT_LIMITS,
  parseMetricImport,
  type ParsedMetricImport,
} from "@social-agent/analytics";
import { SupabaseMetricRepository } from "@social-agent/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  errorResponse,
  requestId,
} from "../../../../lib/analytics-route";
import { createSupabaseServiceRoleClient, requireServerInternalAdmin } from "../../../../lib/supabase/server";

const JsonEnvelopeSchema = z.object({
  productId: z.string().uuid(),
  rows: z.array(z.unknown()).max(IMPORT_LIMITS.maxRows),
}).strict();

const REQUEST_BYTE_LIMIT = IMPORT_LIMITS.maxBytes + 64 * 1024;

const KNOWN_CODES = [
  "AUTH_REQUIRED",
  "ADMIN_REQUIRED",
  "REQUEST_ID_INVALID",
  "INVALID_IMPORT_INPUT",
  "IMPORT_TOO_LARGE",
  "IMPORT_EMPTY",
  "IMPORT_SCOPE_MISMATCH",
  "PRODUCT_SCOPE_MISMATCH",
  "PUBLICATION_SCOPE_MISMATCH",
  "IMPORT_UNAVAILABLE",
  "INVALID_JSON",
  "INVALID_CSV",
  "UNKNOWN_COLUMN",
  "DUPLICATE_HEADER",
  "FORMULA_LIKE_VALUE",
  "INVALID_ROW",
  "INVALID_UUID",
  "INVALID_WINDOW",
  "INVALID_TIMESTAMP",
  "INVALID_METRIC",
  "INVALID_CONVERSION",
  "DUPLICATE_WINDOW",
  "ROW_LIMIT_EXCEEDED",
];

function statusOf(code: string): number {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "ADMIN_REQUIRED") return 403;
  if (code === "IMPORT_SCOPE_MISMATCH" || code === "PRODUCT_SCOPE_MISMATCH" || code === "PUBLICATION_SCOPE_MISMATCH") return 409;
  if (code === "IMPORT_UNAVAILABLE") return 500;
  return 400;
}

function contentLengthTooLarge(request: Request): boolean {
  const raw = request.headers.get("content-length");
  if (!raw) return false;
  const length = Number(raw);
  return Number.isFinite(length) && length > REQUEST_BYTE_LIMIT;
}

async function boundedText(request: Request): Promise<string> {
  if (contentLengthTooLarge(request)) throw new Error("IMPORT_TOO_LARGE");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > REQUEST_BYTE_LIMIT) throw new Error("IMPORT_TOO_LARGE");
  return new TextDecoder().decode(bytes);
}

async function boundedFormFile(request: Request): Promise<{ productId: string; format: "json" | "csv"; body: string }> {
  if (contentLengthTooLarge(request)) throw new Error("IMPORT_TOO_LARGE");
  const form = await request.formData();
  const productIdValue = form.get("productId");
  const fileValue = form.get("file");
  if (typeof productIdValue !== "string" || !(fileValue instanceof File)) throw new Error("INVALID_IMPORT_INPUT");
  const bytes = new Uint8Array(await fileValue.arrayBuffer());
  if (bytes.byteLength > IMPORT_LIMITS.maxBytes) throw new Error("IMPORT_TOO_LARGE");
  const format = fileValue.type.includes("json") || fileValue.name.toLowerCase().endsWith(".json") ? "json" : "csv";
  return { productId: productIdValue, format, body: new TextDecoder().decode(bytes) };
}

async function parseInput(request: Request): Promise<{ productId: string; parsed: ParsedMetricImport }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const input = await boundedFormFile(request);
    const parsed = parseMetricImport({ format: input.format, body: input.body });
    return { productId: input.productId, parsed };
  }

  if (contentType.includes("application/json")) {
    const body = await boundedText(request);
    let envelope: unknown;
    try {
      envelope = JSON.parse(body.replace(/^\ufeff/, "")) as unknown;
    } catch {
      throw new Error("INVALID_JSON");
    }
    const parsedEnvelope = JsonEnvelopeSchema.safeParse(envelope);
    if (!parsedEnvelope.success) throw new Error("INVALID_IMPORT_INPUT");
    const queryProductId = new URL(request.url).searchParams.get("productId");
    if (queryProductId && queryProductId !== parsedEnvelope.data.productId) throw new Error("IMPORT_SCOPE_MISMATCH");
    return {
      productId: parsedEnvelope.data.productId,
      parsed: parseMetricImport({ format: "json", body }),
    };
  }

  const productId = new URL(request.url).searchParams.get("productId");
  if (!productId || !z.string().uuid().safeParse(productId).success) throw new Error("INVALID_IMPORT_INPUT");
  const body = await boundedText(request);
  return { productId, parsed: parseMetricImport({ format: "csv", body }) };
}

function parserErrorCode(parsed: ParsedMetricImport): string {
  return parsed.errors[0]?.code ?? "INVALID_ROW";
}

export async function POST(request: Request) {
  try {
    const identity = await requireServerInternalAdmin();
    const input = await parseInput(request);
    if (input.parsed.errors.length > 0) throw new Error(parserErrorCode(input.parsed));
    if (input.parsed.rows.length === 0) throw new Error("IMPORT_EMPTY");
    if (input.parsed.rows.some((row) => row.workspaceId !== identity.workspaceId || row.productId !== input.productId)) {
      throw new Error("IMPORT_SCOPE_MISMATCH");
    }

    const publicationIds = [...new Set(input.parsed.rows.map((row) => row.publicationId))];
    const supabase = createSupabaseServiceRoleClient();
    const productResult = await supabase.from("products")
      .select("id")
      .eq("workspace_id", identity.workspaceId)
      .eq("id", input.productId)
      .is("deleted_at", null)
      .maybeSingle();
    if (productResult.error) throw new Error("IMPORT_UNAVAILABLE");
    if (!productResult.data) throw new Error("PRODUCT_SCOPE_MISMATCH");

    const publicationsResult = await supabase.from("publications")
      .select("id")
      .eq("workspace_id", identity.workspaceId)
      .eq("product_id", input.productId)
      .in("id", publicationIds);
    if (publicationsResult.error) throw new Error("IMPORT_UNAVAILABLE");
    const scopedPublicationIds = new Set((publicationsResult.data ?? []).map((row: { id: string }) => row.id));
    if (scopedPublicationIds.size !== publicationIds.length || publicationIds.some((id) => !scopedPublicationIds.has(id))) {
      throw new Error("PUBLICATION_SCOPE_MISMATCH");
    }

    const rows = input.parsed.rows.map(({ publicationId, window, metrics, productConversion, capturedAt }) => ({
      publicationId,
      window,
      metrics,
      productConversion,
      capturedAt,
    }));
    const result = await new SupabaseMetricRepository(supabase).importSnapshots({
      workspaceId: identity.workspaceId,
      actor: { type: "user", id: identity.userId },
      requestId: requestId(request),
    }, {
      productId: input.productId,
      format: input.parsed.format,
      rows,
      ...(input.parsed.filenameSha256 ? { filenameSha256: input.parsed.filenameSha256 } : {}),
    });
    return NextResponse.json({
      importId: result.importId,
      acceptedRows: result.acceptedRows,
      format: input.parsed.format,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, statusOf, KNOWN_CODES);
  }
}
