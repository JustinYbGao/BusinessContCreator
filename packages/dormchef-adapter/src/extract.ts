import { constants } from "node:fs";
import { access, open, readdir, realpath, stat, type FileHandle } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import type {
  ProductAssetCandidate,
  ProductFactCandidate,
  ProductSourceDescriptor,
} from "@social-agent/contracts";
import { ProductFactCandidateSchema } from "@social-agent/contracts";
import {
  isAllowedDormChefAssetPath,
  isAllowedDormChefPath,
  normalizeDormChefPath,
  type DormChefPathPolicyOptions,
} from "./allowed-paths.js";
import {
  sanitizeDormChefAsset,
  type SanitizedDormChefAsset,
  type DormChefAssetScanOptions,
} from "./assets.js";

export const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;

export class DormChefSourceError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "DormChefSourceError";
  }
}

export type DormChefReadOptions = DormChefPathPolicyOptions & DormChefAssetScanOptions & {
  maxFileBytes?: number;
  assetSink?: DormChefAssetSink;
};

export type DormChefAssetSinkInput = {
  source: ProductSourceDescriptor;
  relativeLocator: string;
  kind: ProductAssetCandidate["kind"];
  sanitized: SanitizedDormChefAsset;
};

export type DormChefAssetSink = (input: DormChefAssetSinkInput) => Promise<void>;

export type SafeDormChefFile = {
  relativeLocator: string;
  bytes: Buffer;
};

function isWithinRoot(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation !== "" && !relation.startsWith("..") && !relation.startsWith("/") && !relation.includes("\\");
}

function sourceError(code: string): DormChefSourceError {
  return new DormChefSourceError(code);
}

async function readHandleWithLimit(handle: FileHandle, maxFileBytes: number): Promise<Buffer> {
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 0) throw sourceError("SOURCE_FILE_TOO_LARGE");

  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const buffer = Buffer.alloc(Math.min(64 * 1024, maxFileBytes - total + 1));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
    if (bytesRead === 0) break;
    if (total + bytesRead > maxFileBytes) throw sourceError("SOURCE_FILE_TOO_LARGE");
    chunks.push(buffer.subarray(0, bytesRead));
    total += bytesRead;
  }
  return Buffer.concat(chunks, total);
}

async function configuredRoot(root: string): Promise<string> {
  try {
    return await realpath(root);
  } catch {
    throw sourceError("SOURCE_ROOT_UNAVAILABLE");
  }
}

export async function readSafeDormChefFile(
  root: string,
  inputPath: string,
  options: DormChefReadOptions = {},
): Promise<SafeDormChefFile> {
  const relativeLocator = normalizeDormChefPath(inputPath);
  if (!relativeLocator || !isAllowedDormChefPath(relativeLocator, options)) {
    throw sourceError("SOURCE_NOT_ALLOWED");
  }

  const rootPath = await configuredRoot(root);
  const candidatePath = resolve(rootPath, ...relativeLocator.split("/"));
  if (!isWithinRoot(rootPath, candidatePath)) throw sourceError("SOURCE_OUTSIDE_ROOT");

  let realCandidatePath: string;
  try {
    realCandidatePath = await realpath(candidatePath);
  } catch {
    throw sourceError("SOURCE_NOT_FOUND");
  }
  if (!isWithinRoot(rootPath, realCandidatePath)) throw sourceError("SOURCE_SYMLINK_UNSAFE");

  const noFollow = (constants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;
  let handle;
  try {
    handle = await open(candidatePath, constants.O_RDONLY | noFollow);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") throw sourceError("SOURCE_SYMLINK_UNSAFE");
    throw sourceError("SOURCE_NOT_READABLE");
  }

  try {
    let fileStats;
    try {
      const openedRealPath = await realpath(candidatePath);
      const expectedStats = await stat(realCandidatePath);
      fileStats = await handle.stat();
      if (openedRealPath !== realCandidatePath || fileStats.dev !== expectedStats.dev || fileStats.ino !== expectedStats.ino) {
        throw sourceError("SOURCE_SYMLINK_UNSAFE");
      }
    } catch (error) {
      if (error instanceof DormChefSourceError) throw error;
      throw sourceError("SOURCE_SYMLINK_UNSAFE");
    }
    if (!fileStats.isFile()) throw sourceError("SOURCE_NOT_REGULAR");
    const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    if (fileStats.size > maxFileBytes) throw sourceError("SOURCE_FILE_TOO_LARGE");
    return { relativeLocator, bytes: await readHandleWithLimit(handle, maxFileBytes) };
  } finally {
    await handle.close();
  }
}

async function addIfPresent(rootPath: string, inputPath: string, paths: Set<string>): Promise<void> {
  try {
    const candidatePath = resolve(rootPath, ...inputPath.split("/"));
    const realCandidatePath = await realpath(candidatePath);
    if (!isWithinRoot(rootPath, realCandidatePath)) return;
    await access(candidatePath);
    paths.add(inputPath);
  } catch {
    // A missing optional source is not an adapter failure.
  }
}

async function walkAllowedDirectory(
  rootPath: string,
  directory: string,
  options: DormChefPathPolicyOptions,
  paths: Set<string>,
): Promise<void> {
  const directoryPath = resolve(rootPath, ...directory.split("/"));
  let entries;
  try {
    const realDirectoryPath = await realpath(directoryPath);
    if (!isWithinRoot(rootPath, realDirectoryPath)) return;
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const childPath = `${directory}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      if (isAllowedDormChefPath(childPath, options)) paths.add(childPath);
      continue;
    }
    if (entry.isDirectory()) {
      await walkAllowedDirectory(rootPath, childPath, options, paths);
    } else if (entry.isFile() && isAllowedDormChefPath(childPath, options)) {
      paths.add(childPath);
    }
  }
}

export async function discoverAllowedDormChefPaths(
  root: string,
  options: DormChefPathPolicyOptions = {},
): Promise<string[]> {
  const rootPath = await configuredRoot(root);
  const paths = new Set<string>();
  for (const explicitPath of [
    "README.md",
    "docs/DormChef-Demo到Agent-Beta-业务说明.md",
    "apps/miniprogram/app.json",
  ]) {
    await addIfPresent(rootPath, explicitPath, paths);
  }
  for (const directory of [
    "apps/miniprogram/pages",
    "apps/miniprogram/assets/mascot",
    ...(options.selectedScreenshotDirectories ?? []),
  ]) {
    const normalized = normalizeDormChefPath(directory);
    if (normalized) await walkAllowedDirectory(rootPath, normalized, options, paths);
  }
  return [...paths].sort();
}

function cleanText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function categoryFor(context: string, statement: string): ProductFactCandidate["category"] {
  const value = `${context} ${statement}`.toLowerCase();
  if (/价格|收费|定价|price|cost/.test(value)) return "price";
  if (/限制|约束|不能|不支持|constraint|limit/.test(value)) return "constraint";
  if (/定位|简介|是什么|适合|概述|position|overview/.test(value)) return "positioning";
  if (/数据|用户|下载|指标|data|metric|user/.test(value)) return "data";
  if (/状态|上线|测试|beta|status|release/.test(value)) return "status";
  return "feature";
}

function fact(statement: string, evidence: string, context: string, sourceLocator: string): ProductFactCandidate | null {
  const cleanStatement = cleanText(statement);
  if (!cleanStatement) return null;
  const normalizedLocator = normalizeDormChefPath(sourceLocator);
  if (!normalizedLocator) return null;
  const parsed = ProductFactCandidateSchema.safeParse({
    statement: cleanStatement,
    category: categoryFor(context, cleanStatement),
    sourceLocator: normalizedLocator,
    evidenceExcerpt: cleanText(evidence).slice(0, 500),
  });
  return parsed.success ? parsed.data : null;
}

function extractMarkdownFacts(content: string, sourceLocator: string): ProductFactCandidate[] {
  const facts: ProductFactCandidate[] = [];
  let heading = "";
  let paragraph: string[] = [];
  let paragraphEvidence: string[] = [];
  let fenced = false;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      const candidate = fact(paragraph.join(" "), [heading, ...paragraphEvidence].filter(Boolean).join(" "), heading, sourceLocator);
      if (candidate) facts.push(candidate);
      paragraph = [];
      paragraphEvidence = [];
    }
  };

  for (const line of content.replace(/\r\n?/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      flushParagraph();
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const headingMatch = trimmed.match(/^#{1,6}\s+(.+?)\s*#*$/);
    if (headingMatch) {
      flushParagraph();
      heading = cleanText(headingMatch[1] ?? "");
      continue;
    }
    const listMatch = trimmed.match(/^(?:[-*+]\s+|\d+[.)]\s+)(.+)$/);
    if (listMatch) {
      flushParagraph();
      const candidate = fact(listMatch[1] ?? "", [heading, listMatch[1] ?? ""].filter(Boolean).join(" "), heading, sourceLocator);
      if (candidate) facts.push(candidate);
      continue;
    }
    if (!trimmed) {
      flushParagraph();
      continue;
    }
    paragraph.push(trimmed);
    paragraphEvidence.push(trimmed);
  }
  flushParagraph();
  return facts;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractWxmlFacts(content: string, sourceLocator: string): ProductFactCandidate[] {
  const visible = decodeXmlText(content
    .replace(/<!--[\s\S]*?-->/g, "\n")
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<[^>]+>/g, "\n"));
  return visible
    .split(/\r?\n|[。！？；]/)
    .map((line) => fact(line, line, "", sourceLocator))
    .filter((candidate): candidate is ProductFactCandidate => candidate !== null);
}

const JSON_FACT_KEYS = new Set(["name", "title", "description", "slogan", "feature", "positioning", "price", "status"]);

function extractJsonFacts(content: string, sourceLocator: string): ProductFactCandidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw sourceError("SOURCE_JSON_INVALID");
  }

  const facts: ProductFactCandidate[] = [];
  const visit = (value: unknown, context: string) => {
    if (typeof value === "string" && JSON_FACT_KEYS.has(context.toLowerCase())) {
      const candidate = fact(value, `${context}: ${value}`, context, sourceLocator);
      if (candidate) facts.push(candidate);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, context);
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) visit(item, key);
    }
  };
  visit(parsed, "");
  return facts;
}

export function extractFactsFromSource(content: Buffer, sourceLocator: string): ProductFactCandidate[] {
  const text = content.toString("utf8");
  switch (extname(sourceLocator).toLowerCase()) {
    case ".md":
      return extractMarkdownFacts(text, sourceLocator);
    case ".wxml":
      return extractWxmlFacts(text, sourceLocator);
    case ".json":
      return extractJsonFacts(text, sourceLocator);
    default:
      return [];
  }
}

export async function readFactsForSource(
  root: string,
  source: ProductSourceDescriptor,
  options: DormChefReadOptions = {},
): Promise<ProductFactCandidate[]> {
  const file = await readSafeDormChefFile(root, source.relativeLocator, options);
  return extractFactsFromSource(file.bytes, file.relativeLocator);
}

export async function collectAssetForSource(
  root: string,
  source: ProductSourceDescriptor,
  options: DormChefReadOptions = {},
): Promise<ProductAssetCandidate[]> {
  if (!isAllowedDormChefAssetPath(source.relativeLocator, options)) return [];
  const file = await readSafeDormChefFile(root, source.relativeLocator, options);
  const kind = file.relativeLocator.startsWith("apps/miniprogram/assets/mascot/") ? "brand_asset" : "screenshot";
  const sanitized = await sanitizeDormChefAsset(file.bytes, file.relativeLocator, options);
  if (options.assetSink) {
    await options.assetSink({ source, relativeLocator: file.relativeLocator, kind, sanitized });
  }
  return [{ relativeLocator: file.relativeLocator, kind, sha256: sanitized.sha256 }];
}
