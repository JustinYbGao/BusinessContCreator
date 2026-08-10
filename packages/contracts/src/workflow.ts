import { z } from "zod";

export const WorkflowStatusSchema = z.enum([
  "PRODUCT_READY",
  "RESEARCH_READY",
  "BRIEF_READY",
  "COPY_READY",
  "ASSETS_READY",
  "REVIEW_REQUIRED",
  "APPROVED",
  "READY_TO_PREFILL",
  "PREFILLING",
  "NEEDS_LOGIN",
  "PREFILL_FAILED",
  "AWAITING_HUMAN_PUBLISH",
  "PUBLISHED",
  "MEASURING",
  "RETROSPECTED",
]);

export const PublicationStatusSchema = z.enum([
  "READY_TO_PREFILL",
  "PREFILLING",
  "NEEDS_LOGIN",
  "PREFILL_FAILED",
  "AWAITING_HUMAN_PUBLISH",
  "PUBLISHED",
  "MEASURING",
  "RETROSPECTED",
]);

export const ContentStatusSchema = z.enum(["draft", "review_required", "approved", "packaged"]);
export const JobStatusSchema = z.enum(["queued", "running", "completed", "failed"]);
export const ChannelTypeSchema = z.literal("xiaohongshu");

export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;
export type ContentStatus = z.infer<typeof ContentStatusSchema>;
export type PublicationStatus = z.infer<typeof PublicationStatusSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type ChannelType = z.infer<typeof ChannelTypeSchema>;

export const PublicationTransitionMap: Record<PublicationStatus, readonly PublicationStatus[]> = {
  READY_TO_PREFILL: ["PREFILLING"],
  PREFILLING: ["NEEDS_LOGIN", "PREFILL_FAILED", "AWAITING_HUMAN_PUBLISH"],
  NEEDS_LOGIN: ["READY_TO_PREFILL"],
  PREFILL_FAILED: ["READY_TO_PREFILL"],
  AWAITING_HUMAN_PUBLISH: ["PUBLISHED"],
  PUBLISHED: ["MEASURING"],
  MEASURING: ["RETROSPECTED"],
  RETROSPECTED: [],
};

const ContentWorkflowStatusProjection: Record<ContentStatus, WorkflowStatus> = {
  draft: "COPY_READY",
  review_required: "REVIEW_REQUIRED",
  approved: "APPROVED",
  packaged: "ASSETS_READY",
};

export function projectWorkflowStatus(
  contentStatus: ContentStatus,
  publicationStatus?: PublicationStatus,
): WorkflowStatus {
  if (publicationStatus) {
    return publicationStatus;
  }

  return ContentWorkflowStatusProjection[contentStatus];
}
