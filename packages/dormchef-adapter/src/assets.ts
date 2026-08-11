import { createHash } from "node:crypto";
import * as jsQRModule from "jsqr";
import sharp from "sharp";

export const DEFAULT_MAX_ASSET_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_ASSET_PIXELS = 100_000_000;

export type DormChefAssetMimeType = "image/png" | "image/jpeg" | "image/webp";

export type DormChefAssetScanOptions = {
  maxAssetBytes?: number;
  maxPixels?: number;
  qrScanner?: (input: { bytes: Buffer; mimeType: DormChefAssetMimeType }) => boolean | Promise<boolean>;
};

export type SanitizedDormChefAsset = {
  bytes: Buffer;
  mimeType: "image/png";
  width: number;
  height: number;
  sha256: string;
};

export class DormChefAssetError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "DormChefAssetError";
  }
}

type QRDecoder = (data: Uint8ClampedArray, width: number, height: number, options: { inversionAttempts: "attemptBoth" }) => unknown;

function assetError(code: string): DormChefAssetError {
  return new DormChefAssetError(code);
}

async function scanDormChefQrCode(bytes: Buffer, maxPixels: number): Promise<boolean> {
  const decoded = await sharp(bytes, {
    limitInputPixels: maxPixels,
    failOn: "error",
  })
    .resize({ width: 1_600, height: 1_600, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = new Uint8ClampedArray(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength);
  const jsQR = (jsQRModule as unknown as { default: QRDecoder }).default;
  return Boolean(jsQR(pixels, decoded.info.width, decoded.info.height, { inversionAttempts: "attemptBoth" }));
}

export function detectDormChefImageMime(bytes: Buffer): DormChefAssetMimeType | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "image/jpeg";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export async function sanitizeDormChefAsset(
  bytes: Buffer,
  _relativeLocator: string,
  options: DormChefAssetScanOptions = {},
): Promise<SanitizedDormChefAsset> {
  const maxAssetBytes = options.maxAssetBytes ?? DEFAULT_MAX_ASSET_BYTES;
  const maxPixels = options.maxPixels ?? DEFAULT_MAX_ASSET_PIXELS;
  if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes < 1) throw assetError("SOURCE_ASSET_TOO_LARGE");
  if (!Number.isSafeInteger(maxPixels) || maxPixels < 1) throw assetError("SOURCE_ASSET_DIMENSIONS_INVALID");
  if (bytes.length === 0) throw assetError("SOURCE_ASSET_EMPTY");
  if (bytes.length > maxAssetBytes) throw assetError("SOURCE_ASSET_TOO_LARGE");

  const mimeType = detectDormChefImageMime(bytes);
  if (!mimeType) throw assetError("SOURCE_ASSET_FORMAT_UNSUPPORTED");
  let qrDetected: boolean;
  try {
    qrDetected = await (options.qrScanner ?? ((input) => scanDormChefQrCode(input.bytes, maxPixels)))({ bytes, mimeType });
  } catch {
    throw assetError("SOURCE_QR_SCAN_FAILED");
  }
  if (qrDetected) throw assetError("SOURCE_QR_CODE_DETECTED");

  try {
    const normalized = await sharp(bytes, {
      limitInputPixels: maxPixels,
      failOn: "error",
    })
      .rotate()
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer({ resolveWithObject: true });

    if (normalized.data.length === 0 || normalized.data.length > maxAssetBytes) {
      throw assetError("SOURCE_ASSET_TOO_LARGE");
    }
    const width = normalized.info.width;
    const height = normalized.info.height;
    if (!width || !height) throw assetError("SOURCE_ASSET_DIMENSIONS_INVALID");
    return {
      bytes: normalized.data,
      mimeType: "image/png",
      width,
      height,
      sha256: createHash("sha256").update(normalized.data).digest("hex"),
    };
  } catch (error) {
    if (error instanceof DormChefAssetError) throw error;
    throw assetError("SOURCE_ASSET_DECODE_FAILED");
  }
}
