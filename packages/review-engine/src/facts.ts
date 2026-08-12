import type { ReviewFinding } from "./structure.js";

export type ReviewFact = {
  id: string;
  workspaceId: string;
  productId: string;
  statement: string;
  status: string;
  publicUseAllowed: boolean;
};

export type ReviewSourceAsset = {
  id: string;
  workspaceId: string;
  productId: string;
  contentVersionId: string | null;
  kind?: string;
  sourceLocator?: string | null;
  provenance: string;
  verificationStatus: string;
  publicUseAllowed: boolean;
};

function blocking(code: string, message: string, path?: string): ReviewFinding {
  return { code, severity: "blocking", message, ...(path ? { path } : {}) };
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizedText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function claimMatchesFact(claimText: unknown, factStatement: unknown): boolean {
  if (typeof claimText !== "string" || typeof factStatement !== "string") return false;
  const claim = normalizedText(claimText);
  const fact = normalizedText(factStatement);
  return Boolean(claim && fact && claim === fact);
}

export function validateFactAndAssetScope(input: {
  workspaceId: string;
  productId: string;
  draft: unknown;
  facts: ReviewFact[];
  sourceAssets: ReviewSourceAsset[];
}): ReviewFinding[] {
  const draftRecord = recordOf(input.draft);
  const claims = Array.isArray(draftRecord.claims) ? draftRecord.claims : [];
  const usableFacts = new Map(input.facts
    .filter((fact) => fact.workspaceId === input.workspaceId
      && fact.productId === input.productId
      && fact.status === "verified"
      && fact.publicUseAllowed)
    .map((fact) => [fact.id, fact] as const));
  const findings: ReviewFinding[] = [];
  const seenFacts = new Set<string>();
  claims.forEach((claim, index) => {
    const factId = recordOf(claim).factId;
    if (typeof factId !== "string" || seenFacts.has(factId)) return;
    seenFacts.add(factId);
    if (!usableFacts.has(factId) || !claimMatchesFact(recordOf(claim).text, usableFacts.get(factId)?.statement)) {
      findings.push(blocking("UNKNOWN_PRODUCT_FACT", "The Claim Ledger references a Fact that is not verified, public-use allowed, and in this Product/Workspace scope.", `claims[${index}].factId`));
    }
  });

  const usableAssetIds = new Set(input.sourceAssets
    .filter((asset) => asset.workspaceId === input.workspaceId
      && asset.productId === input.productId
      && asset.contentVersionId === null
      && asset.provenance === "source"
      && asset.verificationStatus === "verified"
      && asset.publicUseAllowed)
    .map((asset) => asset.id));
  const pages = Array.isArray(draftRecord.pages) ? draftRecord.pages : [];
  pages.forEach((page, index) => {
    const sourceAssetId = recordOf(page).sourceAssetId;
    if (sourceAssetId !== null && typeof sourceAssetId === "string" && !usableAssetIds.has(sourceAssetId)) {
      findings.push(blocking("SOURCE_ASSET_SCOPE_MISMATCH", "A declared source Asset is not verified, public-use allowed, or in this Product/Workspace scope.", `pages[${index}].sourceAssetId`));
    }
  });
  return findings;
}
