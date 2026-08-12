import type { ReviewFact, ReviewSourceAsset } from "./facts.js";

type ReviewFactRow = {
  [key: string]: unknown;
  id: string;
  workspace_id: string;
  product_id: string;
  statement: string;
  status: string;
  public_use_allowed: boolean;
};

type ReviewSourceAssetRow = {
  [key: string]: unknown;
  id: string;
  workspace_id: string;
  product_id: string;
  content_version_id: string | null;
  kind: string;
  source_locator: string | null;
  provenance: string;
  verification_status: string;
  public_use_allowed: boolean;
};

export type RecentApprovedContentRow = {
  id: string;
  content_id: string;
  payload: unknown;
  created_at: string;
};

export type ReviewContext = {
  contentVersionId: string;
  payload: unknown;
  facts: ReviewFact[];
  sourceAssets: ReviewSourceAsset[];
  recentApprovedContents: Array<{
    contentId: string;
    contentVersionId: string;
    payload: unknown;
  }>;
};

function compareAscending(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function buildReviewContext(input: {
  contentVersionId: string;
  payload: unknown;
  facts: readonly ReviewFactRow[];
  sourceAssets: readonly ReviewSourceAssetRow[];
  recentApprovedContents: readonly RecentApprovedContentRow[];
}): ReviewContext {
  const facts: ReviewFact[] = [...input.facts]
    .sort((left, right) => compareAscending(left.id, right.id))
    .map((fact) => ({
      id: fact.id,
      workspaceId: fact.workspace_id,
      productId: fact.product_id,
      statement: fact.statement,
      status: fact.status,
      publicUseAllowed: fact.public_use_allowed,
    }));
  const sourceAssets: ReviewSourceAsset[] = [...input.sourceAssets]
    .sort((left, right) => compareAscending(left.id, right.id))
    .map((asset) => ({
      id: asset.id,
      workspaceId: asset.workspace_id,
      productId: asset.product_id,
      contentVersionId: asset.content_version_id,
      kind: asset.kind,
      sourceLocator: asset.source_locator,
      provenance: asset.provenance,
      verificationStatus: asset.verification_status,
      publicUseAllowed: asset.public_use_allowed,
    }));
  const recentApprovedContents = [...input.recentApprovedContents]
    .map((content) => ({
      contentId: content.content_id,
      contentVersionId: content.id,
      payload: content.payload,
    }));

  return {
    contentVersionId: input.contentVersionId,
    payload: input.payload,
    facts,
    sourceAssets,
    recentApprovedContents,
  };
}
