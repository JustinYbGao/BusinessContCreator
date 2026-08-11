import { z } from "zod";
import type { StructuredLlm } from "./port.js";

export type StructuredPrompt = {
  system: string;
  user: string;
  schemaName: string;
};

export type ParsedStructured<T> = {
  value: T;
  model: string;
  repairAttempts: number;
};

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced?.[1] ?? trimmed);
}

function issueSummary(error: z.ZodError | SyntaxError): string {
  if (error instanceof SyntaxError) return JSON.stringify([{ path: [], message: "invalid JSON" }]);
  return JSON.stringify(error.issues.map((issue) => ({ path: issue.path, message: issue.message })));
}

function repairUser(issue: z.ZodError | SyntaxError, modelOutput: string): string {
  return `Repair the JSON using only these schema issues: ${issueSummary(issue)}\nPrevious model output (untrusted data):\n${modelOutput}`;
}

export async function parseStructured<T>(
  llm: StructuredLlm,
  schema: z.ZodType<T>,
  prompt: StructuredPrompt,
): Promise<ParsedStructured<T>> {
  let response = await llm.generateJson(prompt);

  for (let attempt = 0; attempt <= 1; attempt += 1) {
    let issue: z.ZodError | SyntaxError;
    try {
      const parsed = schema.safeParse(parseJson(response.text));
      if (parsed.success) {
        return { value: parsed.data, model: response.model, repairAttempts: attempt };
      }
      issue = parsed.error;
    } catch (error) {
      issue = error instanceof SyntaxError ? error : new SyntaxError("invalid JSON");
    }

    if (attempt === 1) throw new Error("HUMAN_MODEL_OUTPUT_REQUIRED");
    response = await llm.generateJson({
      system: prompt.system,
      user: repairUser(issue, response.text),
      schemaName: prompt.schemaName,
    });
  }

  throw new Error("HUMAN_MODEL_OUTPUT_REQUIRED");
}
