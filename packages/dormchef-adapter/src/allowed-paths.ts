const EXPLICIT_FILES = new Set([
  "README.md",
  "docs/DormChef-Demo到Agent-Beta-业务说明.md",
  "apps/miniprogram/app.json",
]);

export function normalizeDormChefPath(input: unknown): string | null {
  if (typeof input !== "string" || !input || input.includes("\u0000")) return null;

  const path = input.replaceAll("\\", "/");
  if (path.startsWith("/") || /^[A-Za-z]:\//.test(path)) return null;

  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  if (segments.some((segment) => segment === ".git" || segment.startsWith(".env"))) return null;

  return segments.join("/");
}

export type DormChefPathPolicyOptions = {
  selectedScreenshotDirectories?: readonly string[];
};

function startsInDirectory(path: string, directory: string): boolean {
  return path === directory || path.startsWith(`${directory}/`);
}

function isImagePath(path: string): boolean {
  return /\.(?:png|jpe?g|webp)$/i.test(path);
}

export function isAllowedDormChefPath(input: unknown, options: DormChefPathPolicyOptions = {}): boolean {
  const path = normalizeDormChefPath(input);
  if (!path) return false;
  if (EXPLICIT_FILES.has(path)) return true;
  if (path.startsWith("apps/miniprogram/pages/") && path.endsWith(".wxml")) return true;
  if (path.startsWith("apps/miniprogram/assets/mascot/")) return isImagePath(path);
  if (options.selectedScreenshotDirectories?.some((directory) => {
    const normalizedDirectory = normalizeDormChefPath(directory);
    return normalizedDirectory ? isImagePath(path) && startsInDirectory(path, normalizedDirectory) : false;
  })) return true;
  return false;
}

export function isAllowedDormChefAssetPath(input: unknown, options: DormChefPathPolicyOptions = {}): boolean {
  const path = normalizeDormChefPath(input);
  if (!path) return false;
  return (path.startsWith("apps/miniprogram/assets/mascot/") && isImagePath(path))
    || options.selectedScreenshotDirectories?.some((directory) => {
      const normalizedDirectory = normalizeDormChefPath(directory);
      return normalizedDirectory ? isImagePath(path) && startsInDirectory(path, normalizedDirectory) : false;
    }) === true;
}
