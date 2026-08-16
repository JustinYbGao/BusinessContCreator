import { spawn } from "node:child_process";
import { readFile, stat, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import {
  E2E_ROOT,
  assertE2eEnvironment,
  loadE2eEnvironment,
  requiredE2eEnvironment,
} from "./env";

loadE2eEnvironment();
assertE2eEnvironment();

const BASE_URL = process.env.E2E_BASE_URL?.trim() || "http://127.0.0.1:3000";
const WORKSPACE_ID = process.env.INTERNAL_WORKSPACE_ID || "00000000-0000-4000-8000-000000000001";
const database = createClient(
  requiredE2eEnvironment("SOCIAL_AGENT_SUPABASE_URL"),
  requiredE2eEnvironment("SOCIAL_AGENT_SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { autoRefreshToken: false, persistSession: false } },
);

type JsonRecord = Record<string, unknown>;

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function idValue(value: unknown, field: string): string {
  const id = recordValue(value)[field];
  if (typeof id !== "string" || id.length === 0) throw new Error(`E2E_${field.toUpperCase()}_MISSING`);
  return id;
}

async function apiJson<T>(page: Page, path: string, options: {
  method?: string;
  payload?: unknown;
  headers?: Record<string, string>;
} = {}): Promise<T> {
  const headers = { ...(options.payload === undefined ? {} : { "content-type": "application/json" }), ...options.headers };
  const response = await page.context().request.fetch(new URL(path, BASE_URL).toString(), {
    method: options.method ?? "GET",
    headers,
    ...(options.payload === undefined ? {} : { data: JSON.stringify(options.payload) }),
  });
  const bodyText = await response.text();
  let body: unknown = null;
  try {
    body = bodyText ? JSON.parse(bodyText) as unknown : null;
  } catch {
    body = null;
  }
  if (!response.ok()) throw new Error(`E2E_API_${response.status()}`);
  return body as T;
}

async function pause(milliseconds: number): Promise<void> {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function waitForJob(jobId: string): Promise<JsonRecord> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const result = await database.from("workflow_jobs")
      .select("status,result,error")
      .eq("workspace_id", WORKSPACE_ID)
      .eq("id", jobId)
      .maybeSingle();
    if (result.error) throw new Error("E2E_JOB_LOOKUP_FAILED");
    const row = recordValue(result.data);
    if (row.status === "completed") return row;
    if (row.status === "failed") throw new Error("E2E_JOB_FAILED");
    await pause(250);
  }
  throw new Error("E2E_JOB_TIMEOUT");
}

async function waitForJobKey(productId: string, idempotencyKey: string): Promise<JsonRecord> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const result = await database.from("workflow_jobs")
      .select("id,status,result,error")
      .eq("workspace_id", WORKSPACE_ID)
      .eq("product_id", productId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (result.error) throw new Error("E2E_JOB_LOOKUP_FAILED");
    if (result.data) return waitForJob(idValue(result.data, "id"));
    await pause(250);
  }
  throw new Error("E2E_JOB_TIMEOUT");
}

async function currentVersion(contentId: string): Promise<JsonRecord> {
  const result = await database.from("content_versions")
    .select("id,version,payload,status,content_sha256")
    .eq("workspace_id", WORKSPACE_ID)
    .eq("content_id", contentId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error || !result.data) throw new Error("E2E_CONTENT_VERSION_MISSING");
  return result.data as JsonRecord;
}

async function enqueueReviewJob(productId: string, contentVersionId: string): Promise<string> {
  const idempotencyKey = `e2e:review:${contentVersionId}`;
  const inserted = await database.from("workflow_jobs").insert({
    workspace_id: WORKSPACE_ID,
    product_id: productId,
    kind: "review_content",
    idempotency_key: idempotencyKey,
    payload: { contentVersionId },
    status: "queued",
  }).select("id").single();
  if (!inserted.error && inserted.data) return idValue(inserted.data, "id");
  if (inserted.error?.code !== "23505") throw new Error("E2E_REVIEW_JOB_CREATE_FAILED");
  const existing = await database.from("workflow_jobs")
    .select("id")
    .eq("workspace_id", WORKSPACE_ID)
    .eq("idempotency_key", idempotencyKey)
    .single();
  if (existing.error || !existing.data) throw new Error("E2E_REVIEW_JOB_LOOKUP_FAILED");
  return idValue(existing.data, "id");
}

async function reviewResult(contentVersionId: string): Promise<string> {
  const result = await database.from("review_runs")
    .select("result")
    .eq("content_version_id", contentVersionId)
    .eq("is_current", true)
    .maybeSingle();
  if (result.error || !result.data || typeof result.data.result !== "string") throw new Error("E2E_REVIEW_RESULT_MISSING");
  return result.data.result;
}

async function runFixturePublisher(claimPath: string, imagePath: string): Promise<string> {
  const executable = resolve(E2E_ROOT, "node_modules/.bin/tsx");
  const entrypoint = resolve(E2E_ROOT, "apps/local-publisher/src/index.ts");
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, [entrypoint, "fixture", resolve(E2E_ROOT, "packages/test-support/fixtures/xhs-editor.html"), claimPath, imagePath], {
      cwd: E2E_ROOT,
      env: { PATH: process.env.PATH, INIT_CWD: E2E_ROOT },
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    child.on("error", () => reject(new Error("E2E_FIXTURE_PUBLISHER_FAILED")));
    child.on("exit", (code) => {
      if (code !== 0) reject(new Error("E2E_FIXTURE_PUBLISHER_FAILED"));
      else resolvePromise(output.trim());
    });
  });
}

async function publisherStatus(page: Page, publicationId: string, token: string, screenshotPath: string): Promise<void> {
  const screenshot = await readFile(screenshotPath);
  const form = new FormData();
  form.set("status", "AWAITING_HUMAN_PUBLISH");
  form.set("screenshot", new Blob([screenshot], { type: "image/png" }), "prefill.png");
  const response = await fetch(new URL(`/api/publisher/jobs/${publicationId}/status`, BASE_URL), {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  if (!response.ok) throw new Error("E2E_PUBLISHER_STATUS_FAILED");
}

test.describe("Stage 1 internal dogfood fixture", () => {
  test("runs the evidence-gated content and human-publish journey", async ({ page, request }) => {
    const anonymousResponse = await request.get(new URL("/api/campaigns", BASE_URL).toString());
    expect(anonymousResponse.status()).toBe(401);
    const suffix = Date.now().toString(36);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/app$/u);

    const productResponse = await apiJson<JsonRecord>(page, "/api/products", {
      method: "POST",
      headers: { "idempotency-key": `e2e:product:${suffix}` },
      payload: {
        name: "Stage 1 Fixture Product",
        slug: `stage1-fixture-${suffix}`,
        positioning: "为学生提供可复核的备菜建议",
        brandProfile: {
          mark: "Stage 1 Fixture",
          background: "#FFF9F0",
          foreground: "#17211B",
          accent: "#E5ECDF",
        },
      },
    });
    const product = recordValue(productResponse.product);
    const productId = idValue(product, "id");
    const channelId = idValue(productResponse.channel, "id");

    const sourceResponse = await apiJson<JsonRecord>(page, `/api/products/${productId}/sources`, {
      method: "POST",
      headers: { "idempotency-key": `e2e:source:${suffix}` },
      payload: { kind: "dormchef_local", locator: "README.md" },
    });
    expect(idValue(sourceResponse.source, "id")).toMatch(/^[0-9a-f-]{36}$/u);

    const syncResponse = await apiJson<JsonRecord>(page, `/api/products/${productId}/sync`, {
      method: "POST",
      headers: { "idempotency-key": `e2e:sync:${suffix}` },
      payload: {},
    });
    await waitForJob(idValue(syncResponse.job, "id"));

    const factsResponse = await apiJson<JsonRecord>(page, `/api/products/${productId}/facts`);
    const facts = Array.isArray(factsResponse.facts) ? factsResponse.facts : [];
    expect(facts.length).toBeGreaterThan(0);
    for (const fact of facts) {
      await apiJson(page, `/api/products/${productId}/facts`, {
        method: "POST",
        headers: { "idempotency-key": `e2e:verify:${idValue(fact, "id")}` },
        payload: { factId: idValue(fact, "id"), decision: "verify" },
      });
    }

    const campaignResponse = await apiJson<JsonRecord>(page, "/api/campaigns", {
      method: "POST",
      headers: { "idempotency-key": `e2e:campaign:${suffix}` },
      payload: {
        productId,
        channelId,
        name: "Stage 1 Fixture Campaign",
        goal: "验证证据到发布的完整闭环",
        audience: "需要快速准备晚餐的学生",
        pillarQuotas: { pain_solution: 5, product_proof: 4, region_timing: 2, founder_story: 1 },
        startsOn: "2026-09-01",
        endsOn: "2026-09-28",
      },
    });
    const campaignId = idValue(campaignResponse.campaign, "id");

    const topicJobResponse = await apiJson<JsonRecord>(page, "/api/topics/generate", {
      method: "POST",
      headers: { "idempotency-key": `e2e:topics:${suffix}` },
      payload: { campaignId },
    });
    await waitForJob(idValue(topicJobResponse.job, "id"));
    const topicsResult = await database.from("topic_candidates")
      .select("id")
      .eq("workspace_id", WORKSPACE_ID)
      .eq("campaign_id", campaignId)
      .order("created_at");
    if (topicsResult.error) throw new Error("E2E_TOPICS_LOOKUP_FAILED");
    const topicIds = (topicsResult.data ?? []).map((topic) => topic.id);
    expect(topicIds).toHaveLength(9);

    await page.goto(`/app/campaigns/${campaignId}/topics`);
    await expect(page.locator('input[name="topicId"]')).toHaveCount(9);
    await apiJson(page, "/api/topics/select", {
      method: "POST",
      headers: { "x-request-id": `e2e:select:${suffix}` },
      payload: { campaignId, topicIds: topicIds.slice(0, 3) },
    });
    await page.goto(`/app/campaigns/${campaignId}/topics`);
    await expect(page.locator("article").filter({ hasText: "本周入选" })).toHaveCount(3);

    const contentIds: string[] = [];
    for (const [index, topicId] of topicIds.slice(0, 3).entries()) {
      const contentResponse = await apiJson<JsonRecord>(page, "/api/contents", {
        method: "POST",
        headers: { "idempotency-key": `e2e:content:${suffix}:${index}` },
        payload: { campaignId, topicId, desiredCta: "欢迎分享你的真实使用场景" },
      });
      contentIds.push(idValue(contentResponse.content, "id"));
    }
    expect(contentIds).toHaveLength(3);

    const finalVersions: string[] = [];
    for (const [index, contentId] of contentIds.entries()) {
      const generation = await apiJson<JsonRecord>(page, `/api/contents/${contentId}/generate`, {
        method: "POST",
        headers: { "idempotency-key": `e2e:generate:${suffix}:${index}` },
        payload: {},
      });
      const generatedJob = await waitForJob(idValue(generation.job, "id"));
      const generatedVersionId = idValue(recordValue(generatedJob.result), "contentVersionId");
      const generatedVersion = await currentVersion(contentId);
      const generatedPayload = recordValue(generatedVersion.payload);
      const renderInput = recordValue(generatedPayload.renderInput);
      expect(renderInput.pages).toHaveLength(7);
      expect(recordValue(renderInput.brand).background).toBe("#FFF9F0");

      if (index === 0) {
        const blockedPayload = { ...generatedPayload, interactionPrompt: "扫码添加微信获取完整版" };
        const blockedEdit = await apiJson<JsonRecord>(page, `/api/contents/${contentId}/generate`, {
          method: "POST",
          headers: { "idempotency-key": `e2e:blocked-edit:${suffix}` },
          payload: { action: "edit", editReason: "验证站外 CTA 阻塞规则", payload: blockedPayload },
        });
        const blockedVersionId = idValue(blockedEdit.version, "id");
        const blockedReviewJob = await enqueueReviewJob(productId, blockedVersionId);
        await waitForJob(blockedReviewJob);
        expect(await reviewResult(blockedVersionId)).toBe("blocked");
        await page.goto("/app/review");
        await expect(page.getByText("COMPLIANCE_WECHAT_MINIPROGRAM_QR")).toBeVisible();

        const correctedPayload = { ...blockedPayload, interactionPrompt: "你会先尝试哪一步？" };
        const correctedEdit = await apiJson<JsonRecord>(page, `/api/contents/${contentId}/generate`, {
          method: "POST",
          headers: { "idempotency-key": `e2e:corrected-edit:${suffix}` },
          payload: { action: "edit", editReason: "移除站外 CTA 并保留站内互动", payload: correctedPayload },
        });
        const correctedVersionId = idValue(correctedEdit.version, "id");
        const correctedReviewJob = await enqueueReviewJob(productId, correctedVersionId);
        await waitForJob(correctedReviewJob);
        expect(await reviewResult(correctedVersionId)).toBe("passed");
        await waitForJobKey(productId, `content:${correctedVersionId}:render:v1`);
        finalVersions.push(correctedVersionId);
      } else {
        const reviewJob = await enqueueReviewJob(productId, generatedVersionId);
        await waitForJob(reviewJob);
        expect(await reviewResult(generatedVersionId)).toBe("passed");
        await waitForJobKey(productId, `content:${generatedVersionId}:render:v1`);
        finalVersions.push(generatedVersionId);
      }
    }
    expect(finalVersions).toHaveLength(3);

    for (const [index, contentId] of contentIds.entries()) {
      const versionId = finalVersions[index]!;
      const approved = await apiJson<JsonRecord>(page, `/api/contents/${contentId}/approve`, {
        method: "POST",
        headers: { "idempotency-key": `e2e:approve:${suffix}:${index}` },
        payload: { contentVersionId: versionId },
      });
      expect(recordValue(approved.version).status).toBe("approved");
    }

    const assetsResult = await database.from("assets")
      .select("id")
      .eq("workspace_id", WORKSPACE_ID)
      .eq("product_id", productId)
      .in("content_version_id", finalVersions)
      .eq("kind", "carousel_page")
      .eq("verification_status", "verified")
      .eq("public_use_allowed", true);
    if (assetsResult.error) throw new Error("E2E_ASSETS_LOOKUP_FAILED");
    expect(assetsResult.data ?? []).toHaveLength(21);

    const publication = await apiJson<JsonRecord>(page, "/api/publications", {
      method: "POST",
      headers: { "idempotency-key": `e2e:publication:${suffix}` },
      payload: { contentVersionId: finalVersions[0] },
    });
    const publicationId = idValue(publication, "publicationId");
    expect(publication.imageObjectKeys).toHaveLength(7);

    const deviceResponse = await apiJson<JsonRecord>(page, "/api/publisher/devices", {
      method: "POST",
      headers: { "idempotency-key": `e2e:device:${suffix}` },
      payload: { name: "Stage 1 Fixture Device" },
    });
    const deviceToken = idValue(deviceResponse, "token");
    const claimResponse = await page.context().request.fetch(new URL("/api/publisher/jobs/claim", BASE_URL).toString(), {
      method: "POST",
      headers: { authorization: `Bearer ${deviceToken}` },
    });
    expect(claimResponse.status()).toBe(200);
    const claim = recordValue(await claimResponse.json());
    const fixtureClaim = {
      ...claim,
      imageDownloadUrls: Array.from({ length: 7 }, (_, index) => `https://storage.example.test/page-${index + 1}.png`),
    };
    const claimPath = resolve(E2E_ROOT, "test-results/stage1-fixture-claim.json");
    const imagePath = resolve(E2E_ROOT, "packages/test-support/fixtures/product-screen.png");
    const screenshotPath = resolve("/private/tmp", `social-agent-fixture-${publicationId}.png`);
    await writeFile(claimPath, JSON.stringify(fixtureClaim), { mode: 0o600 });
    try {
      expect(await runFixturePublisher(claimPath, imagePath)).toBe("AWAITING_HUMAN_PUBLISH");
      await stat(screenshotPath);
      await publisherStatus(page, publicationId, deviceToken, screenshotPath);
    } finally {
      await unlink(claimPath).catch(() => undefined);
      await unlink(screenshotPath).catch(() => undefined);
    }

    const publishedAt = new Date().toISOString();
    await apiJson(page, `/api/publications/${publicationId}/publish`, {
      method: "POST",
      payload: { publicUrl: "https://www.xiaohongshu.com/explore/stage1-fixture", publishedAt },
    });
    const rows = ["24h", "72h", "7d"].map((window, index) => ({
      workspaceId: WORKSPACE_ID,
      productId,
      publicationId,
      window,
      capturedAt: new Date().toISOString(),
      metrics: { impressions: 1_000 + index * 100, views: 800 + index * 80, likes: 80, saves: 40, comments: 10, shares: 5, followersGained: 3 },
      productConversion: [
        { event: "firstOpen", count: 5, attribution: "direct", confidence: "high" },
        { event: "activation", count: 3, attribution: "self_reported", confidence: "medium" },
        { event: "coreAction", count: 1, attribution: "inferred", confidence: "low" },
      ],
    }));
    const importResponse = await apiJson<JsonRecord>(page, "/api/metrics/import", {
      method: "POST",
      payload: { productId, rows },
    });
    expect(importResponse.acceptedRows).toBe(3);

    const retrospective = await apiJson<JsonRecord>(page, `/api/publications/${publicationId}/retrospective`, {
      method: "POST",
      payload: {
        window: "7d",
        qualitativeObservations: [{
          code: "keep.evidence-led",
          text: "保留有 Fact 支撑的场景表达",
          evidence: { kind: "metric", key: "views", value: 960 },
        }],
      },
    });
    const retrospectiveValue = recordValue(retrospective.retrospective);
    expect(retrospectiveValue.confidence).toBe("hypothesis");
    expect(recordValue(retrospectiveValue.conversions).direct).toBe(5);
    expect(recordValue(retrospectiveValue.conversions).selfReported).toBe(3);
    expect(recordValue(retrospectiveValue.conversions).inferred).toBe(1);

    await page.goto(`/app/publications/${publicationId}`);
    await expect(page.getByText("最终发布仍由人工完成")).toBeVisible();
    await expect(page.getByText("https://www.xiaohongshu.com/explore/stage1-fixture")).toBeVisible();
    await page.goto("/app/analytics");
    await expect(page.getByText("direct: 5")).toBeVisible();
    await expect(page.getByText("self-reported: 3")).toBeVisible();
    await expect(page.getByText("inferred: 1")).toBeVisible();
  });
});
