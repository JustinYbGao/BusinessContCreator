import Link from "next/link";
import { parseMetricSnapshot, metricWindowDue } from "../../../lib/analytics-route";
import { buildRollingMedian, summarizeConversions, type MetricWindow } from "@social-agent/analytics";
import { createSupabaseServiceRoleClient, requireServerInternalAdmin } from "../../../lib/supabase/server";

const WINDOWS: MetricWindow[] = ["24h", "72h", "7d"];
const cardStyle = { background: "#fff", border: "1px solid #dbe4d8", borderRadius: 18, padding: 24 };

function formatTime(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function statusText(status: string): string {
  const labels: Record<string, string> = {
    PUBLISHED: "已发布",
    MEASURING: "测量中",
    RETROSPECTED: "已复盘",
  };
  return labels[status] ?? status;
}

export default async function AnalyticsPage() {
  const identity = await requireServerInternalAdmin();
  const supabase = createSupabaseServiceRoleClient();
  const [productsResult, campaignsResult, publicationsResult, reportsResult, importsResult, learningsResult] = await Promise.all([
    supabase.from("products").select("id,name").eq("workspace_id", identity.workspaceId).is("deleted_at", null).order("created_at"),
    supabase.from("campaigns").select("id,name,product_id,starts_on,ends_on").eq("workspace_id", identity.workspaceId).order("created_at", { ascending: false }),
    supabase.from("publications").select("id,product_id,campaign_id,status,public_url,published_at,created_at").eq("workspace_id", identity.workspaceId).in("status", ["PUBLISHED", "MEASURING", "RETROSPECTED"]).order("created_at", { ascending: false }),
    supabase.from("weekly_reports").select("id,product_id,campaign_id,week_start,payload,source_snapshot_ids,created_at").eq("workspace_id", identity.workspaceId).order("week_start", { ascending: false }),
    supabase.from("metric_imports").select("id,product_id,format,accepted_rows,created_at").eq("workspace_id", identity.workspaceId).order("created_at", { ascending: false }),
    supabase.from("learnings").select("id,product_id,publication_id,evidence_window,created_at").eq("workspace_id", identity.workspaceId).order("created_at", { ascending: false }),
  ]);

  const products = productsResult.error ? [] : productsResult.data ?? [];
  const campaigns = campaignsResult.error ? [] : campaignsResult.data ?? [];
  const publications = publicationsResult.error ? [] : publicationsResult.data ?? [];
  const reports = reportsResult.error ? [] : reportsResult.data ?? [];
  const imports = importsResult.error ? [] : importsResult.data ?? [];
  const learnings = learningsResult.error ? [] : learningsResult.data ?? [];
  const publicationIds = publications.map((publication) => publication.id);
  const snapshotsResult = publicationIds.length === 0
    ? { data: [], error: null }
    : await supabase.from("metric_snapshots").select("id,publication_id,window,metrics,product_conversion,captured_at").in("publication_id", publicationIds).order("captured_at");
  const snapshotRows = snapshotsResult.error ? [] : snapshotsResult.data ?? [];
  const snapshotsByPublication = new Map<string, ReturnType<typeof parseMetricSnapshot>[]>();
  for (const row of snapshotRows) {
    const snapshot = parseMetricSnapshot(row);
    const publicationId = (row as { publication_id?: unknown }).publication_id;
    if (typeof publicationId !== "string") throw new Error("ANALYTICS_UNAVAILABLE");
    const existing = snapshotsByPublication.get(publicationId) ?? [];
    existing.push(snapshot);
    snapshotsByPublication.set(publicationId, existing);
  }
  const productNames = new Map(products.map((product) => [product.id, product.name]));

  const campaignCards = campaigns.map((campaign) => {
    const campaignPublications = publications.filter((publication) => publication.product_id === campaign.product_id && publication.campaign_id === campaign.id);
    let missingWindows = 0;
    const conversions = { direct: 0, selfReported: 0, inferred: 0 };
    for (const publication of campaignPublications) {
      const publicationSnapshots = snapshotsByPublication.get(publication.id) ?? [];
      const windows = new Set(publicationSnapshots.map((snapshot) => snapshot.window));
      for (const window of WINDOWS) if (!windows.has(window) && metricWindowDue(window, publication.published_at)) missingWindows += 1;
      for (const snapshot of publicationSnapshots) {
        const totals = summarizeConversions(snapshot.productConversion);
        conversions.direct += totals.direct;
        conversions.selfReported += totals.selfReported;
        conversions.inferred += totals.inferred;
      }
    }
    const samples = campaignPublications
      .filter((publication) => publication.published_at && ["PUBLISHED", "MEASURING", "RETROSPECTED"].includes(publication.status))
      .map((publication) => ({
        publicationId: publication.id,
        productId: publication.product_id,
        campaignId: publication.campaign_id,
        status: publication.status as "PUBLISHED" | "MEASURING" | "RETROSPECTED",
        publishedAt: publication.published_at as string,
        snapshots: snapshotsByPublication.get(publication.id) ?? [],
      }));
    const medians = WINDOWS.map((window) => buildRollingMedian({
      currentPublicationId: "00000000-0000-0000-0000-000000000000",
      window,
      samples,
    }));
    const latestReport = reports.find((report) => report.campaign_id === campaign.id) ?? null;
    const latestImport = imports.find((entry) => entry.product_id === campaign.product_id) ?? null;
    const publicationIds = new Set(campaignPublications.map((publication) => publication.id));
    const eligibleLearningIds = learnings.filter((learning) => publicationIds.has(learning.publication_id)).map((learning) => learning.id);
    return {
      ...campaign,
      productName: productNames.get(campaign.product_id) ?? "Product",
      publications: campaignPublications,
      missingWindows,
      conversions,
      medians,
      latestReport,
      latestImport,
      eligibleLearningIds,
    };
  });

  return (
    <main>
      <p style={{ color: "#5b705d", fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>Analytics loop</p>
      <div style={{ alignItems: "end", display: "flex", flexWrap: "wrap", gap: 20, justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 48, letterSpacing: "-0.05em", margin: "12px 0" }}>复盘与证据</h1>
          <p style={{ color: "#536057", lineHeight: 1.6, margin: 0 }}>只看当前 Workspace 的已发布内容、指标窗口和分 attribution 的转化证据。</p>
        </div>
        <span style={{ color: "#7b887d", fontSize: 13 }}>Workspace: {identity.workspaceId}</span>
      </div>

      <section style={{ background: "#e5ecdf", borderRadius: 22, marginTop: 32, padding: 24 }}>
        <p style={{ color: "#5b705d", fontSize: 13, fontWeight: 700, marginTop: 0 }}>Evidence policy</p>
        <h2 style={{ fontSize: 26, letterSpacing: "-0.04em", margin: "10px 0" }}>直接、自报、推断保持分开。</h2>
        <p style={{ color: "#536057", lineHeight: 1.6, margin: 0 }}>缺失窗口会单独标记；不足十个可比样本的 Learning 只会显示为 hypothesis，不会伪装成确定结论。</p>
      </section>

      <section style={{ display: "grid", gap: 16, marginTop: 28 }}>
        {campaignCards.length === 0 ? <p style={{ ...cardStyle, color: "#536057" }}>当前 Workspace 还没有可测量的 Campaign。</p> : campaignCards.map((campaign) => (
          <article key={campaign.id} style={cardStyle}>
            <div style={{ alignItems: "start", display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "space-between" }}>
              <div>
                <p style={{ color: "#5b705d", fontSize: 13, fontWeight: 700, margin: 0 }}>{campaign.productName}</p>
                <h2 style={{ fontSize: 28, letterSpacing: "-0.04em", margin: "8px 0" }}>{campaign.name}</h2>
                <p style={{ color: "#7b887d", fontSize: 13, margin: 0 }}>{campaign.starts_on} → {campaign.ends_on}</p>
              </div>
              <div style={{ color: "#536057", fontSize: 14, textAlign: "right" }}>
                <p style={{ margin: 0 }}><strong>{campaign.publications.length}</strong> 篇已发布</p>
                <p style={{ margin: "8px 0 0" }}><strong>{campaign.missingWindows}</strong> 个到期窗口待补</p>
                <p style={{ margin: "8px 0 0" }}>{campaign.latestReport ? `周报 ${campaign.latestReport.week_start}` : "暂无报告"}</p>
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 20 }}>
              <span style={{ background: "#e5ecdf", borderRadius: 999, color: "#315d38", fontSize: 13, padding: "7px 10px" }}>direct: {campaign.conversions.direct}</span>
              <span style={{ background: "#f4ead4", borderRadius: 999, color: "#536057", fontSize: 13, padding: "7px 10px" }}>self-reported: {campaign.conversions.selfReported}</span>
              <span style={{ background: "#eef0ea", borderRadius: 999, color: "#536057", fontSize: 13, padding: "7px 10px" }}>inferred: {campaign.conversions.inferred}</span>
            </div>

            <div style={{ borderTop: "1px solid #e6ece3", display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginTop: 20, paddingTop: 18 }}>
              {campaign.medians.map((median) => <div key={median.window} style={{ background: "#f6f7f2", borderRadius: 12, padding: 12 }}>
                <p style={{ color: "#5b705d", fontSize: 12, fontWeight: 700, margin: 0 }}>{median.window} median</p>
                <p style={{ fontSize: 20, fontWeight: 800, margin: "8px 0 4px" }}>{median.medians.impressions ?? "—"}</p>
                <p style={{ color: "#7b887d", fontSize: 12, margin: 0 }}>{median.sampleCount} 个可比样本</p>
              </div>)}
            </div>
            <div style={{ color: "#536057", display: "grid", gap: 8, fontSize: 14, marginTop: 18 }}>
              <p style={{ margin: 0 }}><strong>最近导入：</strong>{campaign.latestImport ? `${campaign.latestImport.format} · ${campaign.latestImport.accepted_rows} 行 · ${formatTime(campaign.latestImport.created_at)}` : "暂无指标导入"}</p>
              <p style={{ margin: 0 }}><strong>Eligible Learning：</strong>{campaign.eligibleLearningIds.length > 0 ? campaign.eligibleLearningIds.join("、") : "暂无"}</p>
            </div>

            {campaign.publications.length > 0 ? <div style={{ borderTop: "1px solid #e6ece3", display: "grid", gap: 10, marginTop: 22, paddingTop: 18 }}>
              {campaign.publications.slice(0, 8).map((publication) => <Link key={publication.id} href={`/app/publications/${publication.id}`} style={{ alignItems: "center", color: "#315d38", display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "space-between", textDecoration: "none" }}>
                <span style={{ fontFamily: "monospace", fontSize: 13 }}>{publication.id}</span>
                <span style={{ color: "#536057", fontFamily: "inherit", fontSize: 13 }}>{statusText(publication.status)} · {formatTime(publication.published_at)} →</span>
              </Link>)}
            </div> : null}
          </article>
        ))}
      </section>
    </main>
  );
}
