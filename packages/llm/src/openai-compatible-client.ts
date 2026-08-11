import type { StructuredLlm } from "./port.js";

export type LlmEnvironment = {
  LLM_BASE_URL?: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
};

function runtimeEnvironment(): LlmEnvironment {
  const processLike = (globalThis as { process?: { env?: LlmEnvironment } }).process;
  return processLike?.env ?? {};
}

function required(env: LlmEnvironment, name: keyof LlmEnvironment): string {
  const value = env[name];
  if (!value) throw new Error("LLM_NOT_CONFIGURED");
  return value;
}

export class OpenAiCompatibleClient implements StructuredLlm {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(env: LlmEnvironment = runtimeEnvironment()) {
    const rawBaseUrl = required(env, "LLM_BASE_URL");
    try {
      this.baseUrl = new URL(rawBaseUrl).toString().replace(/\/$/, "");
    } catch {
      throw new Error("LLM_NOT_CONFIGURED");
    }
    this.apiKey = required(env, "LLM_API_KEY");
    this.model = required(env, "LLM_MODEL");
  }

  async generateJson(input: { system: string; user: string; schemaName: string }) {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) throw new Error("LLM_UNAVAILABLE");
    const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }>; model?: unknown };
    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== "string" || text.trim().length === 0) throw new Error("LLM_INVALID_RESPONSE");
    return { text, model: typeof body.model === "string" ? body.model : this.model };
  }
}
