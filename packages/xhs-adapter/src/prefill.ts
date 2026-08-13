import type { PublisherClaimResponse } from "@social-agent/contracts";
import { XHS_EDITOR_SELECTORS } from "./selectors.js";

export interface PrefillPage {
  hasSelector(selectors: readonly string[]): Promise<boolean>;
  hasText(values: readonly string[]): Promise<boolean>;
  setInputFiles(selectors: readonly string[], paths: readonly string[]): Promise<void>;
  fill(selectors: readonly string[], value: string): Promise<void>;
  readValue(selectors: readonly string[]): Promise<string>;
  count(selectors: readonly string[]): Promise<number>;
  screenshot(path: string): Promise<void>;
  guardViolations(): readonly string[];
}

export interface PrefillInput {
  publication: PublisherClaimResponse;
  imagePaths: readonly string[];
  screenshotPath: string;
}

export type PrefillResult =
  | { status: "NEEDS_LOGIN"; reason: "LOGIN_REQUIRED" | "CAPTCHA_REQUIRED" }
  | { status: "PREFILL_FAILED"; reason: "CAPTCHA_REQUIRED" | "SAFETY_GUARD_VIOLATION"; screenshotPath?: string }
  | { status: "AWAITING_HUMAN_PUBLISH"; screenshotPath: string; uploadedCount: number };

function normalizeText(value: string): string {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n").map((line) => line.trimEnd()).join("\n").trim();
}

async function needsLogin(page: PrefillPage): Promise<boolean> {
  return await page.hasSelector(XHS_EDITOR_SELECTORS.loginMarkers)
    || await page.hasText(XHS_EDITOR_SELECTORS.loginText);
}

async function needsCaptcha(page: PrefillPage): Promise<boolean> {
  return await page.hasSelector(XHS_EDITOR_SELECTORS.captchaMarkers)
    || await page.hasText(XHS_EDITOR_SELECTORS.captchaText);
}

export async function prefillXhs(page: PrefillPage, input: PrefillInput): Promise<PrefillResult> {
  if (input.imagePaths.length !== 7) throw new Error("IMAGE_COUNT_INVALID");
  if (page.guardViolations().length > 0) throw new Error("SAFETY_GUARD_VIOLATION");
  if (await needsLogin(page)) return { status: "NEEDS_LOGIN", reason: "LOGIN_REQUIRED" };
  if (await needsCaptcha(page)) return { status: "NEEDS_LOGIN", reason: "CAPTCHA_REQUIRED" };

  await page.setInputFiles(XHS_EDITOR_SELECTORS.uploadInput, input.imagePaths);
  await page.fill(XHS_EDITOR_SELECTORS.titleInput, input.publication.title);
  await page.fill(XHS_EDITOR_SELECTORS.bodyInput, input.publication.body);

  const title = normalizeText(await page.readValue(XHS_EDITOR_SELECTORS.titleInput));
  const body = normalizeText(await page.readValue(XHS_EDITOR_SELECTORS.bodyInput));
  const reportedCount = await page.count(XHS_EDITOR_SELECTORS.uploadedCount);
  if (
    title !== normalizeText(input.publication.title)
    || body !== normalizeText(input.publication.body)
    || reportedCount !== 7
    || page.guardViolations().length > 0
  ) {
    if (page.guardViolations().length > 0) throw new Error("SAFETY_GUARD_VIOLATION");
    throw new Error("PREFILL_READBACK_MISMATCH");
  }

  await page.screenshot(input.screenshotPath);
  return { status: "AWAITING_HUMAN_PUBLISH", screenshotPath: input.screenshotPath, uploadedCount: reportedCount };
}
