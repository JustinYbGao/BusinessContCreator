export interface VisualPageScript {
  page: number;
  purpose: string;
  headline: string;
  body: string;
  sourceAssetId: string | null;
}

export interface VerifiedSourceAsset {
  id: string;
  workspaceId: string;
  productId: string;
  verificationStatus: "verified";
  publicUseAllowed: true;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  sha256: string;
  bytes: Buffer;
}

export interface VisualBrand {
  mark: string;
  background: string;
  foreground: string;
  accent: string;
}

export interface SourceAssetResolverPort {
  resolveVerifiedSourceAsset(input: {
    workspaceId: string;
    productId: string;
    assetId: string;
  }): Promise<VerifiedSourceAsset | null>;
}

export interface RenderCarouselInput {
  workspaceId: string;
  productId: string;
  contentVersionId: string;
  pages: VisualPageScript[];
  sourceAssetResolver: SourceAssetResolverPort;
  brand: VisualBrand;
}

export interface RenderedCarouselPage {
  page: number;
  buffer: Buffer;
  width: number;
  height: number;
  mimeType: "image/png";
  sha256: string;
  byteSize: number;
}

export interface GeneratedAssetInput {
  objectKey: string;
  mimeType: "image/png";
  byteSize: number;
  width: 1080;
  height: 1440;
  sha256: string;
}

export interface AssetStoragePort {
  upload(
    objectKey: string,
    bytes: Buffer,
    metadata: {
      contentType: "image/png";
      sha256: string;
      verified: true;
      uploadAttemptId: string;
    },
  ): Promise<void>;
  removeOwned(objectKeys: string[], uploadAttemptId: string): Promise<void>;
}

export interface GeneratedAssetCommitPort {
  insertVerifiedGeneratedAssets(input: {
    workspaceId: string;
    productId: string;
    contentVersionId: string;
    assets: GeneratedAssetInput[];
  }): Promise<void>;
  hasVerifiedGeneratedAssets(input: {
    workspaceId: string;
    productId: string;
    contentVersionId: string;
    assets: GeneratedAssetInput[];
  }): Promise<boolean>;
}

export interface PersistRenderedCarouselInput {
  workspaceId: string;
  productId: string;
  contentVersionId: string;
  pages: RenderedCarouselPage[];
  storage: AssetStoragePort;
  commit: GeneratedAssetCommitPort;
}
