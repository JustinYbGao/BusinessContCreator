import { describe, expect, it } from "vitest";
import { preserveRenderInput } from "./content-payload";

describe("content render metadata", () => {
  it("keeps the existing brand and replaces render pages after an edit", () => {
    const nextPages = Array.from({ length: 7 }, (_, index) => ({
      page: index + 1,
      purpose: "fixture",
      headline: `new-${index + 1}`,
      body: "updated",
      sourceAssetId: null,
    }));
    const next = {
      titleCandidates: ["a", "b", "c", "d", "e"],
      recommendedTitle: "title",
      body: "body",
      hashtags: ["#one", "#two", "#three"],
      interactionPrompt: "prompt",
      pages: nextPages,
      claims: [{ factId: "00000000-0000-4000-8000-000000000001", text: "fact" }],
    };

    const result = preserveRenderInput({
      renderInput: {
        pages: Array.from({ length: 7 }, (_, index) => ({ page: index + 1 })),
        brand: { mark: "fixture", background: "#FFFFFF", foreground: "#111111", accent: "#FF2442" },
      },
    }, next);

    expect(result.renderInput).toEqual({
      pages: nextPages,
      brand: { mark: "fixture", background: "#FFFFFF", foreground: "#111111", accent: "#FF2442" },
    });
  });
});
