import Link from "next/link";
import { IconMark, StatusPill } from "../../components/console-ui";
import { buildDashboardModel, type DashboardInput } from "./dashboard-model";
import { createSupabaseServiceRoleClient, requireServerInternalWorkspace } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

function failedDashboardModel(message: string) {
  const input: DashboardInput = {
    productName: null,
    campaign: null,
    reviewCount: 0,
    pendingPublicationCount: 0,
    dueMetricWindows: 0,
    reviewItems: [],
    errorMessage: message,
  };
  return buildDashboardModel(input);
}

async function loadDashboardModel(workspaceId: string) {
  const supabase = createSupabaseServiceRoleClient();
  const [productsResult, campaignsResult, reviewResult, pendingResult, measurableResult] = await Promise.all([
    supabase.from("products").select("name").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at").limit(1),
    supabase.from("campaigns").select("name,starts_on,ends_on").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1),
    supabase.from("contents").select("id,topic_id,created_at", { count: "exact" }).eq("workspace_id", workspaceId).eq("status", "review_required").order("created_at", { ascending: false }).limit(5),
    supabase.from("publications").select("id").eq("workspace_id", workspaceId).in("status", ["READY_TO_PREFILL", "PREFILLING", "NEEDS_LOGIN", "PREFILL_FAILED", "AWAITING_HUMAN_PUBLISH"]),
    supabase.from("publications").select("id").eq("workspace_id", workspaceId).in("status", ["PUBLISHED", "MEASURING"]),
  ]);

  if (productsResult.error || campaignsResult.error || reviewResult.error || pendingResult.error || measurableResult.error) {
    return failedDashboardModel("暂时无法连接工作空间数据，请稍后重新加载。");
  }

  const reviewContents = reviewResult.data ?? [];
  const topicIds = reviewContents.map((content) => content.topic_id).filter((id): id is string => typeof id === "string");
  const topicsResult = topicIds.length > 0
    ? await supabase.from("topic_candidates").select("id,title").eq("workspace_id", workspaceId).in("id", topicIds)
    : { data: [], error: null };
  if (topicsResult.error) return failedDashboardModel("暂时无法加载选题信息，请稍后重新加载。");

  const measurableIds = (measurableResult.data ?? []).map((publication) => publication.id);
  const snapshotsResult = measurableIds.length > 0
    ? await supabase.from("metric_snapshots").select("id").in("publication_id", measurableIds)
    : { data: [], error: null };
  if (snapshotsResult.error) return failedDashboardModel("暂时无法加载指标窗口，请稍后重新加载。");

  const topicTitles = new Map((topicsResult.data ?? []).map((topic) => [topic.id, topic.title]));
  const reviewItems = reviewContents.map((content) => ({
    id: content.id,
    title: topicTitles.get(content.topic_id) ?? "未命名选题",
    createdAt: content.created_at,
  }));

  return buildDashboardModel({
    productName: productsResult.data?.[0]?.name ?? null,
    campaign: campaignsResult.data?.[0]
      ? {
          name: campaignsResult.data[0].name,
          startsOn: campaignsResult.data[0].starts_on,
          endsOn: campaignsResult.data[0].ends_on,
        }
      : null,
    reviewCount: reviewResult.count ?? reviewItems.length,
    pendingPublicationCount: pendingResult.data?.length ?? 0,
    dueMetricWindows: Math.max(measurableIds.length * 3 - (snapshotsResult.data?.length ?? 0), 0),
    reviewItems,
  });
}

function formatReviewTime(value: string | null): string {
  if (!value) return "时间待补充";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

export default async function ConsolePage() {
  const context = await requireServerInternalWorkspace();
  const model = await loadDashboardModel(context.workspaceId);
  const pendingWork = model.reviewCount + model.pendingPublicationCount;

  return (
    <main className="dashboard-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">本周内容工作台</p>
          <h1>内容包工作台</h1>
          <p>从已确认的产品事实出发，先处理今天最重要的内容动作。</p>
        </div>
        <div className="dashboard-heading-status">
          <StatusPill label={model.statusLabel} tone={model.statusTone} />
          <span>{model.campaignDates}</span>
        </div>
      </div>

      {model.state === "error" ? (
        <div className="alert alert-danger" role="alert">
          <div>
            <strong>{model.errorMessage}</strong>
            <p>页面没有用空数据替代真实错误，确认数据库恢复后再试一次。</p>
          </div>
          <Link className="button button-secondary" href="/app">重新加载</Link>
        </div>
      ) : null}

      <section aria-label="本周工作状态" className="dashboard-status-row">
        <div className="dashboard-status-metrics">
          <div className="dashboard-status-metric">
            <span>当前状态</span>
            <strong data-tone={model.statusTone}>{model.statusLabel}</strong>
            <p>{model.activityLabel}</p>
          </div>
          <div className="dashboard-status-metric">
            <span>当前内容包</span>
            <strong className="status-campaign">{model.campaignName}</strong>
            <p>{model.productName}</p>
          </div>
          <div className="dashboard-status-metric">
            <span>待处理事项</span>
            <strong>{pendingWork}</strong>
            <p>{model.dueMetricWindows} 个指标窗口待补录</p>
          </div>
        </div>
        <div className="dashboard-status-action">
          <Link className="button button-primary" href={model.nextActionHref}>
            <span>{model.nextActionLabel}</span>
            <IconMark name="arrow" size={17} weight="bold" />
          </Link>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="surface dashboard-review-surface">
          <div className="dashboard-review-head">
            <div>
              <p className="eyebrow">需要人工确认</p>
              <h2>待审核内容包</h2>
              <p>{model.reviewCount} 篇内容 · 阻塞性问题优先处理</p>
            </div>
            <Link className="text-link" href="/app/review">查看审核队列 <IconMark name="arrow" size={15} /></Link>
          </div>
          {model.reviewItems.length === 0 ? (
            <div className="empty-state">
              <p>当前没有待审核内容。</p>
              <Link className="text-link" href="/app/campaigns">前往选题库 <IconMark name="arrow" size={15} /></Link>
            </div>
          ) : (
            <div className="dashboard-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">内容预览</th>
                    <th scope="col">来源</th>
                    <th scope="col">创建时间</th>
                    <th scope="col">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {model.reviewItems.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <Link className="table-content-cell" href={`/app/contents/${item.id}`}>
                          <span aria-hidden="true" className="table-content-icon"><IconMark name="document" size={18} /></span>
                          <span>
                            <span className="table-content-title">{item.title}</span>
                            <span className="table-content-subtitle">打开内容详情查看当前版本</span>
                          </span>
                        </Link>
                      </td>
                      <td>当前内容包</td>
                      <td>{formatReviewTime(item.createdAt)}</td>
                      <td><StatusPill label="待审核" tone="attention" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {model.reviewItems.length > 0 ? (
            <div className="dashboard-review-footer">
              <span>已展示 {model.reviewItems.length} 篇</span>
              <Link className="text-link" href="/app/review">打开完整队列 <IconMark name="arrow" size={15} /></Link>
            </div>
          ) : null}
        </div>

        <aside className="surface dashboard-activity">
          <p className="eyebrow">工作流状态</p>
          <h2>需要关注</h2>
          <ul className="dashboard-activity-list">
            <li>
              <span>审核队列</span>
              <strong>{model.reviewCount > 0 ? `${model.reviewCount} 篇待确认` : "已清空"}</strong>
              <p>人工确认事实、表达与平台规范。</p>
            </li>
            <li>
              <span>发布准备</span>
              <strong>{model.pendingPublicationCount > 0 ? `${model.pendingPublicationCount} 项待处理` : "暂无待处理"}</strong>
              <p>系统只准备和预填，不执行最终发布。</p>
            </li>
            <li>
              <span>指标窗口</span>
              <strong>{model.dueMetricWindows > 0 ? `${model.dueMetricWindows} 个待补录` : "暂无到期窗口"}</strong>
              <p>按 24h、72h、7d 记录可追溯证据。</p>
            </li>
          </ul>
        </aside>
      </section>

      <section className="dashboard-safety">
        <p className="eyebrow">发布安全边界</p>
        <h2>准备可以自动化，最终发布必须由人完成。</h2>
        <p>控制台只管理经过审核的内容版本和发布准备状态，不保存浏览器 Cookie，也不提供自动点击小红书最终发布按钮的路径。</p>
      </section>
    </main>
  );
}
