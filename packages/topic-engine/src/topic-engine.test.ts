import { describe, expect, it } from "vitest";
import { generateTopics } from "./generate.js";
import { scoreTopic } from "./score.js";
import { selectWeeklyTopics } from "./select-week.js";
import type { GeneratedTopic, TopicCandidate, TopicGenerationInput, TopicScoreInput } from "./types.js";

const FACT_A = "00000000-0000-4000-8000-000000000001";
const FACT_B = "00000000-0000-4000-8000-000000000002";
const LEARNING_HYPOTHESIS = "00000000-0000-4000-8000-000000000011";
const LEARNING_DIRECTIONAL = "00000000-0000-4000-8000-000000000012";

const baseScore: TopicScoreInput = {
  pain: 4,
  productFit: 4,
  evidence: 4,
  visualFeasibility: 4,
  timeliness: 4,
  repetition: 1,
  risk: 1,
};

function candidate(id: number, pillar: TopicCandidate["pillar"], totalScore: number): TopicCandidate {
  return {
    id: `candidate-${id}`,
    title: `Topic ${id}`,
    angle: "fixture angle",
    pillar,
    factIds: [FACT_A],
    learningIds: [],
    risks: [],
    scores: { ...baseScore },
    contributions: scoreTopic(baseScore).contributions,
    totalScore,
  };
}

function generatedTopic(index: number, pillar: GeneratedTopic["pillar"]): GeneratedTopic {
  return {
    title: `Generated topic ${index}`,
    angle: "fixture angle",
    pillar,
    factIds: [FACT_A],
    learningIds: [LEARNING_HYPOTHESIS],
    risks: ["fixture risk"],
    pain: 4,
    productFit: 4,
    evidence: 5,
    visualFeasibility: 4,
    timeliness: 3,
    repetition: 1,
    risk: 1,
  };
}

describe("topic scoring and weekly selection", () => {
  it("penalizes high risk and repetition", () => {
    expect(scoreTopic({ ...baseScore, risk: 1, repetition: 1 }).total)
      .toBeGreaterThan(scoreTopic({ ...baseScore, risk: 5, repetition: 5 }).total);
  });

  it("returns explainable weighted contributions", () => {
    const result = scoreTopic(baseScore);
    expect(result.contributions).toEqual({
      pain: 0.88,
      productFit: 0.8,
      evidence: 0.72,
      visualFeasibility: 0.48,
      timeliness: 0.4,
      repetition: -0.1,
      risk: -0.08,
    });
    expect(result.total).toBe(3.1);
  });

  it("selects three topics across at least two pillars and caps one pillar at two", () => {
    const selected = selectWeeklyTopics([
      candidate(1, "pain_solution", 10),
      candidate(2, "pain_solution", 9),
      candidate(3, "pain_solution", 8),
      candidate(4, "product_proof", 7),
    ]);

    expect(selected).toHaveLength(3);
    expect(new Set(selected.map((item) => item.pillar)).size).toBeGreaterThanOrEqual(2);
    expect(selected.filter((item) => item.pillar === "pain_solution")).toHaveLength(2);
  });

  it("prefers the most underfilled eligible pillar before lower-priority surplus", () => {
    const selected = selectWeeklyTopics([
      candidate(1, "pain_solution", 10),
      candidate(2, "product_proof", 9),
      candidate(3, "region_timing", 8),
    ], {
      selectedCounts: { pain_solution: 5, product_proof: 0, region_timing: 0, founder_story: 0 },
    });

    expect(selected.map((item) => item.pillar)).toEqual([
      "product_proof",
      "region_timing",
      "pain_solution",
    ]);
  });

  it("blocks when three topics cannot satisfy weekly diversity", () => {
    expect(() => selectWeeklyTopics([
      candidate(1, "pain_solution", 10),
      candidate(2, "pain_solution", 9),
      candidate(3, "pain_solution", 8),
    ])).toThrow("TOPIC_DIVERSITY_UNAVAILABLE");
  });
});

describe("topic generation", () => {
  it("rejects facts that are not verified and public-use allowed before calling the model", async () => {
    const unsafeFacts = [{
      id: FACT_A,
      statement: "Unsafe fact",
      category: "feature",
      status: "draft",
      publicUseAllowed: false,
    }] as unknown as TopicGenerationInput["facts"];

    await expect(generateTopics({
      campaign: {
        goal: "goal",
        audience: "audience",
        pillarQuotas: { pain_solution: 5, product_proof: 4, region_timing: 2, founder_story: 1 },
      },
      facts: unsafeFacts,
      recentTopics: [],
      learnings: [],
    }, {
      async generateJson() {
        throw new Error("LLM_SHOULD_NOT_RUN");
      },
    })).rejects.toThrow("VERIFIED_FACT_REQUIRED");
  });

  it("generates nine scored candidates from verified facts and eligible learnings", async () => {
    const calls: Parameters<NonNullable<Parameters<typeof generateTopics>[1]>["generateJson"]>[0][] = [];
    const generated = Array.from({ length: 9 }, (_, index) => generatedTopic(index + 1, [
      "pain_solution", "product_proof", "region_timing", "founder_story",
      "pain_solution", "product_proof", "region_timing", "founder_story", "pain_solution",
    ][index] as GeneratedTopic["pillar"]));
    const result = await generateTopics({
      campaign: {
        goal: "help students plan weeknight meals",
        audience: "students",
        pillarQuotas: { pain_solution: 5, product_proof: 4, region_timing: 2, founder_story: 1 },
      },
      facts: [
        { id: FACT_A, statement: "Verified fact A", category: "feature", status: "verified", publicUseAllowed: true },
        { id: FACT_B, statement: "Verified fact B", category: "data", status: "verified", publicUseAllowed: true },
      ],
      recentTopics: [],
      learnings: [
        { id: LEARNING_HYPOTHESIS, summary: "Hypothesis summary", samples: 3, completed: true },
        { id: LEARNING_DIRECTIONAL, summary: "Directional summary", samples: 10, completed: true },
        { id: "00000000-0000-4000-8000-000000000013", summary: "Must not enter prompt", samples: 20, completed: false },
      ],
    }, {
      async generateJson(input) {
        calls.push(input);
        return { text: JSON.stringify({ candidates: generated }), model: "fake-model" };
      },
    });

    expect(result.candidates).toHaveLength(9);
    expect(result.selected).toHaveLength(3);
    expect(result.candidates.every((item) => item.factIds.length >= 1)).toBe(true);
    expect(result.candidates.every((item) => typeof item.totalScore === "number")).toBe(true);
    expect(calls[0]?.user).toContain("hypothesis");
    expect(calls[0]?.user).toContain("directional");
    expect(calls[0]?.user).not.toContain("Must not enter prompt");
    expect(calls[0]?.user).toContain(LEARNING_HYPOTHESIS);
  });
});
