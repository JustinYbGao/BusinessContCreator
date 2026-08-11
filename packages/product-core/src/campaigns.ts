import { CampaignCreateInputSchema, type CampaignCreateInput } from "@social-agent/contracts";

const DAY_MS = 24 * 60 * 60 * 1_000;

function parseDate(value: string): number | null {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  return parsed.getTime();
}

export function validateCampaignWindow(input: CampaignCreateInput): CampaignCreateInput {
  const startsAt = parseDate(input.startsOn);
  const endsAt = parseDate(input.endsOn);
  if (startsAt === null || endsAt === null || (endsAt - startsAt) / DAY_MS !== 27) {
    throw new Error("INVALID_CAMPAIGN_INPUT");
  }
  const { pain_solution, product_proof, region_timing, founder_story } = input.pillarQuotas;
  if (pain_solution !== 5 || product_proof !== 4 || region_timing !== 2 || founder_story !== 1) {
    throw new Error("INVALID_CAMPAIGN_INPUT");
  }
  return input;
}

export function validateCampaignInput(input: unknown): CampaignCreateInput {
  const parsed = CampaignCreateInputSchema.safeParse(input);
  if (!parsed.success) throw new Error("INVALID_CAMPAIGN_INPUT");
  return validateCampaignWindow(parsed.data);
}
