import { createHash } from "node:crypto";
import type {
  ProductAdapter,
  ProductAssetCandidate,
  ProductConnection,
  ProductFactCandidate,
  ProductSourceDescriptor,
} from "@social-agent/contracts";
import {
  collectAssetForSource,
  discoverAllowedDormChefPaths,
  readFactsForSource,
  type DormChefReadOptions,
} from "./extract.js";

export type DormChefLocalAdapterContract = ProductAdapter;

export type DormChefSyncResult = {
  facts: ProductFactCandidate[];
  assets: ProductAssetCandidate[];
};

export type DormChefLocalAdapterOptions = DormChefReadOptions;

function deterministicUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function requireDormChefConnection(connection: ProductConnection): void {
  if (connection.kind !== "dormchef_local") throw new Error("PRODUCT_CONNECTION_KIND_UNSUPPORTED");
}

export class DormChefLocalAdapter implements ProductAdapter {
  readonly kind = "dormchef_local";

  constructor(
    private readonly sourceRoot: string,
    private readonly options: DormChefLocalAdapterOptions = {},
  ) {}

  async discoverSources(connection: ProductConnection): Promise<ProductSourceDescriptor[]> {
    requireDormChefConnection(connection);
    const paths = await discoverAllowedDormChefPaths(this.sourceRoot, this.options);
    return paths.map((relativeLocator) => ({
      id: deterministicUuid(`${connection.id}:${relativeLocator}`),
      kind: connection.kind,
      relativeLocator,
    }));
  }

  async extractFacts(source: ProductSourceDescriptor): Promise<ProductFactCandidate[]> {
    if (source.kind !== "dormchef_local") throw new Error("PRODUCT_SOURCE_KIND_UNSUPPORTED");
    return readFactsForSource(this.sourceRoot, source, this.options);
  }

  async collectAssets(source: ProductSourceDescriptor): Promise<ProductAssetCandidate[]> {
    if (source.kind !== "dormchef_local") throw new Error("PRODUCT_SOURCE_KIND_UNSUPPORTED");
    return collectAssetForSource(this.sourceRoot, source, this.options);
  }

  async sync(connection: ProductConnection): Promise<DormChefSyncResult> {
    const sources = await this.discoverSources(connection);
    const facts: ProductFactCandidate[] = [];
    const assets: ProductAssetCandidate[] = [];
    for (const source of sources) {
      facts.push(...await this.extractFacts(source));
      assets.push(...await this.collectAssets(source));
    }
    return { facts, assets };
  }
}

export * from "./allowed-paths.js";
export * from "./extract.js";
