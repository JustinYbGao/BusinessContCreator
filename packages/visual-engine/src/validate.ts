import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import type {
  GeneratedAssetInput,
  PersistRenderedCarouselInput,
  RenderedCarouselPage,
} from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateScopeIds(input: PersistRenderedCarouselInput): void {
  if (![input.workspaceId, input.productId, input.contentVersionId].every((id) => UUID.test(id))) {
    throw new Error("VISUAL_SCOPE_INVALID");
  }
}

export async function normalizePng(page: number, input: Buffer): Promise<RenderedCarouselPage> {
  const { data, info } = await sharp(input)
    .rotate()
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
    .toBuffer({ resolveWithObject: true });

  if (info.format !== "png" || info.width !== 1080 || info.height !== 1440) {
    throw new Error("VISUAL_DIMENSIONS_INVALID");
  }
  const sha256 = createHash("sha256").update(data).digest("hex");
  return {
    page,
    buffer: data,
    width: 1080,
    height: 1440,
    mimeType: "image/png",
    sha256,
    byteSize: data.byteLength,
  };
}

export async function validateRenderedCarousel(
  pages: RenderedCarouselPage[],
): Promise<RenderedCarouselPage[]> {
  if (pages.length !== 7) throw new Error("VISUAL_PAGE_COUNT_INVALID");
  const ordered = [...pages].sort((left, right) => left.page - right.page);
  if (ordered.some((page, index) => page.page !== index + 1)) {
    throw new Error("VISUAL_PAGE_COUNT_INVALID");
  }
  for (const page of ordered) {
    const metadata = await sharp(page.buffer).metadata();
    const sha256 = createHash("sha256").update(page.buffer).digest("hex");
    if (
      metadata.format !== "png"
      || metadata.width !== 1080
      || metadata.height !== 1440
      || page.width !== 1080
      || page.height !== 1440
      || page.mimeType !== "image/png"
      || page.sha256 !== sha256
      || page.byteSize !== page.buffer.byteLength
    ) {
      throw new Error("VISUAL_ASSET_INVALID");
    }
  }
  return ordered;
}

export async function persistRenderedCarousel(
  input: PersistRenderedCarouselInput,
): Promise<GeneratedAssetInput[]> {
  validateScopeIds(input);
  const pages = await validateRenderedCarousel(input.pages);
  const assets = pages.map((page): GeneratedAssetInput => ({
    objectKey: `workspaces/${input.workspaceId}/products/${input.productId}/contents/${input.contentVersionId}/page-${page.page}-${page.sha256}.png`,
    mimeType: "image/png",
    byteSize: page.byteSize,
    width: 1080,
    height: 1440,
    sha256: page.sha256,
  }));
  const attemptedKeys: string[] = [];
  const uploadAttemptId = randomUUID();

  try {
    for (const [index, asset] of assets.entries()) {
      attemptedKeys.push(asset.objectKey);
      await input.storage.upload(asset.objectKey, pages[index]!.buffer, {
        contentType: "image/png",
        sha256: asset.sha256,
        verified: true,
        uploadAttemptId,
      });
    }
  } catch (error) {
    try {
      if (attemptedKeys.length > 0) {
        await input.storage.removeOwned(attemptedKeys, uploadAttemptId);
      }
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "VISUAL_ASSET_CLEANUP_FAILED",
      );
    }
    throw error;
  }

  const commitInput = {
    workspaceId: input.workspaceId,
    productId: input.productId,
    contentVersionId: input.contentVersionId,
    assets,
  };
  try {
    await input.commit.insertVerifiedGeneratedAssets(commitInput);
    return assets;
  } catch (commitError) {
    let committed: boolean;
    try {
      committed = await input.commit.hasVerifiedGeneratedAssets(commitInput);
    } catch (reconciliationError) {
      throw new AggregateError(
        [commitError, reconciliationError],
        "VISUAL_ASSET_COMMIT_UNRESOLVED",
      );
    }
    if (committed) return assets;
    try {
      await input.storage.removeOwned(attemptedKeys, uploadAttemptId);
    } catch (cleanupError) {
      throw new AggregateError(
        [commitError, cleanupError],
        "VISUAL_ASSET_CLEANUP_FAILED",
      );
    }
    throw commitError;
  }
}
