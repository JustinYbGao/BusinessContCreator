import type { StructuredLlm } from "@social-agent/llm";

const FALLBACK_FACT_ID = "00000000-0000-4000-8000-000000000004";

type RecordValue = Record<string, unknown>;

function recordValue(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

function userValue(input: string): RecordValue {
  try {
    return recordValue(JSON.parse(input));
  } catch {
    return {};
  }
}

function factFrom(input: RecordValue): { id: string; statement: string } {
  const facts = Array.isArray(input.facts) ? input.facts : Array.isArray(input.verifiedFacts) ? input.verifiedFacts : [];
  const first = recordValue(facts[0]);
  return {
    id: typeof first.id === "string" ? first.id : FALLBACK_FACT_ID,
    statement: typeof first.statement === "string" && first.statement.trim() ? first.statement : "Fixture fact",
  };
}

function topicPayload(input: RecordValue): RecordValue {
  const fact = factFrom(input);
  const pillars = ["pain_solution", "product_proof", "region_timing", "founder_story"];
  const candidates = Array.from({ length: 9 }, (_, index) => ({
    title: `Fixture topic ${index + 1}`,
    angle: `用一个可验证的场景说明：${fact.statement}`,
    pillar: pillars[index % pillars.length],
    factIds: [fact.id],
    learningIds: [],
    risks: [],
    pain: 4,
    productFit: 4,
    evidence: 5,
    visualFeasibility: 4,
    timeliness: 3,
    repetition: 1,
    risk: 1,
  }));
  return { candidates };
}

function contentPayload(input: RecordValue): RecordValue {
  const fact = factFrom(input);
  const topic = recordValue(input.topic);
  const title = typeof topic.title === "string" && topic.title.trim() ? topic.title : "Fixture content";
  return {
    titleCandidates: [title, `${title}｜方法`, `${title}｜场景`, `${title}｜清单`, `${title}｜复盘`],
    recommendedTitle: title,
    body: fact.statement,
    hashtags: ["#fixture", "#内容运营", "#产品事实"],
    interactionPrompt: "你会先尝试哪一步？",
    pages: Array.from({ length: 7 }, (_, index) => ({
      page: index + 1,
      purpose: index === 0 ? "封面" : "内容说明",
      headline: index === 0 ? title : `第 ${index + 1} 步`,
      body: index === 0 ? fact.statement : `这是一个可验证的执行步骤 ${index + 1}。`,
      sourceAssetId: null,
    })),
    claims: [{ factId: fact.id, text: fact.statement }],
  };
}

function claimPayload(input: RecordValue): RecordValue {
  const ledger = Array.isArray(input.claimLedger) ? input.claimLedger : [];
  const first = recordValue(ledger[0]);
  const factId = typeof first.factId === "string" ? first.factId : FALLBACK_FACT_ID;
  const text = typeof first.text === "string" && first.text.trim() ? first.text : "Fixture fact";
  const segments = Array.isArray(input.corpusSegments) ? input.corpusSegments : [];
  return {
    claims: [{ text, kind: "capability", factId }],
    coverage: segments.map((segment) => {
      const value = recordValue(segment);
      const segmentText = typeof value.text === "string" ? value.text : "";
      return {
        path: typeof value.path === "string" ? value.path : "fixture",
        text: segmentText,
        classification: segmentText.includes(text) ? "claim" : "non_claim",
      };
    }),
  };
}

export function createFixtureLlm(): StructuredLlm {
  return {
    async generateJson(input) {
      const parsedInput = userValue(input.user);
      const payload = (input.schemaName === "TopicGeneration" || input.schemaName === "TopicModelOutput")
        ? topicPayload(parsedInput)
        : input.schemaName === "ContentDraft"
          ? contentPayload(parsedInput)
          : input.schemaName === "ClaimExtraction"
            ? claimPayload(parsedInput)
            : {};
      return { text: JSON.stringify(payload), model: "fixture-model" };
    },
  };
}
