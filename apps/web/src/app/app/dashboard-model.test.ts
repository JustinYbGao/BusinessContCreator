import { describe, expect, it } from "vitest";
import { buildDashboardModel, type DashboardInput } from "./dashboard-model.js";

const populatedInput: DashboardInput = {
  productName: "DormChef",
  campaign: {
    name: "毕业季收纳指南",
    startsOn: "2026-08-24",
    endsOn: "2026-08-30",
  },
  reviewCount: 5,
  pendingPublicationCount: 2,
  dueMetricWindows: 3,
  reviewItems: [
    { id: "content-1", title: "宿舍收纳的 6 个操作", createdAt: "2026-08-28T02:32:00.000Z" },
  ],
};

describe("buildDashboardModel", () => {
  it("turns workspace data into a focused review workbench", () => {
    expect(buildDashboardModel(populatedInput)).toEqual({
      state: "ready",
      productName: "DormChef",
      campaignName: "毕业季收纳指南",
      campaignDates: "2026-08-24 — 2026-08-30",
      reviewCount: 5,
      pendingPublicationCount: 2,
      dueMetricWindows: 3,
      statusLabel: "待审核",
      statusTone: "attention",
      nextActionLabel: "进入审核",
      nextActionHref: "/app/review",
      reviewItems: populatedInput.reviewItems,
      activityLabel: "5 篇内容等待人工确认",
    });
  });

  it("keeps data failures visible instead of presenting fake empty data", () => {
    const model = buildDashboardModel({
      ...populatedInput,
      errorMessage: "暂时无法连接工作空间数据。",
    });

    expect(model.state).toBe("error");
    expect(model.statusLabel).toBe("数据暂不可用");
    expect(model.statusTone).toBe("danger");
    expect(model.errorMessage).toBe("暂时无法连接工作空间数据。");
    expect(model.nextActionHref).toBe("/app");
  });
});
