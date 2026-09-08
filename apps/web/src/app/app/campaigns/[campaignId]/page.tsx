import Link from "next/link";
import { notFound } from "next/navigation";
import { IconMark, StatusPill } from "../../../../components/console-ui";
import { createSupabaseServiceRoleClient, requireServerInternalWorkspace } from "../../../../lib/supabase/server";

type PageProps = { params: Promise<{ campaignId: string }> };
type Topic = { id: string; title: string; angle: string; pillar: string; selected: boolean; total_score: number };

function statusText(status: string): string {
  return ({ PUBLISHED: "已发布", MEASURING: "测量中", RETROSPECTED: "已复盘" } as Record<string, string>)[status] ?? status;
}

function statusTone(status: string): "attention" | "healthy" | "quiet" {
  if (status === "MEASURING") return "attention";
  if (status === "PUBLISHED") return "healthy";
  return "quiet";
}

export default async function CampaignPage({ params }: PageProps) {
  const context = await requireServerInternalWorkspace();
  const { campaignId } = await params;
  const supabase = createSupabaseServiceRoleClient();
  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("id,name,product_id,goal,audience,pillar_quotas,starts_on,ends_on")
    .eq("workspace_id", context.workspaceId)
    .eq("id", campaignId)
    .maybeSingle();
  if (campaignError || !campaign) notFound();

  const [productResult, topicsResult, publicationsResult] = await Promise.all([
    supabase.from("products").select("id,name,positioning").eq("workspace_id", context.workspaceId).eq("id", campaign.product_id).is("deleted_at", null).maybeSingle(),
    supabase.from("topic_candidates").select("id,title,angle,pillar,selected,total_score").eq("workspace_id", context.workspaceId).eq("campaign_id", campaignId).order("total_score", { ascending: false }),
    supabase.from("publications").select("id,status,public_url,published_at,created_at").eq("workspace_id", context.workspaceId).eq("campaign_id", campaignId).order("created_at", { ascending: false }),
  ]);
  if (productResult.error || !productResult.data || topicsResult.error || publicationsResult.error) notFound();

  const topics = (topicsResult.data ?? []) as Topic[];
  const selectedTopics = topics.filter((topic) => topic.selected).slice(0, 3);
  const publications = publicationsResult.data ?? [];
  const publicationIds = publications.map((publication) => publication.id);
  const snapshotsResult = publicationIds.length === 0
    ? { data: [], error: null }
    : await supabase.from("metric_snapshots").select("publication_id,window").in("publication_id", publicationIds);
  const snapshotCounts = new Map<string, number>();
  for (const snapshot of snapshotsResult.data ?? []) snapshotCounts.set(snapshot.publication_id, (snapshotCounts.get(snapshot.publication_id) ?? 0) + 1);

  const learningRows = publicationIds.length === 0
    ? []
    : (await supabase.from("learnings").select("id,publication_id,evidence_window,payload").eq("workspace_id", context.workspaceId).in("publication_id", publicationIds).order("created_at", { ascending: false })).data ?? [];

  return (
    <main>
      <div className="page-heading page-heading--compact">
        <div>
          <p className="breadcrumb"><Link href="/app/campaigns">内容运营周期</Link> / {campaign.name}</p>
          <p className="eyebrow">Campaign overview</p>
          <h1>{campaign.name}</h1>
          <p>{productResult.data.name} · {campaign.starts_on} → {campaign.ends_on}</p>
        </div>
        <div className="page-heading-action">
          <Link className="button button-secondary" href="/app/campaigns"><IconMark name="arrow" size={16} />全部周期</Link>
          <Link className="button button-primary" href={`/app/campaigns/${campaignId}/topics`}>查看选题 <IconMark name="arrow" size={16} /></Link>
        </div>
      </div>

      <section aria-label="周期概览" className="detail-grid">
        <div className="metric-panel"><span className="metric-panel-label">已选 Topic</span><p className="metric-panel-value">{selectedTopics.length} / 3</p><p className="metric-panel-caption">本周期内容入口</p></div>
        <div className="metric-panel"><span className="metric-panel-label">发布记录</span><p className="metric-panel-value">{publications.length}</p><p className="metric-panel-caption">保持人工最终发布</p></div>
        <div className="metric-panel"><span className="metric-panel-label">Eligible Learning</span><p className="metric-panel-value">{learningRows.length}</p><p className="metric-panel-caption">用于下一轮判断</p></div>
      </section>

      <section className="surface-card surface-card--spaced">
        <div className="surface-card-header">
          <div>
            <p className="eyebrow">下一轮选题</p>
            <h2>先看三条已选 Topic</h2>
          </div>
          <Link href={`/app/campaigns/${campaignId}/topics`}>调整选择 <IconMark name="arrow" size={15} /></Link>
        </div>
        {selectedTopics.length === 0 ? <p className="card-copy">还没有选定 Topic。</p> : (
          <ol className="schedule-list">
            {selectedTopics.map((topic) => <li key={topic.id}><strong>{topic.title}</strong> · {topic.pillar}<br />{topic.angle}</li>)}
          </ol>
        )}
      </section>

      <section className="surface-card surface-card--spaced-small">
        <p className="eyebrow">最近表现</p>
        {publications.length === 0 ? <p className="card-copy">还没有发布记录。</p> : (
          <div className="data-list">
            {publications.slice(0, 8).map((publication) => (
              <Link className="data-list-row" href={`/app/publications/${publication.id}`} key={publication.id}>
                <span className="mono">{publication.id}</span>
                <span><StatusPill label={statusText(publication.status)} tone={statusTone(publication.status)} /> · {snapshotCounts.get(publication.id) ?? 0}/3 指标窗口 <IconMark name="arrow" size={14} /></span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
