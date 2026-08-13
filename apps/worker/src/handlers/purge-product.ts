import type { WorkerHandler } from "../runner.js";

export type PurgeProductInput = {
  workspaceId: string;
  productId: string;
  confirmationAuditId: string;
  actorId: string;
  requestId: string;
};

export type PurgeProductResult = {
  rowsDeleted: number;
  objectsDeleted: number;
};

export type PurgeProductPort = {
  purge(input: PurgeProductInput): Promise<PurgeProductResult>;
};

function recordPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function createPurgeProductHandler(port: PurgeProductPort): WorkerHandler {
  return async ({ ctx, job, signal }) => {
    if (signal.aborted) throw new Error("LEASE_LOST");
    if (!job.productId) throw new Error("PRODUCT_SCOPE_REQUIRED");
    const payload = recordPayload(job.payload);
    const confirmationAuditId = payload.confirmationAuditId;
    if (typeof confirmationAuditId !== "string" || !confirmationAuditId.trim()) {
      throw new Error("PURGE_CONFIRMATION_REQUIRED");
    }

    const result = await port.purge({
      workspaceId: ctx.workspaceId,
      productId: job.productId,
      confirmationAuditId,
      actorId: ctx.actor.id,
      requestId: ctx.requestId,
    });
    return {
      result: {
        productId: job.productId,
        purgeAuditId: confirmationAuditId,
        ...result,
      },
    };
  };
}
