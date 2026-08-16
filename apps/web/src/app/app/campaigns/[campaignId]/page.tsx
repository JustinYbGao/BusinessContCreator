import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServiceRoleClient, requireServerInternalAdmin } from "../../../../lib/supabase/server";

type PageProps = { params: Promise<{ campaignId: string }> };
type Topic = { id: string; title: string; angle: string; pillar: string; selected: boolean; total_score: number };

const cardStyle = { background: "#fff", border: "1px solid #dbe4d8", borderRadius: 18, padding: 24 };

function statusText(status: string): string {
  return ({ PUBLISHED: "已发布", MEASURING: "测量中", RETROSPECTED: "已复盘" } as Record<string, string>)[status] ?? status;
}

export default async function CampaignPage({ params }: PageProps) {
  const identity = await requireServerInternalAdmin();
  const { campaignId } = await params;
  const supabase = createSupabaseServiceRoleClient();
  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("id,name,product_id,goal,audience,pillar_quotas,starts_on,ends_on")
    .eq("workspace_id", identity.workspaceId)
    .eq("id", campaignId)
    .maybeSingle();
  if (campaignError || !campaign) notFound();

  const [productResult, topicsResult, publicationsResult] = await Promise.all([
    supabase.from("products").select("id,name,positioning").eq("workspace_id", identity.workspaceId).eq("id", campaign.product_id).is("deleted_at", null).maybeSingle(),
    supabase.from("topic_candidates").select("id,title,angle,pillar,selected,total_score").eq("workspace_id", identity.workspaceId).eq("campaign_id", campaignId).order("total_score", { ascending: false }),
    supabase.from("publications").select("id,status,public_url,published_at,created_at").eq("workspace_id", identity.workspaceId).eq("campaign_id", campaignId).order("created_at", { ascending: false }),
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
    : (await supabase.from("learnings").select("id,publication_id,evidence_window,payload").eq("workspace_id", identity.workspaceId).in("publication_id", publicationIds).order("created_at", { ascending: false })).data ?? [];

  return (
    <main>
      <p style={{ color: "#5b705d", fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>Campaign overview</p>
      <p style={{ margin: "12px 0 4px" }}><Link href="/app/campaigns" style={{ color: "#5b705d" }}>Campaigns</Link> / {campaign.name}</p>
      <div style={{ alignItems: "end", display: "flex", flexWrap: "wrap", gap: 20, justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 46, letterSpacing: "-0.05em", margin: "10px 0" }}>{campaign.name}</h1>
          <p style={{ color: "#536057", lineHeight: 1.6, margin: 0 }}>{productResult.data.name} · {campaign.starts_on} → {campaign.ends_on}</p>
        </div>
        <Link href={`/app/campaigns/${campaignId}/topics`} style={{ background: "#315d38", borderRadius: 999, color: "#fff", fontWeight: 700, padding: "12px 18px", textDecoration: "none" }}>查看选题</Link>
      </div>

      <section style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", marginTop: 32 }}>
        <article style={cardStyle}><p style={{ color: "#5b705d", fontSize: 13, fontWeight: 700, margin: 0 }}>已选 Topic</p><p style={{ fontSize: 40, fontWeight: 800, margin: "18px 0 4px" }}>{selectedTopics.length} / 3</p><p style={{ color: "#7b887d", margin: 0 }}>本周期内容入口</p></article>
        <article style={cardStyle}><p style={{ color: "#5b705d", fontSize: 13, fontWeight: 700, margin: 0 }}>发布记录</p><p style={{ fontSize: 40, fontWeight: 800, margin: "18px 0 4px" }}>{publications.length}</p><p style={{ color: "#7b887d", margin: 0 }}>保持人工最终发布</p></article>
        <article style={cardStyle}><p style={{ color: "#5b705d", fontSize: 13, fontWeight: 700, margin: 0 }}>Eligible Learning</p><p style={{ fontSize: 40, fontWeight: 800, margin: "18px 0 4px" }}>{learningRows.length}</p><p style={{ color: "#7b887d", margin: 0 }}>用于下一轮判断</p></article>
      </section>

      <section style={{ ...cardStyle, marginTop: 28 }}>
        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "space-between" }}>
          <div><p style={{ color: "#5b705d", fontSize: 13, fontWeight: 700, margin: 0 }}>下一轮选题</p><h2 style={{ fontSize: 28, margin: "8px 0" }}>先看三条已选 Topic</h2></div>
          <Link href={`/app/campaigns/${campaignId}/topics`} style={{ color: "#315d38", fontWeight: 700 }}>调整选择 →</Link>
        </div>
        {selectedTopics.length === 0 ? <p style={{ color: "#536057", marginBottom: 0 }}>还没有选定 Topic。</p> : <ol style={{ color: "#536057", lineHeight: 1.7, marginBottom: 0, paddingLeft: 22 }}>{selectedTopics.map((topic) => <li key={topic.id}><strong style={{ color: "#17211b" }}>{topic.title}</strong> · {topic.pillar}<br /><span>{topic.angle}</span></li>)}</ol>}
      </section>

      <section style={{ ...cardStyle, marginTop: 28 }}>
        <p style={{ color: "#5b705d", fontSize: 13, fontWeight: 700, margin: 0 }}>最近表现</p>
        {publications.length === 0 ? <p style={{ color: "#536057", marginBottom: 0 }}>还没有发布记录。</p> : <div style={{ display: "grid", gap: 10, marginTop: 16 }}>{publications.slice(0, 8).map((publication) => <Link href={`/app/publications/${publication.id}`} key={publication.id} style={{ alignItems: "center", borderBottom: "1px solid #e6ece3", color: "#315d38", display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between", padding: "10px 0", textDecoration: "none" }}><span style={{ fontFamily: "monospace", fontSize: 13 }}>{publication.id}</span><span style={{ color: "#536057", fontFamily: "inherit" }}>{statusText(publication.status)} · {snapshotCounts.get(publication.id) ?? 0}/3 指标窗口</span></Link>)}</div>}
      </section>
    </main>
  );
}
