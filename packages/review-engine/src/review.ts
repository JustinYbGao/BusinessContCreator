import type { StructuredLlm } from "@social-agent/llm/port";
import { findComplianceFindings } from "./compliance.js";
import { extractClaims } from "./claim-extractor.js";
import { validateFactAndAssetScope, type ReviewFact, type ReviewSourceAsset } from "./facts.js";
import { findRepetitionFindings, type RecentApprovedContent } from "./repetition.js";
import { findStructureFindings, type ReviewFinding } from "./structure.js";
import { ContentDraftSchema } from "@social-agent/contracts/content";

export type ReviewInput = {
  workspaceId: string;
  productId: string;
  contentVersionId: string;
  draft: unknown;
  facts: ReviewFact[];
  sourceAssets: ReviewSourceAsset[];
  recentApprovedContents: RecentApprovedContent[];
};

export type ReviewResult = {
  passed: boolean;
  findings: ReviewFinding[];
  claimExtractionModel: string | null;
  repairAttempts: number;
};

export function findApprovalRevalidationFindings(input: Pick<ReviewInput, "workspaceId" | "productId" | "draft" | "facts" | "sourceAssets" | "recentApprovedContents">): ReviewFinding[] {
  const structureFindings = findStructureFindings(input.draft);
  const factFindings = validateFactAndAssetScope(input);
  const complianceFindings = findComplianceFindings(input.draft, input.sourceAssets);
  const parsedDraft = ContentDraftSchema.safeParse(input.draft);
  const repetitionFindings = parsedDraft.success
    ? findRepetitionFindings(parsedDraft.data, input.recentApprovedContents)
    : [];
  return [...structureFindings, ...factFindings, ...complianceFindings, ...repetitionFindings];
}

export async function reviewContent(input: ReviewInput, llm: StructuredLlm): Promise<ReviewResult> {
  const facts = Array.isArray(input.facts) ? input.facts : [];
  const sourceAssets = Array.isArray(input.sourceAssets) ? input.sourceAssets : [];
  const recentApprovedContents = Array.isArray(input.recentApprovedContents) ? input.recentApprovedContents : [];
  const structureFindings = findStructureFindings(input.draft);

  // Execute the stages in policy order. A later deterministic check cannot
  // make an unavailable or malformed model result pass.
  const claimExtraction = await extractClaims(input.draft, llm, sourceAssets);
  const factFindings = validateFactAndAssetScope({ ...input, facts, sourceAssets });
  const complianceFindings = findComplianceFindings(input.draft, sourceAssets);
  const parsedDraft = ContentDraftSchema.safeParse(input.draft);
  const repetitionFindings = parsedDraft.success
    ? findRepetitionFindings(parsedDraft.data, recentApprovedContents)
    : [];
  const findings = [
    ...structureFindings,
    ...claimExtraction.findings,
    ...factFindings,
    ...complianceFindings,
    ...repetitionFindings,
  ];
  return {
    passed: !findings.some((finding) => finding.severity === "blocking"),
    findings,
    claimExtractionModel: claimExtraction.model,
    repairAttempts: claimExtraction.repairAttempts,
  };
}

export type { ReviewFinding, ReviewFact, ReviewSourceAsset, RecentApprovedContent };
export * from "./structure.js";
export * from "./facts.js";
export * from "./claim-extractor.js";
export * from "./compliance.js";
export * from "./repetition.js";
