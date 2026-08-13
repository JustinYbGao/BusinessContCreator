import {
  auditInput,
  databaseError,
  type DatabaseClient,
  type EnqueueJobInput,
} from "@social-agent/db";
import type { AssetStoragePort } from "@social-agent/visual-engine";
import type { JobExecution, WorkflowCommitInput, WorkflowCommitter } from "./runner.js";

type RecordValue = Record<string, unknown>;

export type WorkflowCommitterOptions = {
  storage?: AssetStoragePort;
};

function recordValue(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : {};
}

function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(code);
  return value;
}

function nextJobValue(input: EnqueueJobInput | undefined): RecordValue | null {
  if (!input) return null;
  return {
    product_id: input.productId,
    kind: input.kind,
    idempotency_key: input.idempotencyKey,
    payload: input.payload,
  };
}

function workflowAudit(input: WorkflowCommitInput) {
  return auditInput(input.ctx, {
    productId: input.job.productId,
    action: "workflow_job.completed",
    entityType: "workflow_job",
    entityId: input.job.id,
    payload: {
      kind: input.job.kind,
      result: input.execution.result,
    },
  });
}

function contentInputForCommit(execution: JobExecution, actorId: string, productId: string): RecordValue {
  const payload = recordValue(execution.commitPayload);
  const rawInput = recordValue(payload.contentInput);
  const input: RecordValue = rawInput.product_id !== undefined
    ? { ...rawInput }
    : {
        product_id: productId,
        campaign_id: rawInput.campaignId,
        content_id: rawInput.contentId,
        topic_id: rawInput.topicId,
        brief_id: rawInput.briefId,
      };
  const generated = recordValue(payload.generated);

  if (input.payload === undefined && generated.draft !== undefined) input.payload = generated.draft;
  if (input.prompt_version === undefined && generated.promptVersion !== undefined) {
    input.prompt_version = generated.promptVersion;
  }
  if (input.model_name === undefined && generated.model !== undefined) input.model_name = generated.model;
  if (input.content_sha256 === undefined && generated.contentSha256 !== undefined) {
    input.content_sha256 = generated.contentSha256;
  }
  if (input.created_by === undefined) input.created_by = actorId;
  return input;
}

function assetsForCommit(execution: JobExecution): RecordValue[] {
  const payload = recordValue(execution.commitPayload);
  const assets = Array.isArray(payload.assets) ? payload.assets : [];
  return assets.map((asset) => {
    const value = recordValue(asset);
    return {
      object_key: value.objectKey,
      mime_type: value.mimeType,
      byte_size: value.byteSize,
      width: value.width,
      height: value.height,
      sha256: value.sha256,
    };
  });
}

async function callRpc(
  db: DatabaseClient,
  name: string,
  args: RecordValue,
): Promise<void> {
  let response: Awaited<ReturnType<DatabaseClient["rpc"]>>;
  try {
    response = await db.rpc(name, args);
  } catch (error) {
    const transportError = new Error("DATABASE_TRANSPORT_ERROR", { cause: error });
    Object.assign(transportError, { code: "DATABASE_TRANSPORT_ERROR" });
    throw transportError;
  }
  const { error } = response;
  if (error) throw databaseError(error);
}

async function renderAssetsCommitted(
  db: DatabaseClient,
  input: WorkflowCommitInput,
  assets: RecordValue[],
): Promise<boolean> {
  const payload = recordValue(input.execution.commitPayload);
  const contentVersionId = requiredString(payload.contentVersionId, "CONTENT_VERSION_REQUIRED");
  const objectKeys = assets
    .map((asset) => asset.object_key)
    .filter((key): key is string => typeof key === "string");
  if (objectKeys.length !== assets.length) return false;
  const { data, error } = await db.from("assets")
    .select("object_key")
    .eq("workspace_id", input.ctx.workspaceId)
    .eq("product_id", input.job.productId)
    .eq("content_version_id", contentVersionId)
    .eq("provenance", "generated")
    .in("object_key", objectKeys);
  if (error) throw databaseError(error);
  const committed = new Set((data ?? []).map((row) => row.object_key));
  return objectKeys.every((key) => committed.has(key));
}

async function cleanupUncommittedRenderAssets(
  db: DatabaseClient,
  storage: AssetStoragePort,
  input: WorkflowCommitInput,
  assets: RecordValue[],
): Promise<void> {
  const payload = recordValue(input.execution.commitPayload);
  const uploadAttemptId = payload.uploadAttemptId;
  if (typeof uploadAttemptId !== "string" || uploadAttemptId.length === 0) return;
  if (await renderAssetsCommitted(db, input, assets)) return;
  const objectKeys = assets
    .map((asset) => asset.object_key)
    .filter((key): key is string => typeof key === "string");
  await storage.removeOwned(objectKeys, uploadAttemptId);
}

export function createSupabaseWorkflowCommitter(
  db: DatabaseClient,
  options: WorkflowCommitterOptions = {},
): WorkflowCommitter {
  return {
    async commit(input) {
      const common = {
        p_workspace_id: input.ctx.workspaceId,
        p_job_id: input.job.id,
        p_worker_id: input.workerId,
        p_result: input.execution.result,
        p_audit_event: workflowAudit(input),
        p_next_job: nextJobValue(input.execution.nextJob),
      } satisfies RecordValue;

      switch (input.job.kind) {
        case "sync_product": {
          await callRpc(db, "commit_sync_product_job", {
            p_workspace_id: common.p_workspace_id,
            p_job_id: common.p_job_id,
            p_worker_id: common.p_worker_id,
            p_output: input.execution.commitPayload ?? {},
            p_result: common.p_result,
            p_audit_event: common.p_audit_event,
            p_next_job: common.p_next_job,
          });
          return;
        }
        case "generate_topics": {
          const payload = recordValue(input.execution.commitPayload);
          await callRpc(db, "commit_generate_topics_job", {
            p_workspace_id: common.p_workspace_id,
            p_job_id: common.p_job_id,
            p_worker_id: common.p_worker_id,
            p_campaign_id: requiredString(payload.campaignId, "CAMPAIGN_REQUIRED"),
            p_candidates: Array.isArray(payload.candidates) ? payload.candidates : [],
            p_result: common.p_result,
            p_audit_event: common.p_audit_event,
            p_next_job: common.p_next_job,
          });
          return;
        }
        case "generate_content": {
          await callRpc(db, "commit_generate_content_job", {
            p_workspace_id: common.p_workspace_id,
            p_job_id: common.p_job_id,
            p_worker_id: common.p_worker_id,
            p_content_input: contentInputForCommit(input.execution, input.ctx.actor.id, input.job.productId!),
            p_result: common.p_result,
            p_audit_event: common.p_audit_event,
            p_next_job: common.p_next_job,
          });
          return;
        }
        case "review_content": {
          const payload = recordValue(input.execution.commitPayload);
          await callRpc(db, "commit_review_content_job", {
            p_workspace_id: common.p_workspace_id,
            p_job_id: common.p_job_id,
            p_worker_id: common.p_worker_id,
            p_content_version_id: requiredString(payload.contentVersionId, "CONTENT_VERSION_REQUIRED"),
            p_review_context: payload.reviewContext ?? null,
            p_findings: Array.isArray(payload.findings) ? payload.findings : [],
            p_result: common.p_result,
            p_audit_event: common.p_audit_event,
            p_next_job: common.p_next_job,
          });
          return;
        }
        case "render_assets": {
          const payload = recordValue(input.execution.commitPayload);
          const assets = assetsForCommit(input.execution);
          try {
            await callRpc(db, "commit_render_assets_job", {
              p_workspace_id: common.p_workspace_id,
              p_job_id: common.p_job_id,
              p_worker_id: common.p_worker_id,
              p_content_version_id: requiredString(payload.contentVersionId, "CONTENT_VERSION_REQUIRED"),
              p_assets: assets,
              p_result: common.p_result,
              p_audit_event: common.p_audit_event,
              p_next_job: common.p_next_job,
            });
          } catch (error) {
            if (options.storage) {
              try {
                await cleanupUncommittedRenderAssets(db, options.storage, input, assets);
              } catch (cleanupError) {
                throw new AggregateError([error, cleanupError], "VISUAL_ASSET_COMMIT_UNRESOLVED");
              }
            }
            throw error;
          }
          return;
        }
        case "purge_product":
        default:
          await callRpc(db, "finish_workflow_job", common);
      }
    },
  };
}
