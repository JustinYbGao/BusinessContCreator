import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validatePngBytes, validatePublicationPackage } from "./package.js";
import { assertAllowedNavigation } from "./safety-guard.js";

const workspaceId = "00000000-0000-4000-8000-000000000101";
const productId = "00000000-0000-4000-8000-000000000102";
const contentVersionId = "00000000-0000-4000-8000-000000000103";
const publicationId = "00000000-0000-4000-8000-000000000104";

function pngHeader(): Uint8Array {
  return new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10,
    0, 0, 0, 13, 73, 72, 68, 82,
    0, 0, 4, 56, 0, 0, 5, 160,
  ]);
}

function samplePackage() {
  const bytes = pngHeader();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    publicationId,
    contentVersionId,
    title: "标题",
    body: "正文",
    imageObjectKeys: Array.from({ length: 7 }, (_, index) => `workspaces/${workspaceId}/products/${productId}/contents/${contentVersionId}/page-${index + 1}-${sha256}.png`),
    imageSha256: Array.from({ length: 7 }, () => sha256),
    contentSha256: sha256,
  };
}

describe("validated publication package", () => {
  it("accepts the immutable seven-page namespace and PNG dimensions", () => {
    const bytes = pngHeader();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    expect(validatePublicationPackage(samplePackage(), { workspaceId, productId, contentVersionId }).imageObjectKeys).toHaveLength(7);
    expect(validatePngBytes({ bytes, expectedSha256: sha256 }).width).toBe(1080);
    expect(validatePngBytes({ bytes, expectedSha256: sha256 }).height).toBe(1440);
  });

  it("rejects a key outside the exact workspace and content scope", () => {
    const value = samplePackage();
    value.imageObjectKeys[0] = value.imageObjectKeys[0]!.replace(productId, "00000000-0000-4000-8000-000000000999");
    expect(() => validatePublicationPackage(value, { workspaceId, productId, contentVersionId })).toThrow("IMAGE_OBJECT_KEY_SCOPE_MISMATCH");
  });

  it("rejects a hash mismatch", () => {
    const value = samplePackage();
    value.imageSha256[0] = "a".repeat(64);
    expect(() => validatePublicationPackage(value, { workspaceId, productId, contentVersionId })).toThrow("IMAGE_OBJECT_HASH_MISMATCH");
  });
});

describe("navigation safety guard", () => {
  it("allows only the configured creator origin and explicit fixture files", () => {
    expect(assertAllowedNavigation("https://creator.xiaohongshu.com/creator", ["https://creator.xiaohongshu.com"]).allowed).toBe(true);
    expect(assertAllowedNavigation("https://evil.example/", ["https://creator.xiaohongshu.com"]).allowed).toBe(false);
    expect(assertAllowedNavigation("file:///tmp/editor.html", ["https://creator.xiaohongshu.com"], true).allowed).toBe(true);
    expect(assertAllowedNavigation("file:///tmp/editor.html", ["https://creator.xiaohongshu.com"]).allowed).toBe(false);
  });
});
