import type { TopicCandidate, TopicPillar, TopicPillarCounts, TopicSelectionOptions } from "./types.js";

export const DEFAULT_PILLAR_QUOTAS: TopicPillarCounts = {
  pain_solution: 5,
  product_proof: 4,
  region_timing: 2,
  founder_story: 1,
};

const PILLARS: TopicPillar[] = ["pain_solution", "product_proof", "region_timing", "founder_story"];

function deficit(pillar: TopicPillar, selectedCounts: TopicPillarCounts, quotas: TopicPillarCounts): number {
  return Math.max(quotas[pillar] - selectedCounts[pillar], 0);
}

export function selectWeeklyTopics(
  candidates: TopicCandidate[],
  options: TopicSelectionOptions = {},
): TopicCandidate[] {
  const quotas = { ...DEFAULT_PILLAR_QUOTAS, ...options.pillarQuotas };
  const selectedCounts = Object.fromEntries(PILLARS.map((pillar) => [pillar, options.selectedCounts?.[pillar] ?? 0])) as TopicPillarCounts;
  const selected: TopicCandidate[] = [];

  for (let slot = 0; slot < 3; slot += 1) {
    const eligible = candidates.filter((candidate) => {
      const selectedInPillar = selected.filter((item) => item.pillar === candidate.pillar).length;
      return !selected.some((item) => item.id === candidate.id)
        && selectedInPillar < 2;
    });

    const underfilled = eligible.filter((candidate) => deficit(candidate.pillar, selectedCounts, quotas) > 0);
    const pool = underfilled.length > 0 ? underfilled : eligible;
    pool.sort((left, right) => {
      const deficitDifference = deficit(right.pillar, selectedCounts, quotas) - deficit(left.pillar, selectedCounts, quotas);
      if (deficitDifference !== 0) return deficitDifference;
      if (right.totalScore !== left.totalScore) return right.totalScore - left.totalScore;
      return left.id.localeCompare(right.id);
    });

    const next = pool[0];
    if (!next) throw new Error("TOPIC_DIVERSITY_UNAVAILABLE");
    selected.push(next);
    selectedCounts[next.pillar] += 1;
  }

  if (new Set(selected.map((item) => item.pillar)).size < 2) {
    throw new Error("TOPIC_DIVERSITY_UNAVAILABLE");
  }
  return selected;
}
