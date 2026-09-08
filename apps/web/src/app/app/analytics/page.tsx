import Link from "next/link";
import { buildRollingMedian, summarizeConversions, type MetricWindow } from "@social-agent/analytics";
import { IconMark } from "../../../components/console-ui";
import { metricWindowDue, parseMetricSnapshot } from "../../../lib/analytics-route";
import { createSupabaseServiceRoleClient, requireServerInternalWorkspace } from "../../../lib/supabase/server";

const WINDOWS: MetricWindow[] = ["24h", "72h", "7d"];

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
  const context = await requireServerInternalWorkspace();
  const supabase = createSupabaseServiceRoleClient();
  const [productsResult, campaignsResult, publicationsResult, reportsResult, importsResult, learningsResult] = await Promise.all([
    supabase.from("products").select("id,name").eq("workspace_id", context.workspaceId).is("deleted_at", null).order("created_at"),
    supabase.from("campaigns").select("id,name,product_id,starts_on,ends_on").eq("workspace_id", context.workspaceId).order("created_at", { ascending: false }),
    supabase.from("publications").select("id,product_id,campaign_id,status,public_url,published_at,created_at").eq("workspace_id", context.workspaceId).in("status", ["PUBLISHED", "MEASURING", "RETROSPECTED"]).order("created_at", { ascending: false }),
    supabase.from("weekly_reports").select("id,product_id,campaign_id,week_start,payload,source_snapshot_ids,created_at").eq("workspace_id", context.workspaceId).order("week_start", { ascending: false }),
    supabase.from("metric_imports").select("id,product_id,format,accepted_rows,created_at").eq("workspace_id", context.workspaceId).order("created_at", { ascending: false }),
    supabase.from("learnings").select("id,product_id,publication_id,evidence_window,created_at").eq("workspace_id", context.workspaceId).order("created_at", { ascending: false }),
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
    const campaignPublicationIds = new Set(campaignPublications.map((publication) => publication.id));
    const eligibleLearningIds = learnings.filter((learning) => campaignPublicationIds.has(learning.publication_id)).map((learning) => learning.id);
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
      <div className="page-heading page-heading--compact">
        <div>
          <p className="eyebrow">Analytics loop</p>
          <h1>复盘与证据</h1>
          <p>只看当前 Workspace 的已发布内容、指标窗口和分 attribution 的转化证据。</p>
        </div>
        <span className="page-heading-meta mono">Workspace: {context.workspaceId}</span>
      </div>

      <section className="policy-panel">
        <p className="eyebrow">Evidence policy</p>
        <h2>直接、自报、推断保持分开。</h2>
        <p>缺失窗口会单独标记；不足十个可比样本的 Learning 只会显示为 hypothesis，不会伪装成确定结论。</p>
      </section>

      <section className="surface-list">
        {campaignCards.length === 0 ? <div className="empty-state surface-card"><p>当前 Workspace 还没有可测量的 Campaign。</p></div> : campaignCards.map((campaign) => (
          <article className="surface-card" key={campaign.id}>
            <div className="surface-card-header">
              <div>
                <p className="eyebrow">{campaign.productName}</p>
                <h2><Link href={`/app/campaigns/${campaign.id}`}>{campaign.name}</Link></h2>
                <p className="card-meta">{campaign.starts_on} → {campaign.ends_on}</p>
              </div>
              <div className="card-meta">
                <strong>{campaign.publications.length}</strong> 篇已发布<br />
                <strong>{campaign.missingWindows}</strong> 个到期窗口待补<br />
                {campaign.latestReport ? `周报 ${campaign.latestReport.week_start}` : "暂无报告"}
              </div>
            </div>

            <div className="chip-row">
              <span className="chip" data-tone="healthy">direct: {campaign.conversions.direct}</span>
              <span className="chip" data-tone="attention">self-reported: {campaign.conversions.selfReported}</span>
              <span className="chip">inferred: {campaign.conversions.inferred}</span>
            </div>

            <div className="score-grid">
              {campaign.medians.map((median) => <div className="metric-panel" key={median.window}>
                <span className="metric-panel-label">{median.window} median</span>
                <p className="metric-panel-value">{median.medians.impressions ?? "—"}</p>
                <p className="metric-panel-caption">{median.sampleCount} 个可比样本</p>
              </div>)}
            </div>

            <div className="card-divider">
              <p className="card-copy"><strong>最近导入：</strong>{campaign.latestImport ? `${campaign.latestImport.format} · ${campaign.latestImport.accepted_rows} 行 · ${formatTime(campaign.latestImport.created_at)}` : "暂无指标导入"}</p>
              <p className="card-copy"><strong>Eligible Learning：</strong>{campaign.eligibleLearningIds.length > 0 ? campaign.eligibleLearningIds.join("、") : "暂无"}</p>
            </div>

            {campaign.publications.length > 0 ? <div className="data-list card-divider">
              {campaign.publications.slice(0, 8).map((publication) => <Link className="data-list-row" key={publication.id} href={`/app/publications/${publication.id}`}>
                <span className="mono">{publication.id}</span>
                <span>{statusText(publication.status)} · {formatTime(publication.published_at)} <IconMark name="arrow" size={14} /></span>
              </Link>)}
            </div> : null}
          </article>
        ))}
      </section>
    </main>
  );
}
