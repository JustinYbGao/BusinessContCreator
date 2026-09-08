import Link from "next/link";
import { notFound } from "next/navigation";
import {
  MetricWindowSchema,
  calculateRates,
  summarizeConversions,
  type MetricWindow,
} from "@social-agent/analytics";
import { SupabaseLearningRepository, SupabaseMetricRepository, SupabasePublicationRepository } from "@social-agent/db";
import { IconMark, StatusPill } from "../../../../components/console-ui";
import { metricWindowDue, parseMetricSnapshot } from "../../../../lib/analytics-route";
import { createSupabaseServiceRoleClient, requireServerInternalWorkspace } from "../../../../lib/supabase/server";

type PageProps = { params: Promise<{ publicationId: string }> };

const WINDOWS: MetricWindow[] = ["24h", "72h", "7d"];

function formatTime(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function rateText(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(2)}%`;
}

function observationsOf(payload: unknown, category: "keep" | "change" | "stop"): string[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const value = (payload as Record<string, unknown>).observations;
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const entries = (value as Record<string, unknown>)[category];
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const text = (entry as Record<string, unknown>).text;
    return typeof text === "string" ? [text] : [];
  });
}

function statusText(status: string): string {
  const labels: Record<string, string> = {
    READY_TO_PREFILL: "等待预填",
    PREFILLING: "预填中",
    NEEDS_LOGIN: "等待登录",
    PREFILL_FAILED: "预填失败",
    AWAITING_HUMAN_PUBLISH: "等待人工发布",
    PUBLISHED: "已发布",
    MEASURING: "测量中",
    RETROSPECTED: "已复盘",
  };
  return labels[status] ?? status;
}

function statusTone(status: string): "attention" | "healthy" | "danger" | "quiet" {
  if (status === "PUBLISHED" || status === "RETROSPECTED") return "healthy";
  if (status === "PREFILL_FAILED") return "danger";
  if (status === "AWAITING_HUMAN_PUBLISH" || status === "NEEDS_LOGIN") return "attention";
  return "quiet";
}

function windowStateText(state: "captured" | "missing" | "not_yet_due"): string {
  if (state === "captured") return "已采集";
  if (state === "missing") return "已到期，待补录";
  return "尚未到期";
}

function windowTone(state: "captured" | "missing" | "not_yet_due"): "attention" | "healthy" | "quiet" {
  if (state === "captured") return "healthy";
  if (state === "missing") return "attention";
  return "quiet";
}

export default async function PublicationAnalyticsPage({ params }: PageProps) {
  const context = await requireServerInternalWorkspace();
  const { publicationId } = await params;
  const supabase = createSupabaseServiceRoleClient();
  const publicationRepository = new SupabasePublicationRepository(supabase);
  const metricRepository = new SupabaseMetricRepository(supabase);
  const learningRepository = new SupabaseLearningRepository(supabase);
  const publication = await publicationRepository.getAnalytics({ workspaceId: context.workspaceId }, publicationId);
  if (!publication) notFound();

  const [snapshotRows, learningRows, productResult, campaignResult] = await Promise.all([
    metricRepository.listByPublication({ workspaceId: context.workspaceId }, publicationId),
    learningRepository.listEligible({ workspaceId: context.workspaceId }, publication.productId, publication.campaignId),
    supabase.from("products").select("name").eq("workspace_id", context.workspaceId).eq("id", publication.productId).is("deleted_at", null).maybeSingle(),
    supabase.from("campaigns").select("name").eq("workspace_id", context.workspaceId).eq("id", publication.campaignId).maybeSingle(),
  ]);
  if (productResult.error || campaignResult.error) notFound();

  const snapshots = snapshotRows.map(parseMetricSnapshot);
  const snapshotsByWindow = new Map<MetricWindow, ReturnType<typeof parseMetricSnapshot>>();
  for (const snapshot of snapshots) {
    if (!MetricWindowSchema.safeParse(snapshot.window).success) notFound();
    snapshotsByWindow.set(snapshot.window, snapshot);
  }
  const windows = WINDOWS.map((window) => {
    const snapshot = snapshotsByWindow.get(window);
    if (!snapshot) return { window, state: metricWindowDue(window, publication.publishedAt) ? "missing" as const : "not_yet_due" as const, snapshot: null };
    return { window, state: "captured" as const, snapshot };
  });
  const latestLearning = learningRows.filter((learning) => learning.publicationId === publicationId).at(-1) ?? null;
  const payload = latestLearning?.payload;
  const payloadRecord = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null;

  return (
    <main>
      <div className="page-heading page-heading--compact">
        <div>
          <p className="breadcrumb"><Link href="/app/analytics">复盘与证据</Link> / {productResult.data?.name ?? "Product"}</p>
          <p className="eyebrow">Publication analytics</p>
          <h1>{campaignResult.data?.name ?? "Publication"}</h1>
          <p>记录人工发布结果，按 24h / 72h / 7d 检查证据窗口。</p>
        </div>
        <div className="page-heading-action">
          <StatusPill label={statusText(publication.status)} tone={statusTone(publication.status)} />
          <Link className="button button-secondary" href="/app/analytics">返回复盘 <IconMark name="arrow" size={16} /></Link>
        </div>
      </div>

      <section className="surface-card">
        <p className="eyebrow">Publication scope</p>
        <dl className="definition-list">
          <div><dt>Publication ID</dt><dd className="mono">{publication.id}</dd></div>
          <div><dt>状态</dt><dd>{statusText(publication.status)}</dd></div>
          <div><dt>公开链接</dt><dd className="mono">{publication.publicUrl ?? "尚未登记"}</dd></div>
          <div><dt>发布时刻</dt><dd>{formatTime(publication.publishedAt)}</dd></div>
        </dl>
      </section>

      <section className="policy-panel surface-card--spaced">
        <p className="eyebrow">Human publish boundary</p>
        <h2>最终发布仍由人工完成</h2>
        <p>最终发布仍由人工完成；此处只记录发布结果。不打开小红书页面，不保存 Cookie，也不提供自动点击最终发布按钮。</p>
        {publication.status === "AWAITING_HUMAN_PUBLISH" ? (
          <form action={`/api/publications/${publicationId}/publish`} className="editor-form" method="post">
            <label className="editor-field"><span>小红书公开链接</span><input className="editor-input" name="publicUrl" placeholder="https://www.xiaohongshu.com/explore/..." required /></label>
            <label className="editor-field"><span>人工发布时刻（北京时间）</span><input className="editor-input" name="publishedAt" required type="datetime-local" /></label>
            <button className="button button-primary" type="submit">记录发布结果 <IconMark name="arrow" size={16} /></button>
          </form>
        ) : <p className="card-copy"><strong>当前状态不需要再次登记发布结果。</strong></p>}
      </section>

      <section className="window-grid">
        {windows.map(({ window, state, snapshot }) => {
          const conversions = snapshot ? summarizeConversions(snapshot.productConversion) : null;
          const rates = snapshot ? calculateRates(snapshot.metrics) : null;
          return (
            <article className="window-card" key={window}>
              <div className="window-card-header"><h2>{window}</h2><StatusPill label={windowStateText(state)} tone={windowTone(state)} /></div>
              {snapshot && rates && conversions ? <>
                <p className="card-meta">采集于 {formatTime(snapshot.capturedAt)}</p>
                <dl className="definition-list">
                  <div><dt>曝光 / 浏览</dt><dd>{snapshot.metrics.impressions ?? "—"} / {snapshot.metrics.views ?? "—"}</dd></div>
                  <div><dt>点赞 / 收藏</dt><dd>{snapshot.metrics.likes} / {snapshot.metrics.saves}</dd></div>
                  <div><dt>互动率</dt><dd>{rateText(rates.engagementRate.value)}</dd></div>
                  <div><dt>直接 / 自报 / 推断</dt><dd>{conversions.direct} / {conversions.selfReported} / {conversions.inferred}</dd></div>
                </dl>
              </> : <p>{state === "missing" ? "这个窗口已经到期，请从指标导入入口补录。" : "这个窗口尚未到期。"}</p>}
            </article>
          );
        })}
      </section>

      <section className="surface-card surface-card--spaced">
        <p className="eyebrow">Latest retrospective</p>
        {!latestLearning || !payloadRecord ? <p className="card-copy">还没有可展示的复盘 Learning。</p> : <>
          <div className="chip-row">
            <span className="chip" data-tone="healthy">confidence: {String(payloadRecord.confidence ?? "—")}</span>
            <span className="chip" data-tone="attention">sampleCount: {String(payloadRecord.sampleCount ?? "—")}</span>
            <span className="chip">window: {latestLearning.evidenceWindow}</span>
          </div>
          <div className="two-column-copy card-divider">
            {(["keep", "change", "stop"] as const).map((category) => <div key={category}>
              <h3>{category}</h3>
              {observationsOf(payload, category).length === 0 ? <p className="card-copy card-copy--muted">暂无</p> : <ul>{observationsOf(payload, category).map((text, index) => <li key={`${category}-${index}`}>{text}</li>)}</ul>}
            </div>)}
          </div>
        </>}
      </section>
    </main>
  );
}
