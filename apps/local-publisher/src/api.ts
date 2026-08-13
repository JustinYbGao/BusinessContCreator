import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PublisherClaimResponse } from "@social-agent/contracts";
import { assertStorageOrigin, validatePngBytes, validatePublisherClaim } from "@social-agent/xhs-adapter";

export type PublisherStatus = "READY_TO_PREFILL" | "NEEDS_LOGIN" | "PREFILL_FAILED" | "AWAITING_HUMAN_PUBLISH";

export interface DownloadedClaimImages {
  directory: string;
  paths: string[];
  cleanup(): Promise<void>;
}

export interface PublisherApiOptions {
  baseUrl: string;
  token: string;
  storageOrigin: string;
  fetchImpl?: typeof fetch;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export class PublisherApi {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly storageOrigin: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: PublisherApiOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.storageOrigin = new URL(options.storageOrigin).origin;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private headers(): HeadersInit {
    return { authorization: `Bearer ${this.token}`, "cache-control": "no-store" };
  }

  async claim(): Promise<PublisherClaimResponse | null> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/publisher/jobs/claim`, {
      method: "POST",
      headers: this.headers(),
    });
    if (response.status === 204) return null;
    if (!response.ok) throw new Error(`PUBLISHER_CLAIM_FAILED_${response.status}`);
    return validatePublisherClaim(await response.json());
  }

  async updateStatus(
    publicationId: string,
    status: PublisherStatus,
    options: { failureReason?: string; screenshotPath?: string } = {},
  ): Promise<void> {
    const headers = this.headers();
    if (!options.screenshotPath) {
      const response = await this.fetchImpl(`${this.baseUrl}/api/publisher/jobs/${publicationId}/status`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ status, failureReason: options.failureReason }),
      });
      if (!response.ok) throw new Error(`PUBLISHER_STATUS_FAILED_${response.status}`);
      return;
    }

    const form = new FormData();
    form.set("status", status);
    if (options.failureReason) form.set("failureReason", options.failureReason);
    const bytes = await readFile(options.screenshotPath);
    form.set("screenshot", new Blob([bytes], { type: "image/png" }), "prefill.png");
    const response = await this.fetchImpl(`${this.baseUrl}/api/publisher/jobs/${publicationId}/status`, {
      method: "POST",
      headers,
      body: form,
    });
    if (!response.ok) throw new Error(`PUBLISHER_STATUS_FAILED_${response.status}`);
  }

  async downloadClaimImages(claim: PublisherClaimResponse): Promise<DownloadedClaimImages> {
    if (claim.imageDownloadUrls.length !== 7 || claim.imageSha256.length !== 7) {
      throw new Error("IMAGE_COUNT_INVALID");
    }
    const directory = await mkdtemp(join(tmpdir(), "social-agent-publisher-"));
    await chmod(directory, 0o700);
    const paths: string[] = [];
    try {
      for (const [index, rawUrl] of claim.imageDownloadUrls.entries()) {
        const url = assertStorageOrigin(rawUrl, this.storageOrigin);
        const response = await this.fetchImpl(url, { redirect: "manual", headers: { accept: "image/png" } });
        if (response.redirected || (response.status >= 300 && response.status < 400)) throw new Error("IMAGE_REDIRECT_REJECTED");
        if (!response.ok || new URL(response.url || url.href).origin !== this.storageOrigin) {
          throw new Error("IMAGE_DOWNLOAD_FAILED");
        }
        const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
        const bytes = new Uint8Array(await response.arrayBuffer());
        const expectedSha256 = claim.imageSha256[index];
        if (!expectedSha256) throw new Error("IMAGE_HASH_MISSING");
        const metadata = validatePngBytes({ bytes, contentType, expectedSha256 });
        if (metadata.sha256 !== sha256(bytes)) throw new Error("IMAGE_SHA256_MISMATCH");
        const path = join(directory, `page-${index + 1}.png`);
        await writeFile(path, bytes, { mode: 0o600 });
        await chmod(path, 0o600);
        paths.push(path);
      }
      return {
        directory,
        paths,
        cleanup: async () => { await rm(directory, { recursive: true, force: true }); },
      };
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }
}
