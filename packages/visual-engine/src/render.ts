import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import sharp from "sharp";
import { createPageTemplate } from "./template.js";
import type {
  RenderCarouselInput,
  RenderedCarouselPage,
  VerifiedSourceAsset,
  VisualPageScript,
} from "./types.js";
import { normalizePng, validateRenderedCarousel } from "./validate.js";

const FONT_URL = new URL("../assets/fonts/NotoSansSC-Regular.woff2", import.meta.url);
const ALLOWED_SOURCE_FORMATS = new Set(["png", "jpeg", "webp"]);
function validatePages(pages: VisualPageScript[]): VisualPageScript[] {
  if (pages.length !== 7) throw new Error("VISUAL_PAGE_COUNT_INVALID");
  const ordered = [...pages].sort((left, right) => left.page - right.page);
  if (ordered.some((page, index) => page.page !== index + 1)) {
    throw new Error("VISUAL_PAGE_COUNT_INVALID");
  }
  return ordered;
}

async function screenshotDataUrl(
  input: RenderCarouselInput,
  page: VisualPageScript,
): Promise<string | null> {
  if (page.sourceAssetId === null) return null;
  const asset = await input.sourceAssetResolver.resolveVerifiedSourceAsset({
    workspaceId: input.workspaceId,
    productId: input.productId,
    assetId: page.sourceAssetId,
  });
  if (
    !asset
    || asset.workspaceId !== input.workspaceId
    || asset.productId !== input.productId
    || asset.verificationStatus !== "verified"
    || asset.publicUseAllowed !== true
  ) {
    throw new Error("PRODUCT_ASSET_REQUIRED");
  }
  await validateSourceAsset(asset);
  return `data:${asset.mimeType};base64,${asset.bytes.toString("base64")}`;
}

async function validateSourceAsset(asset: VerifiedSourceAsset): Promise<void> {
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    metadata = await sharp(asset.bytes).metadata();
  } catch {
    throw new Error("PRODUCT_ASSET_REQUIRED");
  }
  if (!metadata.format || !ALLOWED_SOURCE_FORMATS.has(metadata.format)) {
    throw new Error("PRODUCT_ASSET_REQUIRED");
  }
  const expectedMime = metadata.format === "jpeg" ? "image/jpeg" : `image/${metadata.format}`;
  const sha256 = createHash("sha256").update(asset.bytes).digest("hex");
  if (
    asset.mimeType !== expectedMime
    || !metadata.width
    || !metadata.height
    || asset.sha256 !== sha256
  ) {
    throw new Error("PRODUCT_ASSET_REQUIRED");
  }
}

export async function renderCarousel(input: RenderCarouselInput): Promise<RenderedCarouselPage[]> {
  const pages = validatePages(input.pages);
  const fontBase64 = (await readFile(FONT_URL)).toString("base64");
  const prepared = await Promise.all(pages.map(async (page) => ({
    page,
    screenshotDataUrl: await screenshotDataUrl(input, page),
  })));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1080, height: 1440 },
    deviceScaleFactor: 1,
  });
  let remoteRequestUrl: string | null = null;
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (url === "about:blank" || url.startsWith("data:")) {
      await route.continue();
      return;
    }
    remoteRequestUrl = url;
    await route.abort("blockedbyclient");
  });

  try {
    const rendered: RenderedCarouselPage[] = [];
    for (const preparedPage of prepared) {
      const page = await context.newPage();
      try {
        await page.setContent(createPageTemplate({
          page: preparedPage.page,
          brand: input.brand,
          fontBase64,
          screenshotDataUrl: preparedPage.screenshotDataUrl,
        }), { waitUntil: "load" });
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(Array.from(document.images).map(async (image) => {
            if (!image.complete) await image.decode();
          }));
        });
        if (remoteRequestUrl !== null) throw new Error("REMOTE_RESOURCE_FORBIDDEN");
        const overflows = await page.evaluate(() => {
          const safe = document.querySelector<HTMLElement>("[data-safe-area]");
          if (!safe) return ["safe-area:missing"];
          const safeRect = safe.getBoundingClientRect();
          return Array.from(document.querySelectorAll<HTMLElement>("[data-measure]"))
            .flatMap((element) => {
              const rect = element.getBoundingClientRect();
              const overflow = element.scrollHeight > element.clientHeight + 16
                || element.scrollWidth > element.clientWidth + 1
                || rect.left < safeRect.left
                || rect.right > safeRect.right
                || rect.top < safeRect.top
                || rect.bottom > safeRect.bottom;
              return overflow
                ? [`${element.className}:${element.scrollWidth}x${element.scrollHeight}/${element.clientWidth}x${element.clientHeight}`]
                : [];
            });
        });
        if (overflows.length > 0) throw new Error(`VISUAL_TEXT_OVERFLOW:${overflows.join(",")}`);
        const screenshot = await page.screenshot({ type: "png", animations: "disabled" });
        rendered.push(await normalizePng(preparedPage.page.page, screenshot));
      } finally {
        await page.close();
      }
    }
    return await validateRenderedCarousel(rendered);
  } finally {
    await context.close();
    await browser.close();
  }
}
