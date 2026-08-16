import { describe, expect, it } from "vitest";
import { createFixtureLlm } from "./fixture-llm.js";

const FACT_ID = "00000000-0000-4000-8000-000000000004";

describe("fixture LLM", () => {
  it("returns deterministic topic, content, and claim extraction payloads", async () => {
    const llm = createFixtureLlm();
    const topic = await llm.generateJson({ schemaName: "TopicModelOutput", system: "", user: JSON.stringify({ facts: [{ id: FACT_ID, statement: "Fixture fact" }] }) });
    const content = await llm.generateJson({ schemaName: "ContentDraft", system: "", user: JSON.stringify({ topic: { title: "Fixture topic" }, facts: [{ id: FACT_ID, statement: "Fixture fact" }], usableAssets: [] }) });
    const claims = await llm.generateJson({ schemaName: "ClaimExtraction", system: "", user: JSON.stringify({ claimLedger: [{ factId: FACT_ID, text: "Fixture fact" }], corpusSegments: [{ path: "body", text: "Fixture fact" }] }) });

    expect(JSON.parse(topic.text).candidates).toHaveLength(9);
    expect(JSON.parse(content.text).pages).toHaveLength(7);
    expect(JSON.parse(claims.text).coverage).toEqual([{ path: "body", text: "Fixture fact", classification: "claim" }]);
  });
});
