import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { PublisherApi } from "./api.js";

function pngHeader(): Uint8Array {
  return new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10,
    0, 0, 0, 13, 73, 72, 68, 82,
    0, 0, 4, 56, 0, 0, 5, 160,
  ]);
}

function claim(bytes: Uint8Array) {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    publicationId: "00000000-0000-4000-8000-000000000201",
    contentVersionId: "00000000-0000-4000-8000-000000000202",
    title: "标题",
    body: "正文",
    imageSha256: Array.from({ length: 7 }, () => sha256),
    contentSha256: sha256,
    imageDownloadUrls: Array.from({ length: 7 }, (_, index) => `https://storage.example.test/page-${index + 1}.png`),
    expiresAt: "2026-08-13T15:00:00.000Z",
  };
}

describe("publisher downloader", () => {
  it("downloads exactly seven same-origin PNGs into a private temporary directory", async () => {
    const bytes = pngHeader();
    const api = new PublisherApi({
      baseUrl: "https://agent.example",
      token: "test-token",
      storageOrigin: "https://storage.example.test",
      fetchImpl: async () => new Response(Buffer.from(bytes), { status: 200, headers: { "content-type": "image/png" } }),
    });
    const downloaded = await api.downloadClaimImages(claim(bytes));
    try {
      expect(downloaded.paths).toHaveLength(7);
      expect((await stat(downloaded.directory)).mode & 0o777).toBe(0o700);
      expect((await stat(downloaded.paths[0]!)).mode & 0o777).toBe(0o600);
      expect(await readFile(downloaded.paths[0]!)).toEqual(Buffer.from(bytes));
    } finally {
      await downloaded.cleanup();
    }
  });

  it("rejects a storage redirect before writing files", async () => {
    const bytes = pngHeader();
    const api = new PublisherApi({
      baseUrl: "https://agent.example",
      token: "test-token",
      storageOrigin: "https://storage.example.test",
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://evil.example" } }),
    });
    await expect(api.downloadClaimImages(claim(bytes))).rejects.toThrow("IMAGE_REDIRECT_REJECTED");
  });
});
