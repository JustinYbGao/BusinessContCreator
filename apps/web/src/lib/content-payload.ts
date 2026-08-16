import type { ContentDraft } from "@social-agent/contracts/content";

type RenderInputMetadata = {
  pages: ContentDraft["pages"];
  brand: Record<string, unknown>;
};

export type ContentDraftWithRenderInput = ContentDraft & {
  renderInput?: RenderInputMetadata;
};

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function preserveRenderInput(currentPayload: unknown, nextPayload: ContentDraft): ContentDraftWithRenderInput {
  const current = recordValue(currentPayload);
  const renderInput = recordValue(current.renderInput ?? current.render_input);
  const brand = recordValue(renderInput.brand);
  if (!Array.isArray(renderInput.pages) || renderInput.pages.length !== 7 || Object.keys(brand).length === 0) {
    return nextPayload;
  }
  return {
    ...nextPayload,
    renderInput: {
      ...renderInput,
      pages: nextPayload.pages,
      brand,
    },
  };
}
