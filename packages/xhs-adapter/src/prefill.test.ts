import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { afterEach, describe, expect, it } from "vitest";
import type { PublisherClaimResponse } from "@social-agent/contracts";
import { prefillXhs, type PrefillPage } from "./prefill.js";

const fixturePath = resolve(import.meta.dirname, "../../test-support/fixtures/xhs-editor.html");
const screenshotPath = resolve("/private/tmp", `xhs-prefill-${crypto.randomUUID()}.png`);
const browsers: Array<Awaited<ReturnType<typeof chromium.launch>>> = [];

function bridge(page: Page): PrefillPage {
  async function first(selectors: readonly string[]) {
    for (const selector of selectors) {
      const candidate = page.locator(selector).first();
      if (await candidate.count() > 0) return candidate;
    }
    throw new Error("PREFILL_SELECTOR_NOT_FOUND");
  }

  return {
    async hasSelector(selectors) {
      for (const selector of selectors) {
        const candidate = page.locator(selector).first();
        if (await candidate.count() > 0 && await candidate.isVisible()) return true;
      }
      return false;
    },
    async hasText(values) {
      const body = await page.locator("body").innerText();
      return values.some((value) => body.includes(value));
    },
    async setInputFiles(selectors, paths) {
      await (await first(selectors)).setInputFiles([...paths]);
    },
    async fill(selectors, value) {
      await (await first(selectors)).fill(value);
    },
    async readValue(selectors) {
      return (await first(selectors)).inputValue();
    },
    async count(selectors) {
      for (const selector of selectors) {
        const candidate = page.locator(selector).first();
        if (await candidate.count() > 0) return Number.parseInt((await candidate.textContent()) ?? "0", 10);
      }
      return 0;
    },
    async screenshot(path) {
      await page.screenshot({ path });
    },
    guardViolations: () => [],
  };
}

async function samplePackage(): Promise<PublisherClaimResponse> {
  const bytes = await readFile(resolve(import.meta.dirname, "../../test-support/fixtures/product-screen.png"));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    publicationId: "00000000-0000-4000-8000-000000000201",
    contentVersionId: "00000000-0000-4000-8000-000000000202",
    title: "一周晚餐不再临时纠结",
    body: "把真实产品体验写成清晰、可回读的发布内容。",
    imageSha256: Array.from({ length: 7 }, () => sha256),
    contentSha256: sha256,
    imageDownloadUrls: Array.from({ length: 7 }, (_, index) => `https://storage.example.test/page-${index + 1}.png`),
    expiresAt: "2026-08-13T15:00:00.000Z",
  };
}

afterEach(async () => {
  await Promise.all(browsers.splice(0).map((browser) => browser.close()));
});

describe("Xiaohongshu prefill safety contract", () => {
  it("fills the fixture and never invokes the final publish button", async () => {
    const browser = await chromium.launch({ headless: true });
    browsers.push(browser);
    const page = await browser.newPage();
    await page.goto(`file://${fixturePath}`);
    const publication = await samplePackage();

    const result = await prefillXhs(bridge(page), {
      publication,
      imagePaths: Array.from({ length: 7 }, () => resolve(import.meta.dirname, "../../test-support/fixtures/product-screen.png")),
      screenshotPath,
    });

    expect(result.status).toBe("AWAITING_HUMAN_PUBLISH");
    expect(await page.locator("[data-test=publish-click-count]").textContent()).toBe("0");
    expect(await page.locator("[data-test=title]").inputValue()).toBe(publication.title);
    expect(await page.locator("[data-test=body]").inputValue()).toBe(publication.body);
    expect(await page.locator("[data-test=uploaded-count]").textContent()).toBe("7");
  });

  it("fails closed when content readback differs", async () => {
    const browser = await chromium.launch({ headless: true });
    browsers.push(browser);
    const page = await browser.newPage();
    await page.goto(`file://${fixturePath}#tamper=1`);

    await expect(prefillXhs(bridge(page), {
      publication: await samplePackage(),
      imagePaths: Array.from({ length: 7 }, () => resolve(import.meta.dirname, "../../test-support/fixtures/product-screen.png")),
      screenshotPath,
    })).rejects.toThrow("PREFILL_READBACK_MISMATCH");

    expect(await page.locator("[data-test=publish-click-count]").textContent()).toBe("0");
  });

  it("returns NEEDS_LOGIN before uploading when the session is not authenticated", async () => {
    const browser = await chromium.launch({ headless: true });
    browsers.push(browser);
    const page = await browser.newPage();
    await page.goto(`file://${fixturePath}#login=1`);

    const result = await prefillXhs(bridge(page), {
      publication: await samplePackage(),
      imagePaths: Array.from({ length: 7 }, () => resolve(import.meta.dirname, "../../test-support/fixtures/product-screen.png")),
      screenshotPath,
    });

    expect(result).toMatchObject({ status: "NEEDS_LOGIN" });
    expect(await page.locator("[data-test=uploaded-count]").textContent()).toBe("0");
  });
});
