import { createHash, randomUUID } from "node:crypto";
import type {
  EnqueueJobInput,
  JobRepository,
  RepositoryContext,
  WorkflowJob,
} from "@social-agent/db";

export type WorkerRunStatus = "idle" | "completed" | "requeued" | "failed" | "lease_lost";

export type WorkerRunResult = {
  status: WorkerRunStatus;
  jobId?: string;
  code?: string;
  retryAt?: Date | null;
  result?: unknown;
};

export type JobExecution = {
  result: unknown;
  commitPayload?: unknown;
  nextJob?: EnqueueJobInput;
};

export type WorkerHandlerInput = {
  ctx: RepositoryContext;
  job: WorkflowJob;
  workerId: string;
  signal: AbortSignal;
};

export type WorkerHandler = (input: WorkerHandlerInput) => Promise<JobExecution>;

export type WorkerLogger = {
  info(event: string, fields: Record<string, unknown>): void;
  error(event: string, fields: Record<string, unknown>): void;
};

export type WorkflowCommitInput = {
  ctx: RepositoryContext;
  job: WorkflowJob;
  workerId: string;
  execution: JobExecution;
};

export type WorkflowCommitter = {
  commit(input: WorkflowCommitInput): Promise<void>;
};

export type RetryPolicy = {
  baseMs: number;
  maxMs: number;
  jitterMs: number;
};

export type WorkerRunnerOptions = {
  workspaceId: string;
  jobs: JobRepository;
  handlers: Partial<Record<WorkflowJob["kind"], WorkerHandler>>;
  workerId?: string;
  now?: () => Date;
  leaseTtlMs?: number;
  pollIntervalMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  retryJitterMs?: number;
  logger?: WorkerLogger;
  committer?: WorkflowCommitter;
};

const noopLogger: WorkerLogger = {
  info: () => undefined,
  error: () => undefined,
};

const RETRYABLE_CODES = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "UND_ERR_CONNECT_TIMEOUT",
  "NETWORK_TIMEOUT",
  "MODEL_TRANSPORT_ERROR",
  "DATABASE_TRANSPORT_ERROR",
]);

function errorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.trim()) return code;
  }
  if (error instanceof Error && error.message.trim()) return error.message.split("\n", 1)[0]!;
  return "WORKER_HANDLER_FAILED";
}

function isLeaseLost(error: unknown): boolean {
  return errorCode(error) === "LEASE_LOST";
}

export function isRetryableWorkerError(error: unknown): boolean {
  if (isLeaseLost(error)) return false;
  if (error instanceof Error && error.name === "TimeoutError") return true;
  return RETRYABLE_CODES.has(errorCode(error));
}

export function createWorkerId(prefix = "worker"): string {
  return `${prefix}-${randomUUID()}`;
}

function deterministicJitter(job: WorkflowJob, policy: RetryPolicy): number {
  if (policy.jitterMs <= 0) return 0;
  const digest = createHash("sha256").update(`${job.id}:${job.attempts}`).digest();
  return digest.readUInt32BE(0) % (policy.jitterMs + 1);
}

export function computeRetryAt(
  job: WorkflowJob,
  now: Date,
  policy: RetryPolicy,
): Date {
  const exponent = Math.max(0, job.attempts - 1);
  const exponential = Math.min(policy.maxMs, policy.baseMs * (2 ** exponent));
  return new Date(now.getTime() + exponential + deterministicJitter(job, policy));
}

function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export class WorkerRunner {
  readonly workerId: string;
  readonly workspaceId: string;
  readonly leaseTtlMs: number;
  private readonly now: () => Date;
  private readonly pollIntervalMs: number;
  private readonly retryPolicy: RetryPolicy;
  private readonly logger: WorkerLogger;
  private readonly committer: WorkflowCommitter | undefined;
  private readonly jobs: JobRepository;
  private readonly handlers: Partial<Record<WorkflowJob["kind"], WorkerHandler>>;

  constructor(options: WorkerRunnerOptions) {
    this.workerId = options.workerId ?? createWorkerId();
    this.workspaceId = options.workspaceId;
    this.leaseTtlMs = options.leaseTtlMs ?? 5 * 60_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.retryPolicy = {
      baseMs: options.retryBaseMs ?? 1_000,
      maxMs: options.retryMaxMs ?? 5 * 60_000,
      jitterMs: options.retryJitterMs ?? 250,
    };
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? noopLogger;
    this.committer = options.committer;
    this.jobs = options.jobs;
    this.handlers = options.handlers;
  }

  private context(jobId?: string): RepositoryContext {
    return {
      workspaceId: this.workspaceId,
      actor: { type: "worker", id: this.workerId },
      requestId: jobId ? `worker:${this.workerId}:${jobId}:${randomUUID()}` : `worker:${this.workerId}:${randomUUID()}`,
    };
  }

  private logInfo(event: string, job: WorkflowJob, extra: Record<string, unknown> = {}): void {
    this.logger.info(event, {
      workerId: this.workerId,
      workspaceId: job.workspaceId,
      productId: job.productId,
      jobId: job.id,
      jobKind: job.kind,
      ...extra,
    });
  }

  private logError(event: string, job: WorkflowJob, error: unknown): void {
    this.logger.error(event, {
      workerId: this.workerId,
      workspaceId: job.workspaceId,
      productId: job.productId,
      jobId: job.id,
      jobKind: job.kind,
      error: errorCode(error),
    });
  }

  async runOnce(): Promise<WorkerRunResult> {
    const claimContext = this.context();
    const job = await this.jobs.claimNext(claimContext, this.workerId, this.now());
    if (!job) return { status: "idle" };

    const ctx = this.context(job.id);
    const controller = new AbortController();
    let leaseLost = false;
    const heartbeatMs = Math.max(1, Math.floor(this.leaseTtlMs / 3));
    const heartbeat = setInterval(() => {
      void this.jobs.heartbeat(ctx, job.id, this.workerId, this.now()).catch((error: unknown) => {
        leaseLost = true;
        controller.abort(error);
        this.logError("workflow_job.lease_lost", job, error);
      });
    }, heartbeatMs);
    heartbeat.unref?.();

    this.logInfo("workflow_job.started", job);
    try {
      const handler = this.handlers[job.kind];
      if (!handler) throw new Error("UNKNOWN_JOB_KIND");
      const execution = await handler({
        ctx,
        job,
        workerId: this.workerId,
        signal: controller.signal,
      });
      if (leaseLost || controller.signal.aborted) throw new Error("LEASE_LOST");

      if (this.committer) {
        await this.committer.commit({ ctx, job, workerId: this.workerId, execution });
      } else {
        await this.jobs.complete(ctx, job.id, this.workerId, execution.result, execution.nextJob);
      }
      this.logInfo("workflow_job.completed", job);
      return { status: "completed", jobId: job.id, result: execution.result };
    } catch (error) {
      if (leaseLost || isLeaseLost(error)) {
        this.logError("workflow_job.completion_skipped", job, error);
        return { status: "lease_lost", jobId: job.id, code: "LEASE_LOST" };
      }

      const code = errorCode(error);
      const retryAt = isRetryableWorkerError(error) && job.attempts < job.maxAttempts
        ? computeRetryAt(job, this.now(), this.retryPolicy)
        : null;
      try {
        await this.jobs.fail(ctx, job.id, this.workerId, code, retryAt);
      } catch (failureError) {
        if (isLeaseLost(failureError)) {
          this.logError("workflow_job.failure_skipped", job, failureError);
          return { status: "lease_lost", jobId: job.id, code: "LEASE_LOST" };
        }
        throw failureError;
      }
      this.logError(retryAt ? "workflow_job.requeued" : "workflow_job.failed", job, error);
      return { status: retryAt ? "requeued" : "failed", jobId: job.id, code, retryAt };
    } finally {
      clearInterval(heartbeat);
    }
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const result = await this.runOnce();
      if (result.status === "idle") await waitFor(this.pollIntervalMs, signal);
    }
  }
}
