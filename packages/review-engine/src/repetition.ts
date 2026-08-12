import type { ContentDraft } from "@social-agent/contracts/content";
import type { ReviewFinding } from "./structure.js";

export type RecentApprovedContent = {
  id: string;
  contentVersionId: string;
  draft: ContentDraft;
};

function tokens(value: string): string[] {
  const normalized = value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return normalized.split(/\s+/u).flatMap((token) => /[\p{Script=Han}]/u.test(token) ? Array.from(token) : [token]);
}

export function tokenShingles(value: string, size = 2): Set<string> {
  const words = tokens(value);
  if (words.length === 0) return new Set();
  if (words.length < size) return new Set(words);
  return new Set(Array.from({ length: words.length - size + 1 }, (_, index) => words.slice(index, index + size).join(" ")));
}

export function tokenShingleSimilarity(left: string, right: string): number {
  const leftShingles = tokenShingles(left);
  const rightShingles = tokenShingles(right);
  if (leftShingles.size === 0 && rightShingles.size === 0) return 1;
  if (leftShingles.size === 0 || rightShingles.size === 0) return 0;
  let intersection = 0;
  for (const shingle of leftShingles) if (rightShingles.has(shingle)) intersection += 1;
  return intersection / (leftShingles.size + rightShingles.size - intersection);
}

function titleCandidates(draft: ContentDraft): string[] {
  return [...draft.titleCandidates, draft.recommendedTitle];
}

function titleSimilarity(current: ContentDraft, recent: ContentDraft): number {
  let best = 0;
  for (const currentTitle of titleCandidates(current)) {
    for (const recentTitle of titleCandidates(recent)) {
      best = Math.max(best, tokenShingleSimilarity(currentTitle, recentTitle));
    }
  }
  return best;
}

function pageCopy(draft: ContentDraft): string {
  return draft.pages.flatMap((page) => [page.headline, page.body]).join(" ");
}

export function findRepetitionFindings(draft: ContentDraft, recentApprovedContents: RecentApprovedContent[]): ReviewFinding[] {
  const bodyMatches = recentApprovedContents.slice(0, 30).map((recent) => ({
    recent,
    similarity: tokenShingleSimilarity(draft.body, recent.draft.body),
    field: "body" as const,
  })).filter(({ similarity }) => similarity >= 0.70);
  const pageMatches = recentApprovedContents.slice(0, 30).map((recent) => ({
    recent,
    similarity: tokenShingleSimilarity(pageCopy(draft), pageCopy(recent.draft)),
    field: "pages" as const,
  })).filter(({ similarity }) => similarity >= 0.70);
  const titleMatches = recentApprovedContents.slice(0, 30).map((recent) => ({
    recent,
    similarity: titleSimilarity(draft, recent.draft),
    field: "titleCandidates" as const,
  })).filter(({ similarity }) => similarity >= 0.70);
  const bestBody = bodyMatches.sort((left, right) => right.similarity - left.similarity)[0];
  const bestPages = pageMatches.sort((left, right) => right.similarity - left.similarity)[0];
  const bestTitle = titleMatches.sort((left, right) => right.similarity - left.similarity)[0];
  const best = [bestBody, bestPages, bestTitle].filter((match): match is NonNullable<typeof match> => Boolean(match))
      .sort((left, right) => right.similarity - left.similarity)[0];
  if (!best) return [];
  return [{
    code: "REPETITION_NEAR_DUPLICATE",
    severity: (best.field === "body" || best.field === "pages") && best.similarity >= 0.88 ? "blocking" : "advisory",
    message: `${best.field === "body" ? "Body" : best.field === "pages" ? "Page copy" : "Title"} similarity with an approved content version is ${best.similarity.toFixed(3)}.`,
    field: best.field,
    path: best.field,
  }];
}
