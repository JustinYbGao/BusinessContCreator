import { z } from "zod";
import { ContentDraftSchema } from "@social-agent/contracts/content";

export type ReviewFinding = {
  code: string;
  severity: "blocking" | "advisory";
  message: string;
  field?: string;
  path?: string;
};

export type ReviewCorpusEntry = {
  field: string;
  path: string;
  text: string;
};

export type ReviewCorpusSegment = {
  path: string;
  text: string;
};

type ReviewCorpusAsset = {
  id: string;
  kind?: string;
  sourceLocator?: string | null;
};

const UUID_SCHEMA = z.string().uuid();

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function blocking(code: string, message: string, path?: string): ReviewFinding {
  return { code, severity: "blocking", message, ...(path ? { path } : {}) };
}

export function buildReviewCorpus(
  draft: unknown,
  sourceAssets: readonly ReviewCorpusAsset[] = [],
): ReviewCorpusEntry[] {
  const record = recordOf(draft);
  const entries: ReviewCorpusEntry[] = [];
  const add = (field: string, path: string, value: unknown) => {
    const text = textOf(value);
    if (text) entries.push({ field, path, text });
  };

  const titles = Array.isArray(record.titleCandidates) ? record.titleCandidates : [];
  titles.forEach((title, index) => add("titleCandidates", `titleCandidates[${index}]`, title));
  add("recommendedTitle", "recommendedTitle", record.recommendedTitle);
  add("body", "body", record.body);
  add("hashtags", "hashtags", Array.isArray(record.hashtags) ? record.hashtags.join(" ") : "");
  add("interactionPrompt", "interactionPrompt", record.interactionPrompt);

  const pages = Array.isArray(record.pages) ? record.pages : [];
  pages.forEach((page, index) => {
    const pageRecord = recordOf(page);
    add("pageHeadline", `pages[${index}].headline`, pageRecord.headline);
    add("pageBody", `pages[${index}].body`, pageRecord.body);
    add("sourceAssetId", `pages[${index}].sourceAssetId`, pageRecord.sourceAssetId);
  });
  const declaredAssetIds = new Set(pages.flatMap((page) => {
    const sourceAssetId = recordOf(page).sourceAssetId;
    return typeof sourceAssetId === "string" ? [sourceAssetId] : [];
  }));
  sourceAssets.filter((asset) => declaredAssetIds.has(asset.id)).forEach((asset) => {
    add("sourceAsset", `sourceAssets[${asset.id}].kind`, asset.kind);
    add("sourceAsset", `sourceAssets[${asset.id}].sourceLocator`, asset.sourceLocator);
  });
  return entries;
}

export function buildReviewCorpusSegments(
  draft: unknown,
  sourceAssets: readonly ReviewCorpusAsset[] = [],
): ReviewCorpusSegment[] {
  return buildReviewCorpus(draft, sourceAssets).flatMap((entry) => {
    const pieces = entry.text.split(/(?<=[。！？；;.!?，,])/u).map((piece) => piece.trim()).filter(Boolean);
    return pieces.map((text, index) => ({
      path: pieces.length === 1 ? entry.path : `${entry.path}#${index}`,
      text,
    }));
  });
}

export function reviewCorpusText(
  draft: unknown,
  sourceAssets: readonly ReviewCorpusAsset[] = [],
): string {
  return buildReviewCorpus(draft, sourceAssets).map((entry) => `${entry.path}: ${entry.text}`).join("\n");
}

export function findStructureFindings(draft: unknown): ReviewFinding[] {
  const record = recordOf(draft);
  const findings: ReviewFinding[] = [];
  const titles = record.titleCandidates;
  if (!Array.isArray(titles) || titles.length !== 5 || titles.some((title) => textOf(title).length === 0)) {
    findings.push(blocking("TITLE_CANDIDATES_INVALID", "Exactly five non-empty title candidates are required.", "titleCandidates"));
  }

  for (const field of ["recommendedTitle", "body", "interactionPrompt"] as const) {
    if (!textOf(record[field])) findings.push(blocking("STRUCTURE_FIELD_INVALID", `${field} must be non-empty.`, field));
  }

  const hashtags = record.hashtags;
  if (!Array.isArray(hashtags) || hashtags.length < 3 || hashtags.length > 8 || hashtags.some((tag) => !/^#.+/.test(textOf(tag)))) {
    findings.push(blocking("HASHTAGS_INVALID", "Hashtags must contain between three and eight #-prefixed values.", "hashtags"));
  }

  const pages = record.pages;
  if (!Array.isArray(pages) || pages.length !== 7) {
    findings.push(blocking("PAGE_COUNT_INVALID", "Exactly seven image pages are required.", "pages"));
  } else {
    const pageNumbers = pages.map((page) => recordOf(page).page);
    if (pageNumbers.some((page) => typeof page !== "number" || !Number.isInteger(page))
      || pageNumbers.some((page, index) => page !== index + 1)
      || new Set(pageNumbers).size !== 7) {
      findings.push(blocking("PAGE_SEQUENCE_INVALID", "Pages must be numbered 1 through 7 exactly once.", "pages"));
    }
    pages.forEach((page, index) => {
      const pageRecord = recordOf(page);
      if (!textOf(pageRecord.purpose) || !textOf(pageRecord.headline) || !textOf(pageRecord.body)) {
        findings.push(blocking("PAGE_CONTENT_INVALID", "Every page needs a purpose, headline, and body.", `pages[${index}]`));
      }
      const sourceAssetId = pageRecord.sourceAssetId;
      if (sourceAssetId !== null && !UUID_SCHEMA.safeParse(sourceAssetId).success) {
        findings.push(blocking("SOURCE_ASSET_INVALID", "A source asset reference must be a UUID or null.", `pages[${index}].sourceAssetId`));
      }
    });
  }

  const claims = record.claims;
  if (!Array.isArray(claims) || claims.length === 0) {
    findings.push(blocking("CLAIM_LEDGER_EMPTY", "At least one Claim Ledger entry is required.", "claims"));
  } else {
    const seen = new Set<string>();
    claims.forEach((claim, index) => {
      const claimRecord = recordOf(claim);
      const factId = claimRecord.factId;
      if (!UUID_SCHEMA.safeParse(factId).success || !textOf(claimRecord.text)) {
        findings.push(blocking("CLAIM_LEDGER_INVALID", "Each Claim Ledger entry needs a Fact UUID and non-empty text.", `claims[${index}]`));
      } else if (seen.has(String(factId))) {
        findings.push(blocking("CLAIM_LEDGER_DUPLICATE", "A Fact may appear only once in the Claim Ledger.", `claims[${index}].factId`));
      } else {
        seen.add(String(factId));
      }
    });
  }

  const schemaResult = ContentDraftSchema.safeParse(draft);
  if (!schemaResult.success && findings.length === 0) {
    findings.push(blocking("STRUCTURE_INVALID", "Content draft does not match the required content contract."));
  }
  return findings;
}
