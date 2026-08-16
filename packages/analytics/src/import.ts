import { createHash } from "node:crypto";
import {
  MetricImportRowSchema,
  type MetricImportRow,
} from "./metrics.js";

export const IMPORT_LIMITS = {
  maxBytes: 1_000_000,
  maxRows: 1_000,
} as const;

export type ImportErrorCode =
  | "IMPORT_TOO_LARGE"
  | "ROW_LIMIT_EXCEEDED"
  | "INVALID_JSON"
  | "INVALID_CSV"
  | "UNKNOWN_COLUMN"
  | "DUPLICATE_HEADER"
  | "FORMULA_LIKE_VALUE"
  | "INVALID_ROW"
  | "INVALID_UUID"
  | "INVALID_WINDOW"
  | "INVALID_TIMESTAMP"
  | "INVALID_METRIC"
  | "INVALID_CONVERSION"
  | "DUPLICATE_WINDOW";

export type ImportError = {
  code: ImportErrorCode;
  row: number;
  column: string | null;
  message: string;
};

export type ParsedMetricImport = {
  format: "manual" | "json" | "csv";
  filenameSha256: string | null;
  rows: MetricImportRow[];
  errors: ImportError[];
};

export type ParseMetricImportInput = {
  format: "manual" | "json" | "csv";
  body: unknown;
  now?: Date;
};

const CSV_COLUMNS = [
  "workspaceId",
  "productId",
  "publicationId",
  "window",
  "capturedAt",
  "impressions",
  "views",
  "likes",
  "saves",
  "comments",
  "shares",
  "followersGained",
  "productConversion",
] as const;

type RawCsv = {
  rows: string[][];
  errors: ImportError[];
};

function error(
  code: ImportErrorCode,
  row: number,
  column: string | null,
  message: string,
): ImportError {
  return { code, row, column, message };
}

function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function formulaLike(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && ["=", "+", "-", "@"].some((prefix) => trimmed.startsWith(prefix));
}

function parseCsv(text: string): RawCsv {
  const rows: string[][] = [];
  const errors: ImportError[] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let justClosedQuote = false;

  const pushField = () => {
    row.push(field);
    field = "";
    justClosedQuote = false;
  };

  const pushRow = () => {
    if (row.length > 0 || field.length > 0) {
      pushField();
      if (row.some((cell) => cell.length > 0)) rows.push(row);
    }
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === undefined) continue;

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          justClosedQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (justClosedQuote) {
      if (character === ',') {
        pushField();
        continue;
      }
      if (character === '\n') {
        pushRow();
        continue;
      }
      if (character === '\r' && text[index + 1] === '\n') {
        pushRow();
        index += 1;
        continue;
      }
      errors.push(error("INVALID_CSV", rows.length + 2, null, "characters after a quoted field are not allowed"));
      justClosedQuote = false;
      field += character;
      continue;
    }

    if (character === '"' && field.length === 0) {
      inQuotes = true;
      continue;
    }
    if (character === ',') {
      pushField();
      continue;
    }
    if (character === '\n') {
      pushRow();
      continue;
    }
    if (character === '\r') {
      if (text[index + 1] !== '\n') {
        errors.push(error("INVALID_CSV", rows.length + 2, null, "bare carriage returns are not allowed"));
        continue;
      }
      pushRow();
      index += 1;
      continue;
    }
    field += character;
  }

  if (inQuotes) {
    errors.push(error("INVALID_CSV", rows.length + 2, null, "unterminated quoted field"));
  } else if (row.length > 0 || field.length > 0 || justClosedQuote) {
    pushRow();
  }

  return { rows, errors };
}

function rowsFromJson(body: unknown, format: "manual" | "json"): { rows: unknown[]; errors: ImportError[]; hash: string | null } {
  let value = body;
  let hash: string | null = null;
  if (typeof body === "string") {
    const bytes = textBytes(body);
    hash = sha256(bytes);
    try {
      value = JSON.parse(body.replace(/^\ufeff/, "")) as unknown;
    } catch {
      return { rows: [], errors: [error("INVALID_JSON", 1, null, "body is not valid JSON")], hash };
    }
  }

  if (Array.isArray(value)) return { rows: value, errors: [], hash };
  if (typeof value === "object" && value !== null && "rows" in value) {
    const candidate = (value as { rows?: unknown }).rows;
    if (Array.isArray(candidate)) return { rows: candidate, errors: [], hash };
  }
  return {
    rows: [],
    errors: [error(format === "json" ? "INVALID_JSON" : "INVALID_ROW", 1, null, "expected an array or an object with rows")],
    hash,
  };
}

function parseInteger(value: string, row: number, column: string, errors: ImportError[], nullable = false): number | null {
  if (formulaLike(value)) {
    errors.push(error("FORMULA_LIKE_VALUE", row, column, "formula-like values are rejected"));
    return null;
  }
  if (nullable && value.trim() === "") return null;
  if (!/^\d+$/.test(value.trim())) {
    errors.push(error("INVALID_METRIC", row, column, "expected a non-negative integer"));
    return null;
  }
  return Number(value);
}

function parseCsvRows(text: string): { rows: unknown[]; errors: ImportError[]; hash: string } {
  const bytes = textBytes(text);
  const hash = sha256(bytes);
  const parsed = parseCsv(text.replace(/^\ufeff/, ""));
  const errors = [...parsed.errors];
  const [header, ...dataRows] = parsed.rows;
  if (!header) {
    errors.push(error("INVALID_CSV", 1, null, "CSV header is required"));
    return { rows: [], errors, hash };
  }

  const normalizedHeaders = header.map((value) => value.trim());
  const seen = new Set<string>();
  for (const column of normalizedHeaders) {
    if (seen.has(column)) errors.push(error("DUPLICATE_HEADER", 1, column || null, "duplicate CSV header"));
    seen.add(column);
    if (!(CSV_COLUMNS as readonly string[]).includes(column)) {
      errors.push(error("UNKNOWN_COLUMN", 1, column || null, "unknown CSV header"));
    }
  }
  if (errors.length > 0) return { rows: [], errors, hash };

  const rows: unknown[] = [];
  dataRows.forEach((cells, dataIndex) => {
    const rowNumber = dataIndex + 2;
    if (cells.length !== normalizedHeaders.length) {
      errors.push(error("INVALID_ROW", rowNumber, null, "CSV column count does not match the header"));
      return;
    }
    const values = new Map(normalizedHeaders.map((column, index) => [column, cells[index] ?? ""]));
    const rowValues: Record<string, unknown> = {};
    for (const column of normalizedHeaders) {
      const value = values.get(column) ?? "";
      if (formulaLike(value)) {
        errors.push(error("FORMULA_LIKE_VALUE", rowNumber, column, "formula-like values are rejected"));
      }
    }
    const metrics = {
      impressions: parseInteger(values.get("impressions") ?? "", rowNumber, "impressions", errors, true),
      views: parseInteger(values.get("views") ?? "", rowNumber, "views", errors, true),
      likes: parseInteger(values.get("likes") ?? "", rowNumber, "likes", errors),
      saves: parseInteger(values.get("saves") ?? "", rowNumber, "saves", errors),
      comments: parseInteger(values.get("comments") ?? "", rowNumber, "comments", errors),
      shares: parseInteger(values.get("shares") ?? "", rowNumber, "shares", errors),
      followersGained: parseInteger(values.get("followersGained") ?? "", rowNumber, "followersGained", errors),
    };
    let productConversion: unknown = [];
    const conversionText = values.get("productConversion") ?? "";
    if (conversionText.trim() !== "") {
      try {
        productConversion = JSON.parse(conversionText) as unknown;
      } catch {
        errors.push(error("INVALID_CONVERSION", rowNumber, "productConversion", "expected JSON"));
      }
    }
    const capturedAt = values.get("capturedAt")?.trim();
    Object.assign(rowValues, {
      workspaceId: values.get("workspaceId"),
      productId: values.get("productId"),
      publicationId: values.get("publicationId"),
      window: values.get("window"),
      capturedAt: capturedAt || undefined,
      metrics,
      productConversion,
    });
    rows.push(rowValues);
  });
  return { rows, errors, hash };
}

function normalizeRow(raw: unknown, rowNumber: number, now: Date, errors: ImportError[]): MetricImportRow | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    errors.push(error("INVALID_ROW", rowNumber, null, "row must be an object"));
    return null;
  }
  const candidate = { ...(raw as Record<string, unknown>) };
  if (candidate.capturedAt === undefined) candidate.capturedAt = now.toISOString();
  const result = MetricImportRowSchema.safeParse(candidate);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path[0];
      const code: ImportErrorCode = path === "window"
        ? "INVALID_WINDOW"
        : path === "capturedAt"
          ? "INVALID_TIMESTAMP"
          : path === "workspaceId" || path === "productId" || path === "publicationId"
            ? "INVALID_UUID"
            : path === "metrics" || (typeof path === "string" && ["impressions", "views", "likes", "saves", "comments", "shares", "followersGained"].includes(path))
              ? "INVALID_METRIC"
              : path === "productConversion"
                ? "INVALID_CONVERSION"
                : "INVALID_ROW";
      errors.push(error(code, rowNumber, typeof path === "string" ? path : null, issue.message));
    }
    return null;
  }
  return result.data;
}

export function parseMetricImport(input: ParseMetricImportInput): ParsedMetricImport {
  const now = input.now ?? new Date();
  const textBody = typeof input.body === "string" ? input.body : null;
  const bytes = textBody === null ? null : textBytes(textBody);
  if (bytes && bytes.byteLength > IMPORT_LIMITS.maxBytes) {
    return {
      format: input.format,
      filenameSha256: sha256(bytes),
      rows: [],
      errors: [error("IMPORT_TOO_LARGE", 1, null, "import exceeds the byte limit")],
    };
  }

  let rawRows: unknown[];
  let errors: ImportError[];
  let filenameSha256: string | null = null;
  if (input.format === "csv") {
    if (typeof input.body !== "string") {
      return { format: input.format, filenameSha256: null, rows: [], errors: [error("INVALID_CSV", 1, null, "CSV body must be text")] };
    }
    const parsed = parseCsvRows(input.body);
    rawRows = parsed.rows;
    errors = parsed.errors;
    filenameSha256 = parsed.hash;
  } else {
    const parsed = rowsFromJson(input.body, input.format);
    rawRows = parsed.rows;
    errors = parsed.errors;
    filenameSha256 = parsed.hash;
  }

  if (rawRows.length > IMPORT_LIMITS.maxRows) {
    errors.push(error("ROW_LIMIT_EXCEEDED", IMPORT_LIMITS.maxRows + 2, null, "import exceeds the row limit"));
  }
  if (errors.length > 0) return { format: input.format, filenameSha256, rows: [], errors };

  const rows: MetricImportRow[] = [];
  rawRows.forEach((raw, index) => {
    const normalized = normalizeRow(raw, index + 2, now, errors);
    if (normalized) rows.push(normalized);
  });

  const seenWindows = new Set<string>();
  for (const row of rows) {
    const key = `${row.publicationId}:${row.window}`;
    if (seenWindows.has(key)) {
      errors.push(error("DUPLICATE_WINDOW", 0, "window", "publication already has this metric window"));
    }
    seenWindows.add(key);
  }
  if (errors.length > 0) return { format: input.format, filenameSha256, rows: [], errors };
  return { format: input.format, filenameSha256, rows, errors: [] };
}
