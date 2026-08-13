import { createHash } from "node:crypto";
import { PublicationPackageSchema, PublisherClaimResponseSchema, type PublicationPackage, type PublisherClaimResponse } from "@social-agent/contracts";

export const XHS_IMAGE_COUNT = 7;
export const XHS_IMAGE_WIDTH = 1080;
export const XHS_IMAGE_HEIGHT = 1440;
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

export interface PublicationScope {
  workspaceId: string;
  productId: string;
  contentVersionId: string;
  publicationId?: string;
}

export interface PngMetadata {
  contentType: "image/png";
  byteSize: number;
  width: number;
  height: number;
  sha256: string;
}

function hasPrefix(value: string, prefix: string): boolean {
  return value.startsWith(prefix) && !value.includes("..") && !value.startsWith("/");
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 24)
    | ((bytes[offset + 1] ?? 0) << 16)
    | ((bytes[offset + 2] ?? 0) << 8)
    | (bytes[offset + 3] ?? 0);
}

export function inspectPng(bytes: Uint8Array, contentType = "image/png"): Omit<PngMetadata, "sha256"> {
  if (contentType.toLowerCase() !== "image/png") throw new Error("IMAGE_CONTENT_TYPE_INVALID");
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("IMAGE_BYTE_SIZE_INVALID");
  if (bytes.byteLength < 24 || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    throw new Error("IMAGE_PNG_SIGNATURE_INVALID");
  }
  const chunkType = String.fromCharCode(...bytes.slice(12, 16));
  if (chunkType !== "IHDR") throw new Error("IMAGE_PNG_HEADER_INVALID");
  const width = readUint32(bytes, 16);
  const height = readUint32(bytes, 20);
  if (width <= 0 || height <= 0) throw new Error("IMAGE_DIMENSIONS_INVALID");
  return { contentType: "image/png", byteSize: bytes.byteLength, width, height };
}

export function validatePngBytes(input: {
  bytes: Uint8Array;
  contentType?: string;
  expectedSha256: string;
}): PngMetadata {
  const metadata = inspectPng(input.bytes, input.contentType);
  if (metadata.width !== XHS_IMAGE_WIDTH || metadata.height !== XHS_IMAGE_HEIGHT) {
    throw new Error("IMAGE_DIMENSIONS_INVALID");
  }
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  if (sha256 !== input.expectedSha256) throw new Error("IMAGE_SHA256_MISMATCH");
  return { ...metadata, sha256 };
}

export function validatePublicationPackage(
  input: unknown,
  scope: PublicationScope,
): PublicationPackage {
  const parsed = PublicationPackageSchema.parse(input);
  if (scope.publicationId && parsed.publicationId !== scope.publicationId) throw new Error("PUBLICATION_SCOPE_MISMATCH");
  if (parsed.contentVersionId !== scope.contentVersionId) throw new Error("CONTENT_VERSION_SCOPE_MISMATCH");
  const prefix = `workspaces/${scope.workspaceId}/products/${scope.productId}/contents/${scope.contentVersionId}/`;
  const seenPages = new Set<number>();
  parsed.imageObjectKeys.forEach((key, index) => {
    if (!hasPrefix(key, prefix)) throw new Error("IMAGE_OBJECT_KEY_SCOPE_MISMATCH");
    const match = key.match(new RegExp(`^${prefix.replaceAll("/", "\\/")}page-([1-7])-([a-f0-9]{64})\\.png$`));
    if (!match) throw new Error("IMAGE_OBJECT_KEY_INVALID");
    const page = Number(match[1]);
    const sha256 = match[2];
    if (page !== index + 1 || seenPages.has(page)) throw new Error("IMAGE_PAGE_ORDER_INVALID");
    if (sha256 !== parsed.imageSha256[index]) throw new Error("IMAGE_OBJECT_HASH_MISMATCH");
    seenPages.add(page);
  });
  if (seenPages.size !== XHS_IMAGE_COUNT) throw new Error("IMAGE_SET_INVALID");
  return parsed;
}

export function validatePublisherClaim(input: unknown): PublisherClaimResponse {
  return PublisherClaimResponseSchema.parse(input);
}
