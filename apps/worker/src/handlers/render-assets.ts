import { randomUUID } from "node:crypto";
import type {
  AssetStoragePort,
  GeneratedAssetInput,
  RenderCarouselInput,
  RenderedCarouselPage,
} from "@social-agent/visual-engine";
import { validateRenderedCarousel } from "@social-agent/visual-engine";
import type { WorkerHandler } from "../runner.js";

export type RenderInputLoader = (input: {
  workspaceId: string;
  productId: string;
  contentVersionId: string;
}) => Promise<RenderCarouselInput>;

export type RenderAssetsDependencies = {
  loadInput: RenderInputLoader;
  render: (input: RenderCarouselInput) => Promise<RenderedCarouselPage[]>;
  storage: AssetStoragePort;
  validate?: (pages: RenderedCarouselPage[]) => Promise<RenderedCarouselPage[]>;
};

function recordPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function createRenderAssetsHandler(dependencies: RenderAssetsDependencies): WorkerHandler {
  return async ({ ctx, job, signal }) => {
    if (signal.aborted) throw new Error("LEASE_LOST");
    if (!job.productId) throw new Error("PRODUCT_SCOPE_REQUIRED");
    const payload = recordPayload(job.payload);
    const contentVersionId = payload.contentVersionId;
    if (typeof contentVersionId !== "string" || !contentVersionId) {
      throw new Error("CONTENT_VERSION_REQUIRED");
    }

    const input = await dependencies.loadInput({
      workspaceId: ctx.workspaceId,
      productId: job.productId,
      contentVersionId,
    });
    if (
      input.workspaceId !== ctx.workspaceId
      || input.productId !== job.productId
      || input.contentVersionId !== contentVersionId
    ) {
      throw new Error("RENDER_SCOPE_MISMATCH");
    }
    const pages = await (dependencies.validate ?? validateRenderedCarousel)(await dependencies.render(input));
    if (signal.aborted) throw new Error("LEASE_LOST");
    const assets: GeneratedAssetInput[] = pages.map((page) => ({
      objectKey: `workspaces/${ctx.workspaceId}/products/${job.productId}/contents/${contentVersionId}/page-${page.page}-${page.sha256}.png`,
      mimeType: "image/png",
      byteSize: page.byteSize,
      width: 1080,
      height: 1440,
      sha256: page.sha256,
    }));
    const uploadAttemptId = randomUUID();
    const attemptedKeys: string[] = [];

    try {
      for (const [index, asset] of assets.entries()) {
        if (signal.aborted) throw new Error("LEASE_LOST");
        attemptedKeys.push(asset.objectKey);
        await dependencies.storage.upload(asset.objectKey, pages[index]!.buffer, {
          contentType: "image/png",
          sha256: asset.sha256,
          verified: true,
          uploadAttemptId,
        });
      }
    } catch (error) {
      try {
        if (attemptedKeys.length > 0) await dependencies.storage.removeOwned(attemptedKeys, uploadAttemptId);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "VISUAL_ASSET_CLEANUP_FAILED");
      }
      throw error;
    }

    return {
      result: {
        productId: job.productId,
        contentVersionId,
        assetCount: assets.length,
      },
      commitPayload: { contentVersionId, assets, uploadAttemptId },
    };
  };
}
