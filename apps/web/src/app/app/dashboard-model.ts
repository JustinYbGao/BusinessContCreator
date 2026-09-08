export interface DashboardReviewItem {
  id: string;
  title: string;
  createdAt: string | null;
}

export interface DashboardInput {
  productName: string | null;
  campaign: {
    name: string;
    startsOn: string | null;
    endsOn: string | null;
  } | null;
  reviewCount: number;
  pendingPublicationCount: number;
  dueMetricWindows: number;
  reviewItems: DashboardReviewItem[];
  errorMessage?: string | null;
}

export interface DashboardModel {
  state: "ready" | "error";
  productName: string;
  campaignName: string;
  campaignDates: string;
  reviewCount: number;
  pendingPublicationCount: number;
  dueMetricWindows: number;
  statusLabel: string;
  statusTone: "attention" | "healthy" | "quiet" | "danger";
  nextActionLabel: string;
  nextActionHref: string;
  reviewItems: DashboardReviewItem[];
  activityLabel: string;
  errorMessage?: string;
}

function formatCampaignDates(campaign: DashboardInput["campaign"]): string {
  if (!campaign?.startsOn || !campaign.endsOn) return "日期待定";
  return `${campaign.startsOn} — ${campaign.endsOn}`;
}

export function buildDashboardModel(input: DashboardInput): DashboardModel {
  if (input.errorMessage) {
    return {
      state: "error",
      productName: input.productName ?? "当前工作空间",
      campaignName: input.campaign?.name ?? "本周内容包",
      campaignDates: formatCampaignDates(input.campaign),
      reviewCount: input.reviewCount,
      pendingPublicationCount: input.pendingPublicationCount,
      dueMetricWindows: input.dueMetricWindows,
      statusLabel: "数据暂不可用",
      statusTone: "danger",
      nextActionLabel: "重新加载",
      nextActionHref: "/app",
      reviewItems: [],
      activityLabel: "工作空间数据加载失败",
      errorMessage: input.errorMessage,
    };
  }

  const statusLabel = input.reviewCount > 0
    ? "待审核"
    : input.pendingPublicationCount > 0
      ? "待处理"
      : "已就绪";
  const statusTone = input.reviewCount > 0 || input.pendingPublicationCount > 0 ? "attention" : "healthy";
  const nextActionLabel = input.reviewCount > 0
    ? "进入审核"
    : input.pendingPublicationCount > 0
      ? "查看发布"
      : "查看选题";
  const nextActionHref = input.reviewCount > 0
    ? "/app/review"
    : input.pendingPublicationCount > 0
      ? "/app/publications"
      : "/app/campaigns";
  const activityLabel = input.reviewCount > 0
    ? `${input.reviewCount} 篇内容等待人工确认`
    : input.pendingPublicationCount > 0
      ? `${input.pendingPublicationCount} 项发布准备待处理`
      : "当前没有待处理事项";

  return {
    state: "ready",
    productName: input.productName ?? "尚未绑定产品",
    campaignName: input.campaign?.name ?? "尚未创建内容包",
    campaignDates: formatCampaignDates(input.campaign),
    reviewCount: input.reviewCount,
    pendingPublicationCount: input.pendingPublicationCount,
    dueMetricWindows: input.dueMetricWindows,
    statusLabel,
    statusTone,
    nextActionLabel,
    nextActionHref,
    reviewItems: input.reviewItems,
    activityLabel,
  };
}
