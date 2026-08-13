import type {
  EnqueueJobInput,
  JobRepository,
  RepositoryContext,
  WorkflowJob,
} from "@social-agent/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WorkerRunner,
  createWorkerId,
  type JobExecution,
  type WorkerHandler,
  type WorkerRunnerOptions,
} from "./runner.js";

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "00000000-0000-4000-8000-000000000002";
const FIXED_NOW = new Date("2026-08-13T00:00:00.000Z");

type FailCall = {
  jobId: string;
  workerId: string;
  error: string;
  retryAt: Date | null;
};

class FakeJobRepository implements JobRepository {
  readonly jobs: WorkflowJob[] = [];
  readonly completed: Array<{
    jobId: string;
    workerId: string;
    result: unknown;
    nextJob?: EnqueueJobInput;
  }> = [];
  readonly failed: FailCall[] = [];
  readonly heartbeats: string[] = [];
  workerIdOnClaim: string | null = null;
  loseLeaseOnHeartbeat = false;

  async enqueueJob(
    _ctx: RepositoryContext,
    _input: { productId: string | null; kind: string; idempotencyKey: string; payload: unknown },
  ) {
    return { id: "next-job", status: "queued" as const };
  }

  async claimNext(
    _ctx: RepositoryContext,
    workerId: string,
    _now: Date,
  ): Promise<WorkflowJob | null> {
    this.workerIdOnClaim = workerId;
    const job = this.jobs.shift();
    return job ? { ...job, status: "running", lockedBy: workerId } : null;
  }

  async get(_ctx: Pick<RepositoryContext, "workspaceId">, jobId: string) {
    return this.jobs.find((job) => job.id === jobId) ?? null;
  }

  async heartbeat(
    _ctx: RepositoryContext,
    jobId: string,
    _workerId: string,
    _now: Date,
  ): Promise<void> {
    this.heartbeats.push(jobId);
    if (this.loseLeaseOnHeartbeat) throw new Error("LEASE_LOST");
  }

  async complete(
    _ctx: RepositoryContext,
    jobId: string,
    workerId: string,
    result: unknown,
    nextJob?: EnqueueJobInput,
  ): Promise<void> {
    this.completed.push(nextJob
      ? { jobId, workerId, result, nextJob }
      : { jobId, workerId, result });
  }

  async fail(
    _ctx: RepositoryContext,
    jobId: string,
    workerId: string,
    error: string,
    retryAt: Date | null,
  ): Promise<void> {
    this.failed.push({ jobId, workerId, error, retryAt });
  }
}

function job(kind: WorkflowJob["kind"] = "sync_product"): WorkflowJob {
  return {
    id: "00000000-0000-4000-8000-000000000003",
    workspaceId: WORKSPACE_ID,
    productId: PRODUCT_ID,
    kind,
    payload: {},
    status: "queued",
    attempts: 1,
    maxAttempts: 3,
    lockedBy: null,
  };
}

function handlerFor(
  implementation: WorkerHandler,
): Partial<Record<WorkflowJob["kind"], WorkerHandler>> {
  return { sync_product: implementation };
}

function createRunner(
  repository: FakeJobRepository,
  handlers: Partial<Record<WorkflowJob["kind"], WorkerHandler>>,
  options: Partial<Omit<WorkerRunnerOptions, "workspaceId" | "jobs" | "handlers">> = {},
) {
  return new WorkerRunner({
    workspaceId: WORKSPACE_ID,
    jobs: repository,
    handlers,
    workerId: "worker-test",
    now: () => new Date(FIXED_NOW),
    leaseTtlMs: 90,
    retryBaseMs: 100,
    retryJitterMs: 25,
    ...options,
  });
}

describe("persistent worker runner", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("claims a stale job through the repository and completes it with the new worker id", async () => {
    const repository = new FakeJobRepository();
    repository.jobs.push(job());
    const seen: string[] = [];
    const runner = createRunner(repository, handlerFor(async ({ workerId }) => {
      seen.push(workerId);
      return { result: { ok: true } };
    }));

    const result = await runner.runOnce();

    expect(result).toMatchObject({ status: "completed", jobId: job().id });
    expect(repository.workerIdOnClaim).toBe("worker-test");
    expect(seen).toEqual(["worker-test"]);
    expect(repository.completed).toHaveLength(1);
  });

  it("routes the second invalid model output to terminal human handling", async () => {
    const repository = new FakeJobRepository();
    repository.jobs.push(job("generate_content"));
    const runner = createRunner(repository, {
      generate_content: async () => {
        throw new Error("HUMAN_MODEL_OUTPUT_REQUIRED");
      },
    });

    const result = await runner.runOnce();

    expect(result).toMatchObject({ status: "failed", code: "HUMAN_MODEL_OUTPUT_REQUIRED" });
    expect(repository.failed).toEqual([{
      jobId: job("generate_content").id,
      workerId: "worker-test",
      error: "HUMAN_MODEL_OUTPUT_REQUIRED",
      retryAt: null,
    }]);
  });

  it("requeues only a retryable model transport failure with deterministic backoff", async () => {
    const repository = new FakeJobRepository();
    const testJob = { ...job("generate_content"), id: "job-two" };
    repository.jobs.push(testJob);
    const handler: WorkerHandler = async () => {
      const error = new Error("MODEL_TRANSPORT_ERROR");
      Object.assign(error, { code: "MODEL_TRANSPORT_ERROR" });
      throw error;
    };
    const runner = createRunner(repository, { generate_content: handler });

    const first = await runner.runOnce();
    const retryAt = repository.failed[0]?.retryAt;
    const secondRepository = new FakeJobRepository();
    secondRepository.jobs.push(testJob);
    const secondRunner = createRunner(secondRepository, { generate_content: handler });
    await secondRunner.runOnce();

    expect(first.status).toBe("requeued");
    expect(retryAt).not.toBeNull();
    expect(retryAt!.getTime()).toBeGreaterThan(FIXED_NOW.getTime());
    expect(secondRepository.failed[0]?.retryAt?.getTime()).toBe(
      retryAt!.getTime(),
    );
  });

  it("passes a deterministic next job to the atomic completion boundary", async () => {
    const repository = new FakeJobRepository();
    repository.jobs.push(job());
    const nextJob: EnqueueJobInput = {
      productId: PRODUCT_ID,
      kind: "generate_topics",
      idempotencyKey: `topics:${PRODUCT_ID}:v1`,
      payload: { productId: PRODUCT_ID },
    };
    const runner = createRunner(repository, handlerFor(async (): Promise<JobExecution> => ({
      result: { sourceCount: 3 },
      nextJob,
    })));

    await runner.runOnce();

    expect(repository.completed[0]?.nextJob).toEqual(nextJob);
  });

  it("uses the handler-specific commit boundary for domain output", async () => {
    const repository = new FakeJobRepository();
    repository.jobs.push(job());
    const committed: unknown[] = [];
    const runner = createRunner(repository, handlerFor(async (): Promise<JobExecution> => ({
      result: { summary: "small" },
      commitPayload: { sources: [], facts: [], assets: [] },
    })), {
      committer: {
        async commit(input) {
          committed.push(input.execution.commitPayload);
        },
      },
    });

    await runner.runOnce();

    expect(committed).toEqual([{ sources: [], facts: [], assets: [] }]);
    expect(repository.completed).toHaveLength(0);
  });

  it("aborts a handler and skips completion when the lease is lost", async () => {
    vi.useFakeTimers();
    const repository = new FakeJobRepository();
    repository.jobs.push(job());
    repository.loseLeaseOnHeartbeat = true;
    let aborted = false;
    const runner = createRunner(repository, handlerFor(({ signal }) => new Promise<JobExecution>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        aborted = true;
        reject(new Error("HANDLER_ABORTED"));
      }, { once: true });
    })));

    const pending = runner.runOnce();
    await vi.advanceTimersByTimeAsync(30);
    const result = await pending;

    expect(result.status).toBe("lease_lost");
    expect(aborted).toBe(true);
    expect(repository.completed).toHaveLength(0);
    expect(repository.failed).toHaveLength(0);
    expect(repository.heartbeats).toEqual([job().id]);
  });

  it("fails unknown job kinds closed without dispatching them", async () => {
    const repository = new FakeJobRepository();
    repository.jobs.push({ ...job(), kind: "unknown" as WorkflowJob["kind"] });
    const runner = createRunner(repository, {});

    const result = await runner.runOnce();

    expect(result).toMatchObject({ status: "failed", code: "UNKNOWN_JOB_KIND" });
    expect(repository.failed[0]?.retryAt).toBeNull();
  });

  it("creates unique process worker ids", () => {
    expect(createWorkerId()).not.toBe(createWorkerId());
  });
});
