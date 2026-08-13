import type { EnqueueJobInput, JobRepository, RepositoryContext, WorkflowJob } from "./index.js";
import { auditInput, databaseError, mapJob, type DatabaseClient } from "./client.js";

export class SupabaseJobRepository implements JobRepository {
  constructor(private readonly db: DatabaseClient, private readonly staleAfterMs = 5 * 60_000) {}

  async enqueueJob(ctx: RepositoryContext, input: { productId: string | null; kind: string; idempotencyKey: string; payload: unknown }) {
    if (input.productId === null) throw new Error("PRODUCT_SCOPE_REQUIRED");
    const { data, error } = await this.db
      .from("workflow_jobs")
      .insert({
        workspace_id: ctx.workspaceId,
        product_id: input.productId,
        kind: input.kind,
        idempotency_key: input.idempotencyKey,
        payload: input.payload,
        status: "queued",
      })
      .select("id,status")
      .single();
    if (!error && data) return data as { id: string; status: "queued" | "running" | "completed" | "failed" };
    if (error?.code !== "23505") throw databaseError(error);

    const existing = await this.db
      .from("workflow_jobs")
      .select("id,status")
      .eq("workspace_id", ctx.workspaceId)
      .eq("idempotency_key", input.idempotencyKey)
      .single();
    if (existing.error || !existing.data) throw databaseError(existing.error);
    return existing.data as { id: string; status: "queued" | "running" | "completed" | "failed" };
  }

  async claimNext(ctx: RepositoryContext, workerId: string, _now: Date): Promise<WorkflowJob | null> {
    const { data: databaseNow, error: nowError } = await this.db.rpc("database_time");
    if (nowError) throw databaseError(nowError);
    const now = new Date(databaseNow as string);
    const { data, error } = await this.db.rpc("claim_workflow_job", {
      p_workspace_id: ctx.workspaceId,
      p_worker_id: workerId,
      p_now: now.toISOString(),
      p_stale_before: new Date(now.getTime() - this.staleAfterMs).toISOString(),
    });
    if (error) throw databaseError(error);
    const row = (data as Record<string, any>[] | null)?.[0];
    return row ? mapJob(row) as WorkflowJob : null;
  }

  async get(ctx: Pick<RepositoryContext, "workspaceId">, jobId: string): Promise<WorkflowJob | null> {
    const { data, error } = await this.db
      .from("workflow_jobs")
      .select("*")
      .eq("workspace_id", ctx.workspaceId)
      .eq("id", jobId)
      .maybeSingle();
    if (error) throw databaseError(error);
    return data ? mapJob(data as Record<string, any>) as WorkflowJob : null;
  }

  async heartbeat(ctx: RepositoryContext, jobId: string, workerId: string, _now: Date): Promise<void> {
    const { data: databaseNow, error: nowError } = await this.db.rpc("database_time");
    if (nowError) throw databaseError(nowError);
    const { data, error } = await this.db.rpc("heartbeat_workflow_job", {
      p_workspace_id: ctx.workspaceId,
      p_job_id: jobId,
      p_worker_id: workerId,
      p_now: databaseNow,
    });
    if (error) throw databaseError(error);
    if (data !== true) throw new Error("LEASE_LOST");
  }

  async complete(ctx: RepositoryContext, jobId: string, workerId: string, result: unknown, nextJob?: EnqueueJobInput): Promise<void> {
    const { data, error } = await this.db.rpc("finish_workflow_job", {
      p_workspace_id: ctx.workspaceId,
      p_job_id: jobId,
      p_worker_id: workerId,
      p_result: result,
      p_audit_event: auditInput(ctx, {
        action: "workflow_job.completed",
        entityType: "workflow_job",
        entityId: jobId,
        payload: { result },
      }),
      p_next_job: nextJob ? {
        product_id: nextJob.productId,
        kind: nextJob.kind,
        idempotency_key: nextJob.idempotencyKey,
        payload: nextJob.payload,
      } : null,
    });
    if (error) throw databaseError(error);
    if (data !== true) throw new Error("LEASE_LOST");
  }

  async fail(ctx: RepositoryContext, jobId: string, workerId: string, errorMessage: string, retryAt: Date | null): Promise<void> {
    const functionName = retryAt ? "fail_workflow_job" : "terminalize_workflow_job";
    const { data, error } = await this.db.rpc(functionName, {
      p_workspace_id: ctx.workspaceId,
      p_job_id: jobId,
      p_worker_id: workerId,
      p_error: errorMessage,
      p_audit_event: auditInput(ctx, {
        action: retryAt ? "workflow_job.requeued" : "workflow_job.failed",
        entityType: "workflow_job",
        entityId: jobId,
        payload: { error: errorMessage },
      }),
      ...(retryAt ? { p_retry_at: retryAt.toISOString() } : {}),
    });
    if (error) throw databaseError(error);
    if (data !== true) throw new Error("LEASE_LOST");
  }
}
