import type {
  ContentDraft,
  ContentStatus,
  JobStatus,
  Publication,
  ProductFactCandidate,
} from "@social-agent/contracts";

export interface RepositoryContext {
  workspaceId: string;
  actor: { type: "user" | "worker" | "publisher" | "system"; id: string };
  requestId: string;
}

export interface WorkflowJob {
  id: string;
  workspaceId: string;
  productId: string | null;
  kind: "sync_product" | "purge_product" | "generate_topics" | "generate_content" | "review_content" | "render_assets";
  payload: unknown;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  lockedBy: string | null;
}

export interface EnqueueJobInput {
  productId: string | null;
  kind: WorkflowJob["kind"];
  idempotencyKey: string;
  payload: unknown;
}

export interface NewContentVersion {
  productId: string;
  campaignId: string;
  contentId: string;
  topicId: string;
  briefId: string;
  payload: ContentDraft;
  promptVersion: string;
  modelName: string;
  contentSha256: string;
  editReason?: string | null;
  createdBy: string;
}

export interface ProductRecord {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  positioning: string;
  brandProfile: unknown;
  deletedAt: string | null;
}
export interface ProductSourceRecord { id: string; workspaceId: string; productId: string; kind: "manual" | "dormchef_local"; locator: string }
export interface CampaignRecord { id: string; workspaceId: string; productId: string; channelId: string; name: string; goal: string; audience: string; startsOn: string; endsOn: string; pillarQuotas: unknown }
export interface ContentRecord { id: string; workspaceId: string; productId: string; campaignId: string; topicId: string; status: ContentStatus }
export interface ContentVersionRecord { id: string; workspaceId: string; productId: string; campaignId: string; contentId: string; topicId: string; briefId: string; version: number; payload: ContentDraft; status: Exclude<ContentStatus, "packaged">; contentSha256: string; editReason: string | null }
export interface AssetRecord { id: string; workspaceId: string; productId: string; contentVersionId: string | null; objectKey: string; sha256: string; verificationStatus: "candidate" | "verified" | "blocked"; publicUseAllowed: boolean }
export interface ReviewRunRecord { id: string; contentVersionId: string; runNumber: number; isCurrent: boolean; result: "passed" | "blocked" }
export interface LearningRecord { id: string; workspaceId: string; productId: string; publicationId: string; evidenceWindow: string; payload: unknown }
export interface AuditEventRecord { id: string; workspaceId: string; productId: string | null; action: string; entityType: string; entityId: string | null; payload: unknown }

export interface JobRepository {
  enqueueJob(ctx: RepositoryContext, input: { productId: string | null; kind: string; idempotencyKey: string; payload: unknown }): Promise<{ id: string; status: "queued" | "running" | "completed" | "failed" }>;
  claimNext(ctx: RepositoryContext, workerId: string, now: Date): Promise<WorkflowJob | null>;
  get(ctx: Pick<RepositoryContext, "workspaceId">, jobId: string): Promise<WorkflowJob | null>;
  heartbeat(ctx: RepositoryContext, jobId: string, workerId: string, now: Date): Promise<void>;
  complete(ctx: RepositoryContext, jobId: string, workerId: string, result: unknown, nextJob?: EnqueueJobInput): Promise<void>;
  fail(ctx: RepositoryContext, jobId: string, workerId: string, error: string, retryAt: Date | null): Promise<void>;
}

export interface ContentVersionRepository {
  create(ctx: RepositoryContext, input: NewContentVersion): Promise<ContentVersionRecord>;
  get(ctx: Pick<RepositoryContext, "workspaceId">, id: string): Promise<ContentVersionRecord | null>;
  approve(ctx: RepositoryContext, id: string): Promise<ContentVersionRecord>;
  getApproved(ctx: Pick<RepositoryContext, "workspaceId">, id: string): Promise<ContentVersionRecord | null>;
}

export interface ProductRepository {
  create(ctx: RepositoryContext, input: Pick<ProductRecord, "name" | "slug" | "positioning" | "brandProfile">): Promise<ProductRecord>;
  list(ctx: Pick<RepositoryContext, "workspaceId">): Promise<ProductRecord[]>;
  softDelete(ctx: RepositoryContext, id: string, exactName: string): Promise<ProductRecord>;
}
export interface ProductSourceRepository {
  create(ctx: RepositoryContext, input: Omit<ProductSourceRecord, "id" | "workspaceId">): Promise<ProductSourceRecord>;
  list(ctx: Pick<RepositoryContext, "workspaceId">, productId: string): Promise<ProductSourceRecord[]>;
}
export interface ProductFactRepository {
  insertCandidates(ctx: RepositoryContext, productId: string, sourceId: string, facts: ProductFactCandidate[]): Promise<void>;
  listUsable(ctx: Pick<RepositoryContext, "workspaceId">, productId: string): Promise<{ id: string; statement: string; category: string }[]>;
  decide(ctx: RepositoryContext, factId: string, decision: "verify" | "block", editedStatement?: string): Promise<void>;
}
export interface CampaignRepository {
  create(ctx: RepositoryContext, input: Omit<CampaignRecord, "id" | "workspaceId">): Promise<CampaignRecord>;
  get(ctx: Pick<RepositoryContext, "workspaceId">, id: string): Promise<CampaignRecord | null>;
  listByProduct(ctx: Pick<RepositoryContext, "workspaceId">, productId: string): Promise<CampaignRecord[]>;
}
export interface ContentRepository {
  createWithBrief(ctx: RepositoryContext, input: { productId: string; campaignId: string; topicId: string; brief: unknown; idempotencyKey: string }): Promise<ContentRecord>;
  get(ctx: Pick<RepositoryContext, "workspaceId">, id: string): Promise<ContentRecord | null>;
}
export interface TopicRepository {
  insertCandidates(ctx: RepositoryContext, campaignId: string, candidates: unknown[], idempotencyKey: string): Promise<void>;
  selectWeekly(ctx: RepositoryContext, campaignId: string, topicIds: string[]): Promise<void>;
  listByCampaign(ctx: Pick<RepositoryContext, "workspaceId">, campaignId: string): Promise<unknown[]>;
}
export interface AssetRepository {
  insertCandidates(ctx: RepositoryContext, input: Omit<AssetRecord, "id" | "workspaceId">[]): Promise<AssetRecord[]>;
  listUsable(ctx: Pick<RepositoryContext, "workspaceId">, productId: string): Promise<AssetRecord[]>;
  listGeneratedForVersion(ctx: Pick<RepositoryContext, "workspaceId">, contentVersionId: string): Promise<AssetRecord[]>;
}
export interface ReviewRepository {
  replaceCurrentRun(ctx: RepositoryContext, contentVersionId: string, findings: { code: string; severity: "blocking" | "advisory"; message: string }[]): Promise<ReviewRunRecord>;
  getCurrent(ctx: Pick<RepositoryContext, "workspaceId">, contentVersionId: string): Promise<ReviewRunRecord | null>;
}
export interface PublicationRepository {
  create(ctx: RepositoryContext, input: { contentVersionId: string; idempotencyKey: string }): Promise<Publication>;
  get(ctx: Pick<RepositoryContext, "workspaceId">, id: string): Promise<Publication | null>;
  transition(ctx: RepositoryContext, id: string, expected: Publication["status"], next: Publication["status"]): Promise<Publication>;
  claimNextForDevice(ctx: RepositoryContext, deviceId: string): Promise<Publication | null>;
  transitionClaimedForDevice(ctx: RepositoryContext, deviceId: string, id: string, expected: Publication["status"], next: Publication["status"]): Promise<Publication>;
}
export interface LearningRepository {
  create(ctx: RepositoryContext, input: Omit<LearningRecord, "id" | "workspaceId">): Promise<LearningRecord>;
  listEligible(ctx: Pick<RepositoryContext, "workspaceId">, productId: string, campaignId: string): Promise<LearningRecord[]>;
}
export interface MetricRepository {
  importSnapshots(ctx: RepositoryContext, input: { productId: string; format: "manual" | "csv" | "json"; rows: unknown[]; filenameSha256?: string }): Promise<{ importId: string; acceptedRows: number }>;
  listByPublication(ctx: Pick<RepositoryContext, "workspaceId">, publicationId: string): Promise<unknown[]>;
}
export interface PublisherDeviceRepository {
  create(ctx: RepositoryContext, name: string, tokenSha256: string): Promise<{ id: string; workspaceId: string }>;
  revoke(ctx: RepositoryContext, id: string): Promise<void>;
  resolveByTokenHash(tokenSha256: string): Promise<{ id: string; workspaceId: string } | null>;
}
export interface WaitlistRepository { upsert(email: string, source: string, rateLimitKey: string): Promise<void> }
export interface AuditRepository {
  append(ctx: RepositoryContext, input: Pick<AuditEventRecord, "productId" | "action" | "entityType" | "entityId" | "payload">): Promise<AuditEventRecord>;
  listForEntity(ctx: Pick<RepositoryContext, "workspaceId">, entityType: string, entityId: string): Promise<AuditEventRecord[]>;
}

export * from "./client.js";
export * from "./jobs.js";
export * from "./products.js";
export * from "./facts.js";
export * from "./campaigns.js";
export * from "./topics.js";
export * from "./contents.js";
export * from "./content-versions.js";
export * from "./publications.js";
export * from "./assets.js";
export * from "./reviews.js";
export * from "./learnings.js";
export * from "./metrics.js";
export * from "./publisher-devices.js";
export * from "./waitlist.js";
export * from "./audit.js";
