import { describe, expect, it } from "vitest";
import { buildReviewContext } from "./context.js";

describe("buildReviewContext", () => {
  it("canonicalizes the database-bound review inputs without unrelated fields", () => {
    const context = buildReviewContext({
      contentVersionId: "00000000-0000-4000-8000-000000000010",
      payload: { recommendedTitle: "Title" },
      facts: [
        {
          id: "00000000-0000-4000-8000-000000000002",
          workspace_id: "workspace-2",
          product_id: "product-2",
          statement: "Second fact",
          status: "candidate",
          public_use_allowed: false,
          category: "feature",
        },
        {
          id: "00000000-0000-4000-8000-000000000001",
          workspace_id: "workspace-1",
          product_id: "product-1",
          statement: "First fact",
          status: "verified",
          public_use_allowed: true,
          category: "feature",
        },
      ],
      sourceAssets: [
        {
          id: "00000000-0000-4000-8000-000000000004",
          workspace_id: "workspace-1",
          product_id: "product-1",
          content_version_id: null,
          kind: "brand_asset",
          source_locator: "brand/logo.png",
          provenance: "source",
          verification_status: "verified",
          public_use_allowed: true,
          object_key: "private/unrelated-key",
        },
      ],
      recentApprovedContents: [
        {
          id: "00000000-0000-4000-8000-000000000005",
          content_id: "content-1",
          payload: { body: "later" },
          created_at: "2026-08-12T10:00:00.000001Z",
        },
        {
          id: "00000000-0000-4000-8000-000000000006",
          content_id: "content-2",
          payload: { body: "earlier" },
          created_at: "2026-08-12T10:00:00.000000Z",
        },
      ],
    });

    expect(context).toEqual({
      contentVersionId: "00000000-0000-4000-8000-000000000010",
      payload: { recommendedTitle: "Title" },
      facts: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          workspaceId: "workspace-1",
          productId: "product-1",
          statement: "First fact",
          status: "verified",
          publicUseAllowed: true,
        },
        {
          id: "00000000-0000-4000-8000-000000000002",
          workspaceId: "workspace-2",
          productId: "product-2",
          statement: "Second fact",
          status: "candidate",
          publicUseAllowed: false,
        },
      ],
      sourceAssets: [
        {
          id: "00000000-0000-4000-8000-000000000004",
          workspaceId: "workspace-1",
          productId: "product-1",
          contentVersionId: null,
          kind: "brand_asset",
          sourceLocator: "brand/logo.png",
          provenance: "source",
          verificationStatus: "verified",
          publicUseAllowed: true,
        },
      ],
      recentApprovedContents: [
        {
          contentId: "content-1",
          contentVersionId: "00000000-0000-4000-8000-000000000005",
          payload: { body: "later" },
        },
        {
          contentId: "content-2",
          contentVersionId: "00000000-0000-4000-8000-000000000006",
          payload: { body: "earlier" },
        },
      ],
    });
  });
});
