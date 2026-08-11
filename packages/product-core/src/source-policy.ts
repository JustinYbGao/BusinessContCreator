export class ProductSourcePolicyError extends Error {
  constructor(public readonly code: "SOURCE_LOCATOR_INVALID" | "SOURCE_LOCATOR_ABSOLUTE" | "SOURCE_LOCATOR_ESCAPES_ROOT") {
    super(code);
    this.name = "ProductSourcePolicyError";
  }
}

function normalizeLocator(input: unknown): string | null {
  if (typeof input !== "string" || input.length === 0 || input.includes("\0")) return null;
  const normalized = input.replaceAll("\\", "/").trim();
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return null;
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  if (segments.some((segment) => segment === ".git" || segment.startsWith(".env"))) return null;
  return segments.join("/");
}

export function normalizeProductSourceLocator(input: unknown): string {
  const normalized = normalizeLocator(input);
  if (!normalized) throw new ProductSourcePolicyError("SOURCE_LOCATOR_INVALID");
  return normalized;
}

export function normalizeDormChefSourceLocator(input: unknown): string {
  const normalized = normalizeLocator(input);
  if (!normalized) throw new ProductSourcePolicyError("SOURCE_LOCATOR_INVALID");
  return normalized;
}

export function assertProductSourceLocator(input: unknown): asserts input is string {
  normalizeProductSourceLocator(input);
}

export function isPubliclyUsableFact(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const fact = input as Record<string, unknown>;
  return fact.status === "verified"
    && fact.publicUseAllowed === true
    && typeof fact.verifiedBy === "string"
    && fact.verifiedBy.length > 0
    && typeof fact.verifiedAt === "string"
    && fact.verifiedAt.length > 0;
}

export function isPubliclyUsableAsset(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const asset = input as Record<string, unknown>;
  return asset.verificationStatus === "verified"
    && asset.publicUseAllowed === true
    && typeof asset.verifiedBy === "string"
    && asset.verifiedBy.length > 0
    && typeof asset.verifiedAt === "string"
    && asset.verifiedAt.length > 0;
}
