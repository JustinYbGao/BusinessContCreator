import { TopicScoreInputSchema, type TopicScoreInput } from "./types.js";

export const TOPIC_SCORE_WEIGHTS = {
  pain: 0.22,
  productFit: 0.20,
  evidence: 0.18,
  visualFeasibility: 0.12,
  timeliness: 0.10,
  repetition: -0.10,
  risk: -0.08,
} as const;

export type TopicScoreResult = {
  total: number;
  contributions: Record<keyof TopicScoreInput, number>;
};

const round = (value: number) => Number(value.toFixed(3));

export function scoreTopic(input: TopicScoreInput): TopicScoreResult {
  const parsed = TopicScoreInputSchema.safeParse(input);
  if (!parsed.success) throw new Error("INVALID_TOPIC_SCORE");

  const contributions = {
    pain: round(input.pain * TOPIC_SCORE_WEIGHTS.pain),
    productFit: round(input.productFit * TOPIC_SCORE_WEIGHTS.productFit),
    evidence: round(input.evidence * TOPIC_SCORE_WEIGHTS.evidence),
    visualFeasibility: round(input.visualFeasibility * TOPIC_SCORE_WEIGHTS.visualFeasibility),
    timeliness: round(input.timeliness * TOPIC_SCORE_WEIGHTS.timeliness),
    repetition: round(input.repetition * TOPIC_SCORE_WEIGHTS.repetition),
    risk: round(input.risk * TOPIC_SCORE_WEIGHTS.risk),
  };
  const total = round(Object.values(contributions).reduce((sum, value) => sum + value, 0));
  return { total, contributions };
}
