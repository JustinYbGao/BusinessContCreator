import { pathToFileURL } from "node:url";
import type {
  DatabaseClient,
  LearningRepository,
  ProductFactRepository,
  TopicRepository,
} from "@social-agent/db";
import {
  SupabaseCampaignRepository,
  SupabaseJobRepository,
  SupabaseLearningRepository,
  SupabaseProductFactRepository,
  SupabaseTopicRepository,
  createSupabaseClient,
  databaseError,
} from "@social-agent/db";
import { DormChefLocalAdapter } from "@social-agent/dormchef-adapter";
import { OpenAiCompatibleClient, type LlmEnvironment } from "@social-agent/llm";
import type { ReviewContext } from "@social-agent/review-engine";
import type { TopicGenerationInput } from "@social-agent/topic-engine";
import type { ContentGenerationInput } from "@social-agent/content-engine";
import {
  renderCarousel,
  type AssetStoragePort,
  type RenderCarouselInput,
  type SourceAssetResolverPort,
  type VisualBrand,
  type VisualPageScript,
} from "@social-agent/visual-engine";
import {
  createContentHandler,
} from "./handlers/generate-content.js";
import { createTopicHandler } from "./handlers/generate-topics.js";
import { createPurgeProductHandler } from "./handlers/purge-product.js";
import { createRenderAssetsHandler } from "./handlers/render-assets.js";
import { createReviewHandler } from "./handlers/review-content.js";
import { createSyncProductHandler } from "./handlers/sync-product.js";
import { createFixtureLlm } from "./fixture-llm.js";
import { createReadinessState, startHealthServer, type ReadinessState } from "./health.js";
import { createWorkerId, WorkerRunner, type WorkerLogger } from "./runner.js";
import { createSupabaseWorkflowCommitter } from "./workflow-committer.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORAGE_BUCKET = "social-agent-assets";

export type WorkerEnvironment = {
  mode: "production" | "fixture";
  supabaseUrl: string;
  serviceRoleKey: string;
  workspaceId: string;
  dormChefSourceDir: string;
  llm: LlmEnvironment;
  healthPort: number;
  workerId: string | undefined;
};

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error("WORKER_CONFIG_MISSING");
  return value;
}

function portValue(value: string | undefined): number {
  if (!value) return 3001;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("WORKER_CONFIG_INVALID");
  return port;
}

export function parseWorkerEnvironment(env: NodeJS.ProcessEnv = process.env): WorkerEnvironment {
  const modeValue = env.SOCIAL_AGENT_WORKER_MODE?.trim() || "production";
  if (modeValue !== "production" && modeValue !== "fixture") throw new Error("WORKER_CONFIG_INVALID");
  const mode = modeValue as WorkerEnvironment["mode"];
  const supabaseUrl = required(env, "SOCIAL_AGENT_SUPABASE_URL");
  try {
    const parsed = new URL(supabaseUrl);
    if (!parsed.protocol.startsWith("http")) throw new Error("invalid");
  } catch {
    throw new Error("WORKER_CONFIG_INVALID");
  }

  const workspaceId = required(env, "INTERNAL_WORKSPACE_ID");
  if (!UUID_PATTERN.test(workspaceId)) throw new Error("WORKER_CONFIG_INVALID");

  return {
    supabaseUrl,
    serviceRoleKey: required(env, "SOCIAL_AGENT_SUPABASE_SERVICE_ROLE_KEY"),
    workspaceId,
    dormChefSourceDir: required(env, "DORMCHEF_SOURCE_DIR"),
    mode,
    llm: mode === "fixture"
      ? { LLM_BASE_URL: "fixture://local", LLM_API_KEY: "fixture", LLM_MODEL: "fixture-model" }
      : {
          LLM_BASE_URL: required(env, "LLM_BASE_URL"),
          LLM_API_KEY: required(env, "LLM_API_KEY"),
          LLM_MODEL: required(env, "LLM_MODEL"),
        },
    healthPort: portValue(env.WORKER_HEALTH_PORT),
    workerId: env.WORKER_ID?.trim() || undefined,
  };
}

type PreparedSourceAsset = {
  bytes: Buffer;
  mimeType: "image/png";
  width: number;
  height: number;
  sha256: string;
};

function createStoragePort(db: DatabaseClient): AssetStoragePort {
  const ownedAttempts = new Map<string, string>();
  return {
    async upload(objectKey, bytes, metadata) {
      const { error } = await db.storage.from(STORAGE_BUCKET).upload(objectKey, bytes, {
        contentType: metadata.contentType,
        upsert: true,
        metadata: {
          sha256: metadata.sha256,
          verified: String(metadata.verified),
          uploadAttemptId: metadata.uploadAttemptId,
        },
      });
      if (error) throw databaseError(error);
      ownedAttempts.set(objectKey, metadata.uploadAttemptId);
    },
    async removeOwned(objectKeys, uploadAttemptId) {
      const ownedKeys = objectKeys.filter((objectKey) => ownedAttempts.get(objectKey) === uploadAttemptId);
      if (ownedKeys.length === 0) return;
      const { error } = await db.storage.from(STORAGE_BUCKET).remove(ownedKeys);
      if (error) throw databaseError(error);
      for (const objectKey of ownedKeys) ownedAttempts.delete(objectKey);
    },
  };
}

function createSourceAssetResolver(db: DatabaseClient): SourceAssetResolverPort {
  return {
    async resolveVerifiedSourceAsset(input) {
      const { data, error } = await db.from("assets")
        .select("id,workspace_id,product_id,object_key,mime_type,sha256,verification_status,public_use_allowed")
        .eq("workspace_id", input.workspaceId)
        .eq("product_id", input.productId)
        .eq("id", input.assetId)
        .is("content_version_id", null)
        .eq("provenance", "source")
        .eq("verification_status", "verified")
        .eq("public_use_allowed", true)
        .maybeSingle();
      if (error) throw databaseError(error);
      if (!data) return null;

      const row = data as Record<string, unknown>;
      const mimeType = row.mime_type;
      if (mimeType !== "image/png" && mimeType !== "image/jpeg" && mimeType !== "image/webp") {
        return null;
      }
      const objectKey = row.object_key;
      if (typeof objectKey !== "string") return null;
      const downloaded = await db.storage.from(STORAGE_BUCKET).download(objectKey);
      if (downloaded.error) throw databaseError(downloaded.error);
      return {
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        productId: String(row.product_id),
        verificationStatus: "verified" as const,
        publicUseAllowed: true as const,
        mimeType,
        sha256: String(row.sha256),
        bytes: Buffer.from(await downloaded.data.arrayBuffer()),
      };
    },
  };
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function createTopicInputLoader(
  campaigns: SupabaseCampaignRepository,
  facts: ProductFactRepository,
  topics: TopicRepository,
  learnings: LearningRepository,
) {
  return async (input: { workspaceId: string; productId: string; campaignId: string }): Promise<TopicGenerationInput> => {
    const scope = { workspaceId: input.workspaceId };
    const campaign = await campaigns.get(scope, input.campaignId);
    if (!campaign || campaign.productId !== input.productId) throw new Error("CAMPAIGN_SCOPE_MISMATCH");
    const usableFacts = await facts.listUsable(scope, input.productId);
    const topicRows = await topics.listByCampaign(scope, input.campaignId);
    const learningRows = await learnings.listEligible(scope, input.productId, input.campaignId);

    return {
      campaign: {
        goal: campaign.goal,
        audience: campaign.audience,
        pillarQuotas: campaign.pillarQuotas as TopicGenerationInput["campaign"]["pillarQuotas"],
      },
      facts: usableFacts.map((fact) => ({
        id: fact.id,
        statement: fact.statement,
        category: fact.category,
        status: "verified" as const,
        publicUseAllowed: true as const,
      })),
      recentTopics: topicRows
        .map((row) => recordValue(row).title)
        .filter((title): title is string => typeof title === "string"),
      learnings: learningRows.map((learning) => {
        const payload = recordValue(learning.payload);
        return {
          id: learning.id,
          summary: typeof payload.summary === "string" ? payload.summary : "",
          samples: typeof payload.samples === "number" ? payload.samples : 0,
          completed: payload.completed === true,
        };
      }),
    };
  };
}

function createPurgePort(db: DatabaseClient) {
  return {
    async purge(input: {
      workspaceId: string;
      productId: string;
      confirmationAuditId: string;
      actorId: string;
      requestId: string;
    }) {
      const { data: product, error: productError } = await db.from("products")
        .select("id,deleted_at")
        .eq("workspace_id", input.workspaceId)
        .eq("id", input.productId)
        .maybeSingle();
      if (productError) throw databaseError(productError);
      if (product && product.deleted_at === null) throw new Error("PRODUCT_NOT_SOFT_DELETED");

      if (product) {
        const { data: confirmation, error: confirmationError } = await db.from("audit_events")
          .select("id,product_id,action,payload")
          .eq("workspace_id", input.workspaceId)
          .eq("id", input.confirmationAuditId)
          .maybeSingle();
        if (confirmationError) throw databaseError(confirmationError);
        const confirmationRow = confirmation as Record<string, unknown> | null;
        const payload = recordValue(confirmationRow?.payload);
        if (
          !confirmationRow
          || confirmationRow.action !== "product.soft_deleted"
          || (confirmationRow.product_id !== input.productId
            && payload.purged_product_id !== input.productId)
        ) {
          throw new Error("PURGE_CONFIRMATION_MISMATCH");
        }
      }

      const objectKeys = await productObjectKeys(db, input.workspaceId, input.productId);
      if (objectKeys.length > 0) {
        const { error } = await db.storage.from(STORAGE_BUCKET).remove(objectKeys);
        if (error) throw databaseError(error);
      }
      const { data, error } = await db.rpc("purge_product", {
        p_workspace_id: input.workspaceId,
        p_product_id: input.productId,
        p_storage_clean: true,
        p_actor_type: "worker",
        p_actor_id: input.actorId,
        p_request_id: input.requestId,
      });
      if (error) throw databaseError(error);
      if (data !== true) throw new Error("PURGE_NOT_COMPLETED");
      return { rowsDeleted: 0, objectsDeleted: objectKeys.length };
    },
  };
}

async function productObjectKeys(db: DatabaseClient, workspaceId: string, productId: string): Promise<string[]> {
  const keys: string[] = [];
  const [assets, publications] = await Promise.all([
    db.from("assets").select("object_key").eq("workspace_id", workspaceId).eq("product_id", productId),
    db.from("publications").select("prefill_screenshot_key").eq("workspace_id", workspaceId).eq("product_id", productId),
  ]);
  if (assets.error) throw databaseError(assets.error);
  if (publications.error) throw databaseError(publications.error);
  for (const row of assets.data ?? []) {
    if (typeof row.object_key === "string") keys.push(row.object_key);
  }
  for (const row of publications.data ?? []) {
    if (typeof row.prefill_screenshot_key === "string") keys.push(row.prefill_screenshot_key);
  }

  const prefixes = [
    `source/${productId}`,
    `workspaces/${workspaceId}/products/${productId}`,
  ];
  const { data: versions, error: versionsError } = await db.from("content_versions")
    .select("id").eq("workspace_id", workspaceId).eq("product_id", productId);
  if (versionsError) throw databaseError(versionsError);
  for (const row of versions ?? []) {
    if (typeof row.id === "string") prefixes.push(`staging/${row.id}`);
  }
  for (const prefix of prefixes) {
    keys.push(...await listStorageKeys(db, prefix));
  }
  return [...new Set(keys)];
}

async function listStorageKeys(db: DatabaseClient, root: string): Promise<string[]> {
  const pending = [root];
  const keys: string[] = [];
  while (pending.length > 0) {
    const prefix = pending.shift()!;
    const { data, error } = await db.storage.from(STORAGE_BUCKET).list(prefix, { limit: 1_000 });
    if (error) throw databaseError(error);
    for (const item of data ?? []) {
      const itemRecord = item as { id?: string | null; metadata?: unknown; name: string };
      const objectKey = `${prefix}/${itemRecord.name}`;
      if (itemRecord.id || itemRecord.metadata) keys.push(objectKey);
      else pending.push(objectKey);
    }
  }
  return keys;
}

function createRenderInputLoader(
  db: DatabaseClient,
  sourceAssetResolver: SourceAssetResolverPort,
) {
  return async (input: { workspaceId: string; productId: string; contentVersionId: string }): Promise<RenderCarouselInput> => {
    const { data, error } = await db.from("content_versions")
      .select("payload").eq("workspace_id", input.workspaceId).eq("product_id", input.productId)
      .eq("id", input.contentVersionId).maybeSingle();
    if (error) throw databaseError(error);
    if (!data) throw new Error("CONTENT_VERSION_NOT_FOUND");
    const payload = recordValue((data as Record<string, unknown>).payload);
    const renderPayload = recordValue(payload.renderInput ?? payload.render_input);
    const pages = renderPayload.pages;
    const brand = recordValue(renderPayload.brand);
    if (!Array.isArray(pages) || pages.length !== 7) throw new Error("RENDER_INPUT_REQUIRED");
    if (![brand.mark, brand.background, brand.foreground, brand.accent].every((value) => typeof value === "string")) {
      throw new Error("RENDER_BRAND_REQUIRED");
    }
    return {
      workspaceId: input.workspaceId,
      productId: input.productId,
      contentVersionId: input.contentVersionId,
      pages: pages as VisualPageScript[],
      sourceAssetResolver,
      brand: brand as unknown as VisualBrand,
    };
  };
}

function createReviewContextLoader(db: DatabaseClient) {
  return async (input: { workspaceId: string; contentVersionId: string }): Promise<ReviewContext> => {
    const { data, error } = await db.rpc("review_context_for_version", {
      p_workspace_id: input.workspaceId,
      p_content_version_id: input.contentVersionId,
    });
    if (error) throw databaseError(error);
    if (!data || typeof data !== "object") throw new Error("REVIEW_CONTEXT_REQUIRED");
    return data as ReviewContext;
  };
}

function contentInputAlreadyPrepared(value: Record<string, unknown>): boolean {
  return ["topic", "campaign", "facts", "assets", "learnings", "brandProfile", "desiredCta"]
    .every((key) => value[key] !== undefined);
}

function createContentInputLoader(db: DatabaseClient, learnings: LearningRepository) {
  return async (input: {
    workspaceId: string;
    productId: string;
    contentInput: unknown;
  }): Promise<ContentGenerationInput> => {
    const jobPayload = recordValue(input.contentInput);
    if (contentInputAlreadyPrepared(jobPayload)) return jobPayload as unknown as ContentGenerationInput;

    const contentId = jobPayload.contentId;
    const campaignId = jobPayload.campaignId;
    const topicId = jobPayload.topicId;
    const briefId = jobPayload.briefId;
    if (
      typeof contentId !== "string" || contentId.length === 0
      || typeof campaignId !== "string" || campaignId.length === 0
      || typeof topicId !== "string" || topicId.length === 0
      || typeof briefId !== "string" || briefId.length === 0
    ) {
      throw new Error("CONTENT_INPUT_REQUIRED");
    }

    const [contentResult, campaignResult, productResult, topicResult, briefResult] = await Promise.all([
      db.from("contents").select("id,product_id,campaign_id,topic_id")
        .eq("workspace_id", input.workspaceId).eq("id", contentId).maybeSingle(),
      db.from("campaigns").select("id,product_id,goal,audience")
        .eq("workspace_id", input.workspaceId).eq("id", campaignId).maybeSingle(),
      db.from("products").select("id,brand_profile")
        .eq("workspace_id", input.workspaceId).eq("id", input.productId).is("deleted_at", null).maybeSingle(),
      db.from("topic_candidates").select("id,product_id,campaign_id,title,angle,pillar,fact_ids")
        .eq("workspace_id", input.workspaceId).eq("id", topicId).maybeSingle(),
      db.from("content_briefs").select("id,payload")
        .eq("workspace_id", input.workspaceId).eq("id", briefId).maybeSingle(),
    ]);
    if (contentResult.error) throw databaseError(contentResult.error);
    if (campaignResult.error) throw databaseError(campaignResult.error);
    if (productResult.error) throw databaseError(productResult.error);
    if (topicResult.error) throw databaseError(topicResult.error);
    if (briefResult.error) throw databaseError(briefResult.error);

    const content = contentResult.data as Record<string, unknown> | null;
    const campaign = campaignResult.data as Record<string, unknown> | null;
    const product = productResult.data as Record<string, unknown> | null;
    const topic = topicResult.data as Record<string, unknown> | null;
    const brief = briefResult.data as Record<string, unknown> | null;
    if (
      !content || !campaign || !product || !topic || !brief
      || content.product_id !== input.productId
      || content.campaign_id !== campaignId
      || content.topic_id !== topicId
      || campaign.product_id !== input.productId
      || topic.product_id !== input.productId
      || topic.campaign_id !== campaignId
    ) {
      throw new Error("CONTENT_SCOPE_MISMATCH");
    }

    const factIds = Array.isArray(topic.fact_ids)
      ? topic.fact_ids.filter((value): value is string => typeof value === "string")
      : [];
    let factsQuery = db.from("product_facts")
      .select("id,statement,category,status,public_use_allowed")
      .eq("workspace_id", input.workspaceId).eq("product_id", input.productId)
      .eq("status", "verified").eq("public_use_allowed", true);
    if (factIds.length > 0) factsQuery = factsQuery.in("id", factIds);
    const [factsResult, assetsResult, learningRows] = await Promise.all([
      factsQuery,
      db.from("assets").select("id,kind,source_locator")
        .eq("workspace_id", input.workspaceId).eq("product_id", input.productId)
        .is("content_version_id", null).eq("provenance", "source")
        .eq("verification_status", "verified").eq("public_use_allowed", true).order("created_at"),
      learnings.listEligible({ workspaceId: input.workspaceId }, input.productId, campaignId),
    ]);
    if (factsResult.error) throw databaseError(factsResult.error);
    if (assetsResult.error) throw databaseError(assetsResult.error);

    const briefPayload = recordValue(brief.payload);
    return {
      topic: {
        id: String(topic.id),
        title: String(topic.title),
        angle: String(topic.angle),
        pillar: String(topic.pillar),
      },
      campaign: {
        id: String(campaign.id),
        goal: String(campaign.goal),
        audience: String(campaign.audience),
      },
      facts: (factsResult.data ?? []).map((fact) => ({
        id: String(fact.id),
        statement: String(fact.statement),
        category: String(fact.category),
        status: "verified" as const,
        publicUseAllowed: true as const,
      })),
      assets: (assetsResult.data ?? []).map((asset) => ({
        id: String(asset.id),
        kind: String(asset.kind),
        description: typeof asset.source_locator === "string" ? asset.source_locator : String(asset.kind),
        verificationStatus: "verified" as const,
        publicUseAllowed: true as const,
      })),
      learnings: learningRows.map((learning) => {
        const payload = recordValue(learning.payload);
        return {
          id: learning.id,
          summary: typeof payload.summary === "string" ? payload.summary : "",
          samples: typeof payload.samples === "number" ? payload.samples : 0,
        };
      }),
      brandProfile: recordValue(product.brand_profile),
      desiredCta: typeof briefPayload.desiredCta === "string"
        ? briefPayload.desiredCta
        : "欢迎分享你的真实使用场景",
    };
  };
}

const logger: WorkerLogger = {
  info: (event, fields) => console.info(JSON.stringify({ event, ...fields })),
  error: (event, fields) => console.error(JSON.stringify({ event, ...fields })),
};

export type WorkerApplication = {
  db: DatabaseClient;
  runner: WorkerRunner;
  readiness: ReadinessState;
};

export function createWorkerApplication(environment: WorkerEnvironment): WorkerApplication {
  const db = createSupabaseClient(environment.supabaseUrl, environment.serviceRoleKey);
  const jobs = new SupabaseJobRepository(db);
  const productFacts = new SupabaseProductFactRepository(db);
  const campaigns = new SupabaseCampaignRepository(db);
  const topics = new SupabaseTopicRepository(db);
  const learnings = new SupabaseLearningRepository(db);
  const storage = createStoragePort(db);
  const sourceAssetResolver = createSourceAssetResolver(db);
  const llm = environment.mode === "fixture" ? createFixtureLlm() : new OpenAiCompatibleClient(environment.llm);
  const sourceAssets = new Map<string, PreparedSourceAsset>();
  const adapter = new DormChefLocalAdapter(environment.dormChefSourceDir, {
    assetSink: async ({ relativeLocator, sanitized }) => {
      sourceAssets.set(relativeLocator, sanitized);
    },
  });

  const syncHandler = createSyncProductHandler(adapter, {
    prepareAsset: async ({ productId, candidate }) => {
      const prepared = sourceAssets.get(candidate.relativeLocator);
      if (!prepared) throw new Error("SOURCE_ASSET_NOT_PREPARED");
      const objectKey = `source/${productId}/${candidate.sha256}.png`;
      await storage.upload(objectKey, prepared.bytes, {
        contentType: "image/png",
        sha256: prepared.sha256,
        verified: true,
        uploadAttemptId: `source:${productId}:${candidate.sha256}`,
      });
      return {
        kind: candidate.kind,
        source_locator: candidate.relativeLocator,
        object_key: objectKey,
        mime_type: prepared.mimeType,
        byte_size: prepared.bytes.byteLength,
        width: prepared.width,
        height: prepared.height,
        sha256: prepared.sha256,
        verification_status: "candidate" as const,
        public_use_allowed: false as const,
      };
    },
  });
  const contentInputLoader = createContentInputLoader(db, learnings);
  const renderInputLoader = createRenderInputLoader(db, sourceAssetResolver);
  const reviewContextLoader = createReviewContextLoader(db);
  const topicInputLoader = createTopicInputLoader(campaigns, productFacts, topics, learnings);
  const handlers = {
    sync_product: syncHandler,
    purge_product: createPurgeProductHandler(createPurgePort(db)),
    generate_topics: createTopicHandler({ llm, loadInput: topicInputLoader }),
    generate_content: createContentHandler({ llm, loadInput: contentInputLoader }),
    review_content: createReviewHandler({ llm, loadContext: reviewContextLoader }),
    render_assets: createRenderAssetsHandler({ loadInput: renderInputLoader, render: renderCarousel, storage }),
  };
  const readiness = createReadinessState();
  const runner = new WorkerRunner({
    workspaceId: environment.workspaceId,
    jobs,
    handlers,
    workerId: environment.workerId ?? createWorkerId(),
    logger,
    committer: createSupabaseWorkflowCommitter(db, { storage }),
  });

  return { db, runner, readiness };
}

export const buildWorker = createWorkerApplication;

function closeServer(server: { close(callback: (error?: Error) => void): void }): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function commandLineHealthPort(argv: string[]): number | undefined {
  const index = argv.indexOf("--health-port");
  if (index < 0) return undefined;
  return portValue(argv[index + 1]);
}

function commandLineMode(argv: string[]): WorkerEnvironment["mode"] | undefined {
  const index = argv.indexOf("--mode");
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (value !== "production" && value !== "fixture") throw new Error("WORKER_CONFIG_INVALID");
  return value;
}

export async function runWorker(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  const environment = parseWorkerEnvironment(env);
  const mode = commandLineMode(argv) ?? environment.mode;
  const application = createWorkerApplication({
    ...environment,
    mode,
    healthPort: commandLineHealthPort(argv) ?? environment.healthPort,
  });
  application.readiness.configParsed = true;
  const server = await startHealthServer({
    port: commandLineHealthPort(argv) ?? environment.healthPort,
    state: application.readiness,
  });
  const stop = new AbortController();
  const onSignal = () => stop.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    const { error } = await application.db.from("workspaces")
      .select("id").eq("id", environment.workspaceId).maybeSingle();
    if (error) throw databaseError(error);
    application.readiness.supabaseReachable = true;
    application.readiness.pollingStarted = true;
    await application.runner.run(stop.signal);
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await closeServer(server);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runWorker().catch(() => {
    console.error("WORKER_STARTUP_FAILED");
    process.exitCode = 1;
  });
}
