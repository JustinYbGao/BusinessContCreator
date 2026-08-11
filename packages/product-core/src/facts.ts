import {
  ProductFactCandidateSchema,
  type ProductFactCandidate,
} from "@social-agent/contracts";
import { normalizeProductSourceLocator } from "./source-policy.js";

export type ManualFactInput = {
  statement: string;
  category: ProductFactCandidate["category"];
  sourceNote: string;
};

export function normalizeFactCandidate(input: ProductFactCandidate): ProductFactCandidate {
  const parsed = ProductFactCandidateSchema.safeParse({
    ...input,
    statement: input.statement.trim(),
    sourceLocator: normalizeProductSourceLocator(input.sourceLocator),
    evidenceExcerpt: input.evidenceExcerpt.trim(),
  });
  if (!parsed.success) throw new Error("INVALID_FACT_CANDIDATE");
  return parsed.data;
}

export function createManualFactCandidate(input: ManualFactInput): ProductFactCandidate {
  const sourceNote = input.sourceNote.trim();
  if (!sourceNote) throw new Error("INVALID_MANUAL_SOURCE_NOTE");
  return normalizeFactCandidate({
    statement: input.statement,
    category: input.category,
    sourceLocator: "manual/operator-note",
    evidenceExcerpt: sourceNote,
  });
}

export function prepareFactCandidates(inputs: readonly ProductFactCandidate[]): ProductFactCandidate[] {
  return inputs.map(normalizeFactCandidate);
}
