import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PublisherApi, type DownloadedClaimImages } from "./api.js";
import { launchFixtureSession, launchPersistentSession, type BrowserSession } from "./browser.js";
import { prefillXhs, validatePublisherClaim } from "@social-agent/xhs-adapter";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_NOT_CONFIGURED`);
  return value;
}

function resolveCommandPath(value: string): string {
  return resolve(process.env.INIT_CWD?.trim() || process.cwd(), value);
}

async function runOnce(): Promise<void> {
  const api = new PublisherApi({
    baseUrl: required("SOCIAL_AGENT_PUBLISHER_API_URL"),
    token: required("SOCIAL_AGENT_PUBLISHER_DEVICE_TOKEN"),
    storageOrigin: required("SOCIAL_AGENT_PUBLISHER_STORAGE_ORIGIN"),
  });
  const claim = await api.claim();
  if (!claim) return;
  let images: DownloadedClaimImages | null = null;
  let session: BrowserSession | null = null;
  let screenshotPath: string | undefined;
  let statusReported = false;
  try {
    images = await api.downloadClaimImages(claim);
    screenshotPath = resolve(images.directory, "prefill.png");
    session = await launchPersistentSession({
      profileDir: required("SOCIAL_AGENT_XHS_PROFILE_DIR"),
      editorUrl: process.env.SOCIAL_AGENT_XHS_EDITOR_URL?.trim() || "https://creator.xiaohongshu.com/",
    });
    const result = await prefillXhs(session.page, {
      publication: claim,
      imagePaths: images.paths,
      screenshotPath,
    });
    if (result.status === "NEEDS_LOGIN") {
      await api.updateStatus(claim.publicationId, result.status, { failureReason: result.reason });
    } else if (result.status === "AWAITING_HUMAN_PUBLISH") {
      await api.updateStatus(claim.publicationId, result.status, {
        screenshotPath: result.screenshotPath,
      });
    } else {
      const options: { failureReason: string; screenshotPath?: string } = { failureReason: result.reason };
      if (result.screenshotPath) options.screenshotPath = result.screenshotPath;
      await api.updateStatus(claim.publicationId, result.status, options);
    }
    statusReported = true;
  } catch (error) {
    if (!statusReported) {
      const reason = error instanceof Error ? error.message.slice(0, 200) : "PREFILL_FAILED";
      let failureScreenshotPath: string | undefined;
      if (session && screenshotPath) {
        try {
          await session.page.screenshot(screenshotPath);
          failureScreenshotPath = screenshotPath;
        } catch {
          failureScreenshotPath = undefined;
        }
      }
      const failureOptions: { failureReason: string; screenshotPath?: string } = { failureReason: reason };
      if (failureScreenshotPath) failureOptions.screenshotPath = failureScreenshotPath;
      try {
        await api.updateStatus(claim.publicationId, "PREFILL_FAILED", failureOptions);
      } catch {
        // Preserve the original failure; the server keeps the claimed job scoped for reconciliation.
      }
    }
    throw error;
  } finally {
    await session?.close();
    await images?.cleanup();
  }
}

async function runFixture(): Promise<void> {
  const offset = process.argv[2] === "--" ? 1 : 0;
  const fixturePath = resolveCommandPath(process.argv[3 + offset] ?? required("SOCIAL_AGENT_XHS_FIXTURE_PATH"));
  const claimPath = resolveCommandPath(process.argv[4 + offset] ?? required("SOCIAL_AGENT_XHS_FIXTURE_CLAIM_PATH"));
  const imagePath = resolveCommandPath(process.argv[5 + offset] ?? required("SOCIAL_AGENT_XHS_FIXTURE_IMAGE_PATH"));
  const claim = validatePublisherClaim(JSON.parse(await readFile(claimPath, "utf8")));
  const session = await launchFixtureSession(fixturePath);
  const screenshotPath = resolve("/private/tmp", `social-agent-fixture-${claim.publicationId}.png`);
  try {
    const result = await prefillXhs(session.page, {
      publication: claim,
      imagePaths: Array.from({ length: 7 }, () => imagePath),
      screenshotPath,
    });
    if (await session.page.count(["[data-test=publish-click-count]"]) !== 0) {
      throw new Error("FINAL_PUBLISH_CLICK_DETECTED");
    }
    process.stdout.write(`${result.status}\n`);
  } finally {
    await session.close();
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2] === "--" ? process.argv[3] ?? "once" : process.argv[2] ?? "once";
  if (mode === "once") {
    await runOnce();
    return;
  }
  if (mode === "fixture") {
    await runFixture();
    return;
  }
  throw new Error(`UNKNOWN_MODE_${mode}`);
}

if (process.argv[1]?.endsWith("index.ts")) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "LOCAL_PUBLISHER_FAILED"}\n`);
    process.exitCode = 1;
  });
}

export { main, runOnce, runFixture };
