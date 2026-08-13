import type {
  ProductAdapter,
  ProductAssetCandidate,
  ProductFactCandidate,
  ProductSourceDescriptor,
} from "@social-agent/contracts";
import type { WorkerHandler } from "../runner.js";

export type SyncAssetRecord = {
  kind: ProductAssetCandidate["kind"];
  source_locator: string;
  object_key: string;
  mime_type: "image/png" | "image/jpeg" | "image/webp";
  byte_size: number;
  width: number;
  height: number;
  sha256: string;
  verification_status: "candidate";
  public_use_allowed: false;
};

export type SyncProductDependencies = {
  prepareAsset?: (input: {
    productId: string;
    source: ProductSourceDescriptor;
    candidate: ProductAssetCandidate;
  }) => Promise<SyncAssetRecord>;
};

function recordPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function connectionKind(value: unknown, fallback: string): "manual" | "dormchef_local" {
  if (value === "manual" || value === "dormchef_local") return value;
  if (fallback === "manual" || fallback === "dormchef_local") return fallback;
  throw new Error("PRODUCT_CONNECTION_KIND_UNSUPPORTED");
}

export function createSyncProductHandler(
  adapter: ProductAdapter,
  dependencies: SyncProductDependencies = {},
): WorkerHandler {
  return async ({ ctx, job, signal }) => {
    if (signal.aborted) throw new Error("LEASE_LOST");
    if (!job.productId) throw new Error("PRODUCT_SCOPE_REQUIRED");
    const payload = recordPayload(job.payload);
    const connection = {
      id: job.productId,
      kind: connectionKind(payload.connectionKind, adapter.kind),
    } as const;
    const sources = await adapter.discoverSources(connection);
    const facts: Array<Record<string, unknown>> = [];
    const assets: SyncAssetRecord[] = [];

    for (const source of sources) {
      if (signal.aborted) throw new Error("LEASE_LOST");
      const sourceFacts: ProductFactCandidate[] = await adapter.extractFacts(source);
      facts.push(...sourceFacts.map((fact) => ({
        source_id: source.id,
        statement: fact.statement,
        category: fact.category,
        source_locator: fact.sourceLocator,
        evidence_excerpt: fact.evidenceExcerpt,
        status: "candidate",
        public_use_allowed: false,
      })));
      const sourceAssets = await adapter.collectAssets(source);
      for (const candidate of sourceAssets) {
        if (!dependencies.prepareAsset) throw new Error("SOURCE_ASSET_METADATA_REQUIRED");
        assets.push(await dependencies.prepareAsset({ productId: job.productId, source, candidate }));
      }
    }

    return {
      result: {
        productId: job.productId,
        sourceCount: sources.length,
        factCount: facts.length,
        assetCount: assets.length,
      },
      commitPayload: {
        sources: sources.map((source) => ({ id: source.id, kind: source.kind, locator: source.relativeLocator })),
        facts,
        assets,
      },
    };
  };
}
