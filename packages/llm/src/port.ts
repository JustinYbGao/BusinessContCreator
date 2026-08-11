export interface StructuredLlm {
  generateJson(input: {
    system: string;
    user: string;
    schemaName: string;
  }): Promise<{ text: string; model: string }>;
}
