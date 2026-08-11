import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseStructured } from "./parse-structured.js";
import type { StructuredLlm } from "./port.js";

const AnswerSchema = z.object({ answer: z.string().min(1) }).strict();

function fakeLlm(responses: string[], calls: Parameters<StructuredLlm["generateJson"]>[0][] = []): StructuredLlm {
  let index = 0;
  return {
    async generateJson(input) {
      calls.push(input);
      return { text: responses[index++] ?? "", model: "fake-model" };
    },
  };
}

describe("parseStructured", () => {
  it("repairs one invalid response with only schema issues", async () => {
    const calls: Parameters<StructuredLlm["generateJson"]>[0][] = [];
    const result = await parseStructured(fakeLlm(["{\"answer\": 1}", "{\"answer\":\"ok\"}"], calls), AnswerSchema, {
      system: "system instructions",
      user: "original user request",
      schemaName: "Answer",
    });

    expect(result.value).toEqual({ answer: "ok" });
    expect(result.repairAttempts).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.user).toContain("answer");
    expect(calls[1]?.user).toContain('{"answer": 1}');
    expect(calls[1]?.user).not.toContain("original user request");
  });

  it("fails closed after the second invalid response", async () => {
    const calls: Parameters<StructuredLlm["generateJson"]>[0][] = [];

    await expect(parseStructured(fakeLlm(["not-json", "still-not-json"], calls), AnswerSchema, {
      system: "system instructions",
      user: "original user request",
      schemaName: "Answer",
    })).rejects.toThrow("HUMAN_MODEL_OUTPUT_REQUIRED");
    expect(calls).toHaveLength(2);
  });

  it("does not issue a second repair request when the repair call fails", async () => {
    let calls = 0;
    const llm: StructuredLlm = {
      async generateJson() {
        calls += 1;
        if (calls === 1) return { text: '{"answer":1}', model: "fake-model" };
        throw new Error("LLM_UNAVAILABLE");
      },
    };

    await expect(parseStructured(llm, AnswerSchema, {
      system: "system instructions",
      user: "original user request",
      schemaName: "Answer",
    })).rejects.toThrow("LLM_UNAVAILABLE");
    expect(calls).toBe(2);
  });
});
