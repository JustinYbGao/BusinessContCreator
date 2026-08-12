import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PublicationPackageSchema, type Publication } from "@social-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { renderCarousel } from "./render.js";
import * as visualValidation from "./validate.js";
import { persistRenderedCarousel } from "./validate.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000002";
const contentVersionId = "00000000-0000-4000-8000-000000000003";
const sourceAssetId = "00000000-0000-4000-8000-000000000004";
const productScreen = await readFile(
  new URL("../../test-support/fixtures/product-screen.png", import.meta.url),
);
const publicationRoutePath = new URL(
  "../../../apps/web/src/app/api/publications/route.ts",
  import.meta.url,
).href;
const publicationServerModulePath = new URL(
  "../../../apps/web/src/lib/supabase/server.ts",
  import.meta.url,
).href;
const publicationPackage = {
  publicationId: "00000000-0000-4000-8000-000000000005",
  contentVersionId,
  title: "一周宿舍菜单",
  body: "七页可执行菜单",
  imageObjectKeys: Array.from({ length: 7 }, (_, index) => `page-${index + 1}.png`),
  imageSha256: Array.from({ length: 7 }, (_, index) => String(index + 1).repeat(64)),
  contentSha256: "a".repeat(64),
};
const publication: Publication = {
  id: publicationPackage.publicationId,
  workspaceId,
  productId,
  status: "READY_TO_PREFILL",
  package: publicationPackage,
};

interface PublicationRouteState {
  existing: Publication | null;
  created: Publication;
  creationIdempotencyKey: string | null;
  rpcCalls: Array<Record<string, unknown>>;
}

function publicationRow(value: Publication) {
  return {
    id: value.id,
    workspace_id: value.workspaceId,
    product_id: value.productId,
    status: value.status,
    package: value.package,
  };
}

function fakePublicationSupabase(state: PublicationRouteState) {
  return {
    async rpc(_name: string, input: Record<string, unknown>) {
      state.rpcCalls.push(input);
      return { data: publicationRow(state.created), error: null };
    },
    from(table: string) {
      const builder = {
        select(_columns: string) {
          return builder;
        },
        eq(_column: string, _value: unknown) {
          return builder;
        },
        limit(_count: number) {
          return builder;
        },
        async maybeSingle() {
          if (table === "publications") {
            return {
              data: state.existing ? publicationRow(state.existing) : null,
              error: null,
            };
          }
          return {
            data: state.creationIdempotencyKey === null
              ? null
              : { request_id: state.creationIdempotencyKey },
            error: null,
          };
        },
      };
      return builder;
    },
  };
}

async function loadPublicationRoute(state: PublicationRouteState) {
  vi.resetModules();
  vi.doMock(publicationServerModulePath, () => ({
    async requireServerInternalAdmin() {
      return {
        workspaceId,
        userId: "00000000-0000-4000-8000-000000000006",
        email: "admin@example.invalid",
      };
    },
    createSupabaseServiceRoleClient() {
      return fakePublicationSupabase(state);
    },
  }));
  return import(publicationRoutePath);
}

function publicationRequest(idempotencyKey: string) {
  return new Request("http://localhost/api/publications", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contentVersionId, idempotencyKey }),
  });
}

const pages = Array.from({ length: 7 }, (_, index) => ({
  page: index + 1,
  purpose: `第 ${index + 1} 页`,
  headline: `一周菜单第 ${index + 1} 步`,
  body: "按预算、时间和厨具整理真实可执行的做饭步骤。",
  sourceAssetId: index === 3 ? sourceAssetId : null,
}));

const fixtureInput = {
  workspaceId,
  productId,
  contentVersionId,
  pages,
  sourceAssets: [{
    id: sourceAssetId,
    workspaceId,
    productId,
    verificationStatus: "verified" as const,
    publicUseAllowed: true as const,
    mimeType: "image/png" as const,
    sha256: createHash("sha256").update(productScreen).digest("hex"),
    bytes: productScreen,
  }],
  sourceAssetResolver: {
    async resolveVerifiedSourceAsset(input: { assetId: string }) {
      return fixtureInput.sourceAssets.find((asset) => asset.id === input.assetId) ?? null;
    },
  },
  brand: {
    mark: "DORMCHEF",
    background: "#f7f3e8",
    foreground: "#173f32",
    accent: "#ee8c61",
  },
};

describe("seven-page visual contract", () => {
  it("exposes immutable carousel persistence", () => {
    expect(typeof Reflect.get(visualValidation, "persistRenderedCarousel")).toBe("function");
  });

  it("renders exactly seven 1080x1440 PNG files", async () => {
    const result = await renderCarousel(fixtureInput);

    expect(result).toHaveLength(7);
    for (const image of result) {
      expect(image.width).toBe(1080);
      expect(image.height).toBe(1440);
      expect(image.mimeType).toBe("image/png");
      expect(image.buffer.subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
    }
  });

  it("fails when a text block overflows its safe area", async () => {
    const overflowFixture = {
      ...fixtureInput,
      pages: fixtureInput.pages.map((page, index) => index === 0
        ? { ...page, body: "超出安全区域的正文".repeat(600) }
        : page),
    };

    await expect(renderCarousel(overflowFixture)).rejects.toThrow("VISUAL_TEXT_OVERFLOW");
  });

  it("requires a verified source asset when a screenshot is declared", async () => {
    await expect(renderCarousel({
      ...fixtureInput,
      sourceAssetResolver: {
        async resolveVerifiedSourceAsset() {
          return null;
        },
      },
    })).rejects.toThrow("PRODUCT_ASSET_REQUIRED");
  });

  it("rejects source bytes that do not match the verified Asset hash", async () => {
    const forgedAsset = {
      ...fixtureInput.sourceAssets[0]!,
      sha256: "0".repeat(64),
    };
    await expect(renderCarousel({
      ...fixtureInput,
      sourceAssetResolver: {
        async resolveVerifiedSourceAsset() {
          return forgedAsset;
        },
      },
    })).rejects.toThrow("PRODUCT_ASSET_REQUIRED");
  });

  it("requires the persisted Asset resolver to find a declared screenshot", async () => {
    await expect(renderCarousel({
      ...fixtureInput,
      sourceAssetResolver: {
        async resolveVerifiedSourceAsset() {
          return null;
        },
      },
    })).rejects.toThrow("PRODUCT_ASSET_REQUIRED");
  });

  it("fails when brand or purpose text overflows the safe area", async () => {
    await expect(renderCarousel({
      ...fixtureInput,
      brand: { ...fixtureInput.brand, mark: "DORMCHEF".repeat(80) },
      pages: fixtureInput.pages.map((page, index) => index === 0
        ? { ...page, purpose: "页面用途".repeat(100) }
        : page),
    })).rejects.toThrow("VISUAL_TEXT_OVERFLOW");
  });

  it("commits generated asset records only after all seven immutable uploads succeed", async () => {
    const rendered = await renderCarousel(fixtureInput);
    const events: string[] = [];
    let committedAssets: Array<{ objectKey: string; sha256: string }> = [];

    await persistRenderedCarousel({
      workspaceId,
      productId,
      contentVersionId,
      pages: rendered,
      storage: {
        async upload(objectKey) {
          events.push(`upload:${objectKey}`);
        },
        async removeOwned(objectKeys) {
          events.push(`remove:${objectKeys.join(",")}`);
        },
      },
      commit: {
        async insertVerifiedGeneratedAssets(input) {
          events.push("commit");
          committedAssets = input.assets;
        },
        async hasVerifiedGeneratedAssets() {
          return false;
        },
      },
    });

    expect(events).toHaveLength(8);
    expect(events.slice(0, 7).every((event) => event.startsWith("upload:"))).toBe(true);
    expect(events[7]).toBe("commit");
    expect(committedAssets).toHaveLength(7);
    expect(committedAssets[0]?.objectKey).toBe(
      `workspaces/${workspaceId}/products/${productId}/contents/${contentVersionId}/page-1-${rendered[0]?.sha256}.png`,
    );
    expect(committedAssets[0]).toMatchObject({
      mimeType: "image/png",
      width: 1080,
      height: 1440,
      sha256: rendered[0]?.sha256,
    });
  });

  it("cleans partial uploads and skips asset records when a page upload fails", async () => {
    const rendered = await renderCarousel(fixtureInput);
    const uploaded: string[] = [];
    const removed: string[][] = [];
    let commitCount = 0;

    await expect(persistRenderedCarousel({
      workspaceId,
      productId,
      contentVersionId,
      pages: rendered,
      storage: {
        async upload(objectKey) {
          uploaded.push(objectKey);
          if (uploaded.length === 3) throw new Error("UPLOAD_FAILED");
        },
        async removeOwned(objectKeys) {
          removed.push(objectKeys);
        },
      },
      commit: {
        async insertVerifiedGeneratedAssets() {
          commitCount += 1;
        },
        async hasVerifiedGeneratedAssets() {
          return false;
        },
      },
    })).rejects.toThrow("UPLOAD_FAILED");

    expect(uploaded).toHaveLength(3);
    expect(removed).toEqual([uploaded]);
    expect(commitCount).toBe(0);
  });

  it("reports cleanup failure without hiding that uploaded objects may remain", async () => {
    const rendered = await renderCarousel(fixtureInput);

    await expect(persistRenderedCarousel({
      workspaceId,
      productId,
      contentVersionId,
      pages: rendered,
      storage: {
        async upload() {
          throw new Error("UPLOAD_FAILED");
        },
        async removeOwned() {
          throw new Error("REMOVE_FAILED");
        },
      },
      commit: {
        async insertVerifiedGeneratedAssets() {
          throw new Error("COMMIT_MUST_NOT_RUN");
        },
        async hasVerifiedGeneratedAssets() {
          return false;
        },
      },
    })).rejects.toThrow("VISUAL_ASSET_CLEANUP_FAILED");
  });

  it("uses one ownership token for uploads and conditional cleanup", async () => {
    const rendered = await renderCarousel(fixtureInput);
    const uploadTokens: string[] = [];
    let cleanupToken: string | null = null;
    let ownedCleanupCount = 0;
    const storage = {
      async upload(
        _objectKey: string,
        _bytes: Buffer,
        metadata: { uploadAttemptId?: string },
      ) {
        uploadTokens.push(metadata.uploadAttemptId ?? "");
        throw new Error("UPLOAD_FAILED");
      },
      async removeOwned(_objectKeys: string[], uploadAttemptId: string) {
        ownedCleanupCount += 1;
        cleanupToken = uploadAttemptId;
      },
    };

    await expect(persistRenderedCarousel({
      workspaceId,
      productId,
      contentVersionId,
      pages: rendered,
      storage,
      commit: {
        async insertVerifiedGeneratedAssets() {
          throw new Error("COMMIT_MUST_NOT_RUN");
        },
        async hasVerifiedGeneratedAssets() {
          return false;
        },
      },
    })).rejects.toThrow("UPLOAD_FAILED");

    expect(uploadTokens[0]).toMatch(/^[a-f0-9-]{36}$/);
    expect(ownedCleanupCount).toBe(1);
    expect(cleanupToken).toBe(uploadTokens[0]);
  });

  it("rejects malformed scope IDs before constructing storage keys", async () => {
    const rendered = await renderCarousel(fixtureInput);
    let uploadCount = 0;

    await expect(persistRenderedCarousel({
      workspaceId: "../another-workspace",
      productId,
      contentVersionId,
      pages: rendered,
      storage: {
        async upload() {
          uploadCount += 1;
        },
        async removeOwned() {},
      },
      commit: {
        async insertVerifiedGeneratedAssets() {},
        async hasVerifiedGeneratedAssets() {
          return false;
        },
      },
    })).rejects.toThrow("VISUAL_SCOPE_INVALID");
    expect(uploadCount).toBe(0);
  });

  it("reconciles an ambiguous generated-asset commit before cleanup", async () => {
    const rendered = await renderCarousel(fixtureInput);
    let cleanupCount = 0;

    await expect(persistRenderedCarousel({
      workspaceId,
      productId,
      contentVersionId,
      pages: rendered,
      storage: {
        async upload() {},
        async removeOwned() {
          cleanupCount += 1;
        },
      },
      commit: {
        async insertVerifiedGeneratedAssets() {
          throw new Error("COMMIT_RESPONSE_LOST");
        },
        async hasVerifiedGeneratedAssets() {
          return true;
        },
      },
    })).resolves.toHaveLength(7);
    expect(cleanupCount).toBe(0);
  });
});

describe("publication packaging route contract", () => {
  it("exports only the supported Next.js POST route contract", async () => {
    const route = await import(publicationRoutePath);

    expect(typeof route.POST).toBe("function");
    expect(Object.keys(route).sort()).toEqual(["POST"]);
  });

  it("calls the Task 2 transaction in the authenticated workspace and returns only the package schema", async () => {
    const packageWithSignedUrl = {
      ...publication.package,
      imageDownloadUrls: ["https://example.invalid/secret"],
    };
    const state: PublicationRouteState = {
      existing: null,
      created: {
        ...publication,
        package: packageWithSignedUrl,
      },
      creationIdempotencyKey: "publication-request-1",
      rpcCalls: [],
    };
    const route = await loadPublicationRoute(state);
    const response = await route.POST(publicationRequest("publication-request-1"));
    const result = await response.json();

    expect(response.status).toBe(201);
    expect(state.rpcCalls).toEqual([expect.objectContaining({
      p_workspace_id: workspaceId,
      p_content_version_id: contentVersionId,
      p_idempotency_key: "publication-request-1",
      p_actor_id: "00000000-0000-4000-8000-000000000006",
      p_request_id: "publication-request-1",
    })]);
    expect(PublicationPackageSchema.safeParse(result).success).toBe(true);
    expect(result).not.toHaveProperty("imageDownloadUrls");
  });

  it("returns same-key replays but rejects packaging under a different key", async () => {
    const state: PublicationRouteState = {
      existing: publication,
      created: publication,
      creationIdempotencyKey: "publication-request-1",
      rpcCalls: [],
    };
    const route = await loadPublicationRoute(state);

    const replayResponse = await route.POST(publicationRequest("publication-request-1"));
    expect(replayResponse.status).toBe(201);
    await expect(replayResponse.json()).resolves.toEqual(publicationPackage);
    expect(state.rpcCalls).toHaveLength(0);

    const duplicateResponse = await route.POST(publicationRequest("another-request"));
    expect(duplicateResponse.status).toBe(409);
    await expect(duplicateResponse.json()).resolves.toEqual({
      ok: false,
      error: "PUBLICATION_ALREADY_PACKAGED",
    });
  });

  it("returns a same-key replay after the publication advances from READY_TO_PREFILL", async () => {
    const state: PublicationRouteState = {
      existing: { ...publication, status: "PREFILLING" },
      created: publication,
      creationIdempotencyKey: "publication-request-1",
      rpcCalls: [],
    };
    const route = await loadPublicationRoute(state);
    const response = await route.POST(publicationRequest("publication-request-1"));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(publicationPackage);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("rejects a transaction result from another workspace", async () => {
    const state: PublicationRouteState = {
      existing: null,
      created: { ...publication, workspaceId: "00000000-0000-4000-8000-000000000099" },
      creationIdempotencyKey: "publication-request-1",
      rpcCalls: [],
    };
    const route = await loadPublicationRoute(state);
    const response = await route.POST(publicationRequest("publication-request-1"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "WORKSPACE_SCOPE_MISMATCH",
    });
  });
});

describe("Task 8 database migration contract", () => {
  it("accepts only final immutable visual assets and serializes publication creation", async () => {
    const migrationsDirectory = new URL("../../../supabase/migrations/", import.meta.url);
    const task8Migrations = (await readdir(migrationsDirectory))
      .filter((name) => name.includes("task8"));

    expect(task8Migrations).toHaveLength(1);
    const migrationName = task8Migrations[0];
    if (!migrationName) return;
    const sql = await readFile(new URL(migrationName, migrationsDirectory), "utf8");
    const normalized = sql.replace(/\s+/g, " ").toLowerCase();

    expect(normalized).toContain("drop constraint if exists assets_object_key_namespace");
    expect(normalized).toContain("workspaces/" );
    expect(normalized).toContain("/products/");
    expect(normalized).toContain("/contents/");
    expect(normalized).toContain("create or replace function public.commit_render_assets_job");
    expect(normalized).toContain("create or replace function public.create_publication");
    expect(normalized).toContain("create or replace function public.purge_product");
    expect(normalized).toContain("'image/png'");
    expect(normalized).toContain("1080");
    expect(normalized).toContain("1440");
    expect(normalized).toContain("storage_object_matches_asset");

    const createPublication = normalized.slice(
      normalized.indexOf("create or replace function public.create_publication"),
    );
    expect(createPublication.indexOf("for update")).toBeGreaterThan(-1);
    expect(createPublication.indexOf("for update")).toBeLessThan(
      createPublication.indexOf("from public.publications"),
    );
    expect(createPublication).toContain("v_existing_idempotency_key");
    expect(createPublication).toContain("publication_already_packaged");
    expect(createPublication).toContain("payload->>'idempotency_key'");
    expect(createPublication).toContain("revoke all on function public.create_publication");
    expect(createPublication).toContain("grant execute on function public.create_publication");
    expect(createPublication).toContain("to service_role");

    const commitAssets = normalized.slice(
      normalized.indexOf("create or replace function public.commit_render_assets_job"),
      normalized.indexOf("create or replace function public.create_publication"),
    );
    expect(commitAssets).toContain("jsonb_typeof(p_assets) is distinct from 'array'");
    expect(commitAssets.indexOf("jsonb_typeof(p_assets) is distinct from 'array'")).toBeLessThan(
      commitAssets.indexOf("jsonb_array_length(p_assets)"),
    );
    expect(commitAssets).toContain("jsonb_typeof(v_row->'width') is distinct from 'number'");
    expect(commitAssets).toContain("jsonb_typeof(v_row->'height') is distinct from 'number'");
    expect(commitAssets).toContain("jsonb_typeof(v_row->'byte_size') is distinct from 'number'");
    expect(commitAssets).toContain("v_row->>'width' !~ '^[0-9]+$'");
    expect(commitAssets).toContain("v_row->>'height' !~ '^[0-9]+$'");
    expect(commitAssets).toContain("v_row->>'byte_size' !~ '^[0-9]+$'");
    expect(commitAssets).toContain("(v_row->>'width')::numeric <> 1080");
    expect(commitAssets).toContain("(v_row->>'byte_size')::numeric > 2147483647");
    expect(commitAssets.indexOf("jsonb_typeof(v_row->'width')")).toBeLessThan(
      commitAssets.indexOf("(v_row->>'width')::numeric"),
    );

    const purgeProduct = normalized.slice(
      normalized.indexOf("create or replace function public.purge_product"),
    );
    expect(purgeProduct).toContain("'workspaces/' || p_workspace_id::text");
    expect(purgeProduct).toContain("'/products/' || p_product_id::text || '/%'");
    expect(purgeProduct).toContain("revoke all on function public.purge_product");
    expect(purgeProduct).toContain("grant execute on function public.purge_product");
  });
});
