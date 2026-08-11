import type {
  ProductAdapter,
  ProductAssetCandidate,
  ProductConnection,
  ProductFactCandidate,
  ProductSourceDescriptor,
} from "@social-agent/contracts";
import { prepareFactCandidates } from "./facts.js";

export class ManualProductAdapter implements ProductAdapter {
  readonly kind = "manual";

  constructor(private readonly candidates: readonly ProductFactCandidate[] = []) {}

  async discoverSources(connection: ProductConnection): Promise<ProductSourceDescriptor[]> {
    if (connection.kind !== "manual") throw new Error("PRODUCT_CONNECTION_KIND_UNSUPPORTED");
    return [{ id: connection.id, kind: connection.kind, relativeLocator: "manual/operator-note" }];
  }

  async extractFacts(source: ProductSourceDescriptor): Promise<ProductFactCandidate[]> {
    if (source.kind !== "manual") throw new Error("PRODUCT_SOURCE_KIND_UNSUPPORTED");
    return prepareFactCandidates(this.candidates);
  }

  async collectAssets(source: ProductSourceDescriptor): Promise<ProductAssetCandidate[]> {
    if (source.kind !== "manual") throw new Error("PRODUCT_SOURCE_KIND_UNSUPPORTED");
    return [];
  }
}
