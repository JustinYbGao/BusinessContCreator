export const DEFAULT_XHS_ORIGINS = Object.freeze(["https://creator.xiaohongshu.com"]);

export type NavigationDecision =
  | { allowed: true; origin: string }
  | { allowed: false; reason: "ORIGIN_NOT_ALLOWED" | "NON_HTTP_NAVIGATION" };

function normalizedOrigins(origins: readonly string[]): Set<string> {
  return new Set(origins.map((origin) => new URL(origin).origin));
}

export function assertAllowedNavigation(
  rawUrl: string,
  allowedOrigins: readonly string[] = DEFAULT_XHS_ORIGINS,
  allowFixture = false,
): NavigationDecision {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: "NON_HTTP_NAVIGATION" };
  }
  if (allowFixture && url.protocol === "file:") return { allowed: true, origin: "file:" };
  if (url.protocol !== "https:") return { allowed: false, reason: "NON_HTTP_NAVIGATION" };
  const allowed = normalizedOrigins(allowedOrigins).has(url.origin);
  return allowed
    ? { allowed: true, origin: url.origin }
    : { allowed: false, reason: "ORIGIN_NOT_ALLOWED" };
}

export function assertStorageOrigin(rawUrl: string, storageOrigin: string): URL {
  const url = new URL(rawUrl);
  if (url.origin !== new URL(storageOrigin).origin) throw new Error("STORAGE_ORIGIN_INVALID");
  if (url.protocol !== "https:") throw new Error("STORAGE_PROTOCOL_INVALID");
  return url;
}
