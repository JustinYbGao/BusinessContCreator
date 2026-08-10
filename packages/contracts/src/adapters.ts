import type { ContentDraft, MetricSnapshotInput, PublicationPackage } from "./content.js";
import type { ContentStatus, PublicationStatus } from "./workflow.js";

export interface ProductConnection {
  id: string;
  kind: "manual" | "dormchef_local";
}

export interface ProductSourceDescriptor {
  id: string;
  kind: ProductConnection["kind"];
  relativeLocator: string;
}

export interface ProductFactCandidate {
  statement: string;
  category: "positioning" | "feature" | "constraint" | "data" | "price" | "status";
  sourceLocator: string;
  evidenceExcerpt: string;
}

export interface ProductAssetCandidate {
  relativeLocator: string;
  kind: "screenshot" | "brand_asset";
  sha256: string;
}

export interface ContentVersion {
  id: string;
  workspaceId: string;
  productId: string;
  status: ContentStatus;
  payload: ContentDraft;
  contentSha256: string;
}

export interface ReviewFinding {
  code: string;
  severity: "blocking" | "advisory";
  message: string;
}

export type ApprovedContent = ContentVersion & { status: "approved" };

export interface Publication {
  id: string;
  workspaceId: string;
  productId: string;
  status: PublicationStatus;
  package: PublicationPackage;
}

export interface MetricSnapshot extends MetricSnapshotInput {
  publicationId: string;
  capturedAt: string;
}

export interface ProductAdapter {
  kind: string;
  discoverSources(input: ProductConnection): Promise<ProductSourceDescriptor[]>;
  extractFacts(source: ProductSourceDescriptor): Promise<ProductFactCandidate[]>;
  collectAssets(source: ProductSourceDescriptor): Promise<ProductAssetCandidate[]>;
}

export interface ChannelAdapter {
  channel: "xiaohongshu";
  validate(content: ContentVersion): Promise<ReviewFinding[]>;
  preparePublication(input: ApprovedContent): Promise<PublicationPackage>;
  collectMetrics(publication: Publication, input: MetricSnapshotInput): Promise<MetricSnapshot>;
}
