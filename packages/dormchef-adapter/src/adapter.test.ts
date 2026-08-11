import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DormChefLocalAdapter } from "./index.js";
import { isAllowedDormChefPath } from "./allowed-paths.js";
import { sanitizeDormChefAsset } from "./assets.js";

const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("DormChef source path policy", () => {
  it.each([".env", ".env.local", ".git/config", "server.log"])(
    "rejects sensitive path %s",
    (path) => expect(isAllowedDormChefPath(path)).toBe(false),
  );

  it.each([
    "README.md",
    "docs/DormChef-Demo到Agent-Beta-业务说明.md",
    "apps/miniprogram/app.json",
    "apps/miniprogram/pages/home/index.wxml",
  ])("allows explicit source path %s", (path) => {
    expect(isAllowedDormChefPath(path)).toBe(true);
  });

  it("limits selected screenshot directories to image files", () => {
    const options = { selectedScreenshotDirectories: ["screenshots"] };
    expect(isAllowedDormChefPath("screenshots/home.png", options)).toBe(true);
    expect(isAllowedDormChefPath("screenshots/server.log", options)).toBe(false);
    expect(isAllowedDormChefPath("screenshots/notes.json", options)).toBe(false);
  });

  it("extracts deterministic candidate facts with relative source locators", async () => {
    const root = await mkdtemp(join(tmpdir(), "social-agent-fixture-"));
    try {
      await writeFile(join(root, "README.md"), "# DormChef\n\n- 快速准备一人份晚餐\n- 支持按预算筛选菜谱\n", "utf8");
      const adapter = new DormChefLocalAdapter(root);
      const source = {
        id: "00000000-0000-4000-8000-000000000001",
        kind: "dormchef_local" as const,
        relativeLocator: "README.md",
      };

      const facts = await adapter.extractFacts(source);

      expect(facts).toHaveLength(2);
      expect(facts.every((fact) => fact.sourceLocator === "README.md")).toBe(true);
      expect(facts.every((fact) => fact.statement.length > 0 && fact.evidenceExcerpt.length > 0)).toBe(true);
      expect(facts.map((fact) => fact.statement)).toEqual([
        "快速准备一人份晚餐",
        "支持按预算筛选菜谱",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an escaping symlink without exposing the configured root", async () => {
    const root = await mkdtemp(join(tmpdir(), "social-agent-fixture-"));
    const outside = await mkdtemp(join(tmpdir(), "social-agent-outside-"));
    try {
      await writeFile(join(outside, "secret.md"), "# secret\n", "utf8");
      await symlink(join(outside, "secret.md"), join(root, "README.md"));
      const adapter = new DormChefLocalAdapter(root);
      const source = {
        id: "00000000-0000-4000-8000-000000000001",
        kind: "dormchef_local" as const,
        relativeLocator: "README.md",
      };

      await expect(adapter.extractFacts(source)).rejects.toThrow("SOURCE_SYMLINK_UNSAFE");
      await expect(adapter.extractFacts(source)).rejects.not.toThrow(root);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects source files larger than the configured byte limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "social-agent-fixture-"));
    try {
      await writeFile(join(root, "README.md"), "0123456789", "utf8");
      const adapter = new DormChefLocalAdapter(root, { maxFileBytes: 5 });
      const source = {
        id: "00000000-0000-4000-8000-000000000001",
        kind: "dormchef_local" as const,
        relativeLocator: "README.md",
      };

      await expect(adapter.extractFacts(source)).rejects.toThrow("SOURCE_FILE_TOO_LARGE");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("sanitizes decoded image bytes and rejects QR-bearing assets", async () => {
    const sanitized = await sanitizeDormChefAsset(ONE_BY_ONE_PNG, "apps/miniprogram/assets/mascot/logo.png", {
      qrScanner: async () => false,
    });

    expect(sanitized.mimeType).toBe("image/png");
    expect(sanitized.width).toBe(1);
    expect(sanitized.height).toBe(1);
    expect(sanitized.bytes).not.toEqual(ONE_BY_ONE_PNG);
    expect(sanitized.sha256).toMatch(/^[a-f0-9]{64}$/);

    await expect(sanitizeDormChefAsset(ONE_BY_ONE_PNG, "apps/miniprogram/assets/mascot/logo.png", {
      qrScanner: async () => true,
    })).rejects.toThrow("SOURCE_QR_CODE_DETECTED");
  });

  it("uses the built-in QR decoder when no scanner override is provided", async () => {
    await expect(sanitizeDormChefAsset(ONE_BY_ONE_PNG, "apps/miniprogram/assets/mascot/logo.png")).resolves.toMatchObject({
      mimeType: "image/png",
      width: 1,
      height: 1,
    });
  });

  it("hands sanitized source assets to the local sink with relative provenance", async () => {
    const root = await mkdtemp(join(tmpdir(), "social-agent-fixture-"));
    try {
      await mkdir(join(root, "apps/miniprogram/assets/mascot"), { recursive: true });
      await writeFile(join(root, "apps/miniprogram/assets/mascot/logo.png"), ONE_BY_ONE_PNG);
      const received: Array<{ relativeLocator: string; bytes: Buffer }> = [];
      const adapter = new DormChefLocalAdapter(root, {
        qrScanner: async () => false,
        assetSink: async ({ relativeLocator, sanitized }) => {
          received.push({ relativeLocator, bytes: sanitized.bytes });
        },
      });

      const assets = await adapter.collectAssets({
        id: "00000000-0000-4000-8000-000000000001",
        kind: "dormchef_local",
        relativeLocator: "apps/miniprogram/assets/mascot/logo.png",
      });

      expect(assets[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(received).toHaveLength(1);
      expect(received[0]?.relativeLocator).toBe("apps/miniprogram/assets/mascot/logo.png");
      expect(received[0]?.bytes).not.toEqual(ONE_BY_ONE_PNG);
      expect(received[0]?.relativeLocator).not.toContain(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
