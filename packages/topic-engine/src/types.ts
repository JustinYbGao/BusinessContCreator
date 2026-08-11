import { z } from "zod";

export const TopicPillarSchema = z.enum([
  "pain_solution",
  "product_proof",
  "region_timing",
  "founder_story",
]);
export type TopicPillar = z.infer<typeof TopicPillarSchema>;

export const TopicScoreInputSchema = z.object({
  pain: z.number().int().min(1).max(5),
  productFit: z.number().int().min(1).max(5),
  evidence: z.number().int().min(1).max(5),
  visualFeasibility: z.number().int().min(1).max(5),
  timeliness: z.number().int().min(1).max(5),
  repetition: z.number().int().min(1).max(5),
  risk: z.number().int().min(1).max(5),
}).strict();
export type TopicScoreInput = z.infer<typeof TopicScoreInputSchema>;

export const GeneratedTopicSchema = z.object({
  title: z.string().trim().min(1).max(160),
  angle: z.string().trim().min(1).max(1_000),
  pillar: TopicPillarSchema,
  factIds: z.array(z.string().uuid()).min(1),
  learningIds: z.array(z.string().uuid()),
  risks: z.array(z.string().trim().min(1).max(500)).max(8),
  pain: z.number().int().min(1).max(5),
  productFit: z.number().int().min(1).max(5),
  evidence: z.number().int().min(1).max(5),
  visualFeasibility: z.number().int().min(1).max(5),
  timeliness: z.number().int().min(1).max(5),
  repetition: z.number().int().min(1).max(5),
  risk: z.number().int().min(1).max(5),
}).strict();
export type GeneratedTopic = z.infer<typeof GeneratedTopicSchema>;

export const TopicModelOutputSchema = z.object({
  candidates: z.array(GeneratedTopicSchema).length(9),
}).strict();

export const TopicFactSchema = z.object({
  id: z.string().uuid(),
  statement: z.string().trim().min(1),
  category: z.string().trim().min(1),
  status: z.literal("verified"),
  publicUseAllowed: z.literal(true),
}).strict();

export type TopicCandidate = Omit<GeneratedTopic, keyof TopicScoreInput> & {
  id: string;
  scores: TopicScoreInput;
  contributions: Record<keyof TopicScoreInput, number>;
  totalScore: number;
};

export type TopicPillarCounts = Record<TopicPillar, number>;

export type TopicSelectionOptions = {
  selectedCounts?: Partial<TopicPillarCounts>;
  pillarQuotas?: TopicPillarCounts;
};

export type TopicFact = z.infer<typeof TopicFactSchema>;
export type TopicLearning = { id: string; summary: string; samples: number; completed: boolean };

export type TopicGenerationInput = {
  campaign: {
    goal: string;
    audience: string;
    pillarQuotas: TopicPillarCounts;
  };
  facts: TopicFact[];
  recentTopics: string[];
  learnings: TopicLearning[];
};

export type TopicGenerationResult = {
  candidates: TopicCandidate[];
  selected: TopicCandidate[];
  model: string;
  repairAttempts: number;
};
