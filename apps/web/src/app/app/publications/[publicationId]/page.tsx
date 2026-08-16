import Link from "next/link";
import { notFound } from "next/navigation";
import {
  MetricWindowSchema,
  calculateRates,
  summarizeConversions,
  type MetricWindow,
} from "@social-agent/analytics";
import { SupabaseLearningRepository, SupabaseMetricRepository, SupabasePublicationRepository } from "@social-agent/db";
import { metricWindowDue, parseMetricSnapshot } from "../../../../lib/analytics-route";
import { createSupabaseServiceRoleClient, requireServerInternalAdmin } from "../../../../lib/supabase/server";

type PageProps = { params: Promise<{ publicationId: string }> };

const WINDOWS: MetricWindow[] = ["24h", "72h", "7d"];
const cardStyle = { background: "#fff", border: "1px solid #dbe4d8", borderRadius: 18, padding: 24 };
const labelStyle = { color: "#5b705d", fontSize: 13, fontWeight: 700, margin: "0 0 8px" };
const inputStyle = { border: "1px solid #b8c8b8", borderRadius: 10, boxSizing: "border-box" as const, font: "inherit", padding: "10px 12px", width: "100%" };

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

function windowStateText(state: "captured" | "missing" | "not_yet_due"): string {
  if (state === "captured") return "已采集";
  if (state === "missing") return "已到期，待补录";
  return "尚未到期";
}

export default async function PublicationAnalyticsPage({ params }: PageProps) {
  const identity = await requireServerInternalAdmin();
  const { publicationId } = await params;
  const supabase = createSupabaseServiceRoleClient();
  const publicationRepository = new SupabasePublicationRepository(supabase);
  const metricRepository = new SupabaseMetricRepository(supabase);
  const learningRepository = new SupabaseLearningRepository(supabase);
  const publication = await publicationRepository.getAnalytics({ workspaceId: identity.workspaceId }, publicationId);
  if (!publication) notFound();

  const [snapshotRows, learningRows, productResult, campaignResult] = await Promise.all([
    metricRepository.listByPublication({ workspaceId: identity.workspaceId }, publicationId),
    learningRepository.listEligible({ workspaceId: identity.workspaceId }, publication.productId, publication.campaignId),
    supabase.from("products").select("name").eq("workspace_id", identity.workspaceId).eq("id", publication.productId).is("deleted_at", null).maybeSingle(),
    supabase.from("campaigns").select("name").eq("workspace_id", identity.workspaceId).eq("id", publication.campaignId).maybeSingle(),
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
    if (!snapshot) {
      return { window, state: metricWindowDue(window, publication.publishedAt) ? "missing" as const : "not_yet_due" as const, snapshot: null };
    }
    return { window, state: "captured" as const, snapshot };
  });
  const latestLearning = learningRows.filter((learning) => learning.publicationId === publicationId).at(-1) ?? null;
  const payload = latestLearning?.payload;
  const payloadRecord = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null;

  return (
    <main>
      <p style={{ color: "#5b705d", fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>Publication analytics</p>
      <p style={{ margin: "12px 0 4px" }}><Link href="/app/analytics" style={{ color: "#5b705d" }}>复盘</Link> / {productResult.data?.name ?? "Product"}</p>
      <div style={{ alignItems: "end", display: "flex", flexWrap: "wrap", gap: 20, justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 44, letterSpacing: "-0.05em", margin: "10px 0" }}>{campaignResult.data?.name ?? "Publication"}</h1>
          <p style={{ color: "#536057", lineHeight: 1.6, margin: 0 }}>记录人工发布结果，按 24h / 72h / 7d 检查证据窗口。</p>
        </div>
        <span style={{ background: "#e5ecdf", borderRadius: 999, color: "#315d38", fontSize: 13, fontWeight: 700, padding: "8px 12px" }}>{statusText(publication.status)}</span>
      </div>

      <section style={{ ...cardStyle, marginTop: 28 }}>
        <p style={labelStyle}>Publication scope</p>
        <dl style={{ color: "#536057", display: "grid", gap: 8, fontSize: 14, lineHeight: 1.55, margin: 0 }}>
          <div><dt style={{ display: "inline", fontWeight: 700 }}>Publication ID：</dt><dd style={{ display: "inline", fontFamily: "monospace", margin: 0 }}>{publication.id}</dd></div>
          <div><dt style={{ display: "inline", fontWeight: 700 }}>状态：</dt><dd style={{ display: "inline", margin: 0 }}>{statusText(publication.status)}</dd></div>
          <div><dt style={{ display: "inline", fontWeight: 700 }}>公开链接：</dt><dd style={{ display: "inline", fontFamily: "monospace", margin: 0, overflowWrap: "anywhere" }}>{publication.publicUrl ?? "尚未登记"}</dd></div>
          <div><dt style={{ display: "inline", fontWeight: 700 }}>发布时刻：</dt><dd style={{ display: "inline", margin: 0 }}>{formatTime(publication.publishedAt)}</dd></div>
        </dl>
      </section>

      <section style={{ background: "#e5ecdf", borderRadius: 22, marginTop: 20, padding: 24 }}>
        <h2 style={{ fontSize: 24, margin: "0 0 8px" }}>最终发布仍由人工完成</h2>
        <p style={{ color: "#536057", lineHeight: 1.6, margin: "0 0 18px" }}>此处只记录发布结果，不打开小红书页面，不保存 Cookie，也不提供自动点击最终发布按钮。</p>
        {publication.status === "AWAITING_HUMAN_PUBLISH" ? (
          <form action={`/api/publications/${publicationId}/publish`} method="post" style={{ display: "grid", gap: 12, maxWidth: 720 }}>
            <label style={{ color: "#315d38", display: "grid", fontSize: 14, fontWeight: 700, gap: 6 }}>
              小红书公开链接
              <input name="publicUrl" placeholder="https://www.xiaohongshu.com/explore/..." required style={inputStyle} />
            </label>
            <label style={{ color: "#315d38", display: "grid", fontSize: 14, fontWeight: 700, gap: 6 }}>
              人工发布时刻（北京时间）
              <input name="publishedAt" required style={inputStyle} type="datetime-local" />
            </label>
            <button type="submit" style={{ background: "#315d38", border: 0, borderRadius: 999, color: "#fff", cursor: "pointer", fontWeight: 700, justifySelf: "start", padding: "11px 18px" }}>记录发布结果</button>
          </form>
        ) : <p style={{ color: "#315d38", fontWeight: 700, margin: 0 }}>当前状态不需要再次登记发布结果。</p>}
      </section>

      <section style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", marginTop: 28 }}>
        {windows.map(({ window, state, snapshot }) => {
          const conversions = snapshot ? summarizeConversions(snapshot.productConversion) : null;
          const rates = snapshot ? calculateRates(snapshot.metrics) : null;
          return (
            <article key={window} style={cardStyle}>
              <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
                <h2 style={{ fontSize: 24, margin: 0 }}>{window}</h2>
                <span style={{ color: state === "missing" ? "#8a3e35" : "#315d38", fontSize: 13, fontWeight: 700 }}>{windowStateText(state)}</span>
              </div>
              {snapshot && rates && conversions ? <>
                <p style={{ color: "#7b887d", fontSize: 13, margin: "14px 0" }}>采集于 {formatTime(snapshot.capturedAt)}</p>
                <dl style={{ color: "#536057", display: "grid", gap: 8, fontSize: 14, lineHeight: 1.45, margin: 0 }}>
                  <div><dt style={{ display: "inline", fontWeight: 700 }}>曝光 / 浏览：</dt><dd style={{ display: "inline", margin: 0 }}>{snapshot.metrics.impressions ?? "—"} / {snapshot.metrics.views ?? "—"}</dd></div>
                  <div><dt style={{ display: "inline", fontWeight: 700 }}>点赞 / 收藏：</dt><dd style={{ display: "inline", margin: 0 }}>{snapshot.metrics.likes} / {snapshot.metrics.saves}</dd></div>
                  <div><dt style={{ display: "inline", fontWeight: 700 }}>互动率：</dt><dd style={{ display: "inline", margin: 0 }}>{rateText(rates.engagementRate.value)}</dd></div>
                  <div><dt style={{ display: "inline", fontWeight: 700 }}>直接 / 自报 / 推断：</dt><dd style={{ display: "inline", margin: 0 }}>{conversions.direct} / {conversions.selfReported} / {conversions.inferred}</dd></div>
                </dl>
              </> : <p style={{ color: "#536057", lineHeight: 1.6, marginBottom: 0 }}>{state === "missing" ? "这个窗口已经到期，请从指标导入入口补录。" : "这个窗口尚未到期。"}</p>}
            </article>
          );
        })}
      </section>

      <section style={{ ...cardStyle, marginTop: 28 }}>
        <p style={labelStyle}>Latest retrospective</p>
        {!latestLearning || !payloadRecord ? <p style={{ color: "#536057", margin: 0 }}>还没有可展示的复盘 Learning。</p> : <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <span style={{ background: "#e5ecdf", borderRadius: 999, color: "#315d38", fontSize: 13, padding: "6px 10px" }}>confidence: {String(payloadRecord.confidence ?? "—")}</span>
            <span style={{ background: "#f4ead4", borderRadius: 999, color: "#536057", fontSize: 13, padding: "6px 10px" }}>sampleCount: {String(payloadRecord.sampleCount ?? "—")}</span>
            <span style={{ background: "#eef0ea", borderRadius: 999, color: "#536057", fontSize: 13, padding: "6px 10px" }}>window: {latestLearning.evidenceWindow}</span>
          </div>
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", marginTop: 20 }}>
            {(["keep", "change", "stop"] as const).map((category) => <div key={category}>
              <h3 style={{ fontSize: 16, margin: "0 0 8px" }}>{category}</h3>
              {observationsOf(payload, category).length === 0 ? <p style={{ color: "#7b887d", fontSize: 14, margin: 0 }}>暂无</p> : <ul style={{ color: "#536057", fontSize: 14, lineHeight: 1.55, margin: 0, paddingLeft: 18 }}>{observationsOf(payload, category).map((text, index) => <li key={`${category}-${index}`}>{text}</li>)}</ul>}
            </div>)}
          </div>
        </>}
      </section>
    </main>
  );
}
