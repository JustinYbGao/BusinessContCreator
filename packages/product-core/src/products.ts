import { ProductCreateInputSchema, type ProductCreateInput } from "@social-agent/contracts";
import { validateCampaignInput } from "./campaigns.js";

function normalizeProductInput(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;
  return {
    ...record,
    slug: typeof record.slug === "string" ? record.slug.trim().toLowerCase() : record.slug,
  };
}

export function validateProductInput(input: unknown): ProductCreateInput {
  const parsed = ProductCreateInputSchema.safeParse(normalizeProductInput(input));
  if (!parsed.success) throw new Error("INVALID_PRODUCT_INPUT");
  return parsed.data;
}

export { validateCampaignInput };
