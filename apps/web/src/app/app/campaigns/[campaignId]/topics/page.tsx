import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IconMark } from "../../../../../components/console-ui";
import { createSupabaseServiceRoleClient, requireServerInternalWorkspace } from "../../../../../lib/supabase/server";

type PageProps = { params: Promise<{ campaignId: string }> };
type TopicRow = {
  id: string;
  title: string;
  angle: string;
  pillar: string;
  fact_ids: string[];
  scores: Record<string, unknown>;
  total_score: number;
  selected: boolean;
};
type FactRow = { id: string; statement: string; category: string; status: string; public_use_allowed: boolean };

const TOPIC_SCORE_WEIGHTS: Record<string, number> = {
  pain: 0.22,
  productFit: 0.20,
  evidence: 0.18,
  visualFeasibility: 0.12,
  timeliness: 0.10,
  repetition: -0.10,
  risk: -0.08,
};

function scoreEntries(scores: Record<string, unknown>): Array<[string, unknown]> {
  const contributions = scores.contributions;
  if (contributions && typeof contributions === "object" && !Array.isArray(contributions)) {
    return Object.entries(contributions as Record<string, unknown>);
  }
  return Object.entries(TOPIC_SCORE_WEIGHTS).flatMap(([name, weight]) => {
    const value = scores[name];
    return typeof value === "number" ? [[name, Number((value * weight).toFixed(3))]] : [];
  });
}

export default async function CampaignTopicsPage({ params }: PageProps) {
  const context = await requireServerInternalWorkspace();
  const { campaignId } = await params;
  const supabase = createSupabaseServiceRoleClient();
  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("id,name,product_id,starts_on,ends_on,pillar_quotas")
    .eq("workspace_id", context.workspaceId)
    .eq("id", campaignId)
    .maybeSingle();
  if (campaignError || !campaign) notFound();

  const [productResult, topicsResult, factsResult] = await Promise.all([
    supabase.from("products").select("id").eq("workspace_id", context.workspaceId).eq("id", campaign.product_id).is("deleted_at", null).maybeSingle(),
    supabase.from("topic_candidates").select("id,title,angle,pillar,fact_ids,scores,total_score,selected").eq("workspace_id", context.workspaceId).eq("campaign_id", campaignId).order("total_score", { ascending: false }),
    supabase.from("product_facts").select("id,statement,category,status,public_use_allowed").eq("workspace_id", context.workspaceId).eq("product_id", campaign.product_id).eq("status", "verified").eq("public_use_allowed", true),
  ]);
  if (productResult.error || !productResult.data || topicsResult.error || factsResult.error) notFound();
  const topics = (topicsResult.data ?? []) as TopicRow[];
  const factRows = (factsResult.data ?? []) as FactRow[];
  const facts = new Map(factRows.map((fact): [string, FactRow] => [fact.id, fact]));
  const selectedTopics = topics.filter((topic) => topic.selected).slice(0, 3);
  const idempotencyKey = `topics:${campaignId}:${randomUUID()}`;

  return (
    <main>
      <div className="page-heading page-heading--compact">
        <div>
          <p className="breadcrumb"><Link href={`/app/campaigns/${campaignId}`}>{campaign.name}</Link> / 选题</p>
          <p className="eyebrow">Topic review</p>
          <h1>每周选题</h1>
          <p>{campaign.starts_on} → {campaign.ends_on} · 先看证据，再决定内容方向。</p>
        </div>
        <form action="/api/topics/generate" method="post">
          <input name="campaignId" type="hidden" value={campaignId} />
          <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
          <button className="button button-primary" type="submit">生成 9 个候选 <IconMark name="arrow" size={16} /></button>
        </form>
      </div>

      <section className="policy-panel">
        <p className="eyebrow">本周期配额</p>
        <p>{JSON.stringify(campaign.pillar_quotas)}</p>
      </section>

      <form action="/api/topics/select" className="surface-card surface-card--spaced" method="post">
        <input name="campaignId" type="hidden" value={campaignId} />
        <div className="surface-card-header">
          <div>
            <p className="eyebrow">人工选题确认</p>
            <p>选择恰好 3 个候选，作为本周内容生产入口。</p>
          </div>
          <button className="button button-primary" type="submit">保存本周 3 个选题</button>
        </div>
        <div className="topic-select-grid">
          {topics.map((topic) => (
            <label className="topic-select-option" key={topic.id}>
              <input aria-label={`选择 ${topic.title}`} defaultChecked={topic.selected} name="topicId" type="checkbox" value={topic.id} />
              <span>{topic.title}<br /><small>{topic.pillar} · {Number(topic.total_score).toFixed(3)}</small></span>
            </label>
          ))}
        </div>
      </form>

      <section aria-label="本周建议排期" className="surface-card surface-card--spaced">
        <p className="eyebrow">本周建议排期</p>
        {selectedTopics.length === 0 ? <p className="card-copy">生成并选中候选后，这里会显示 3 个本周发布槽位。</p> : (
          <ol className="schedule-list">
            {selectedTopics.map((topic, index) => <li key={topic.id}><strong>发布槽位 {index + 1} · {topic.title}</strong><br />{topic.pillar} · 评分 {Number(topic.total_score).toFixed(3)}</li>)}
          </ol>
        )}
      </section>

      <section className="surface-list">
        {topics.length === 0 ? <div className="empty-state surface-card"><p>还没有候选选题。请生成一轮候选。</p></div> : topics.map((topic) => (
          <article className="surface-card" data-selected={topic.selected} key={topic.id}>
            <div className="surface-card-header">
              <div>
                <div className="chip-row"><span className="chip" data-tone="attention">{topic.pillar}{topic.selected ? " · 本周入选" : ""}</span></div>
                <h2 className="topic-card-title">{topic.title}</h2>
              </div>
              <strong className="metric-panel-value">{Number(topic.total_score).toFixed(3)}</strong>
            </div>
            <p className="topic-card-angle">{topic.angle}</p>
            <div className="score-grid">
              <div>
                <h3>评分贡献</h3>
                <ul className="content-list">{scoreEntries(topic.scores).map(([name, value]) => <li key={name}>{name}: {String(value)}</li>)}</ul>
              </div>
              <div>
                <h3>证据 Facts</h3>
                <ul className="content-list">{topic.fact_ids.map((factId) => <li key={factId}>{facts.get(factId)?.statement ?? `Fact ${factId}`}</li>)}</ul>
              </div>
              <div>
                <h3>风险提示</h3>
                <p className="card-copy">{Array.isArray(topic.scores.risks) && topic.scores.risks.length > 0 ? topic.scores.risks.join("；") : "暂无结构化风险提示"}</p>
              </div>
            </div>
          </article>
        ))}
      </section>

      <section className="policy-panel surface-card--spaced">
        <p className="eyebrow">内容生产入口</p>
        <h2>从已确认的 Topic 开始</h2>
        <p>只有已经选中的 Topic 才能创建 Content；创建后由 Worker 继续生成版本。</p>
        {selectedTopics.length === 0 ? <p className="card-copy">保存本周选题后，这里会出现内容创建入口。</p> : (
          <div className="surface-list">
            {selectedTopics.map((topic) => (
              <form action="/api/contents" className="data-list-row" key={topic.id} method="post">
                <input name="campaignId" type="hidden" value={campaignId} />
                <input name="topicId" type="hidden" value={topic.id} />
                <input name="idempotencyKey" type="hidden" value={`content:${campaignId}:${topic.id}`} />
                <strong>{topic.title}</strong>
                <button className="button button-quiet button-small" type="submit">创建 Content <IconMark name="arrow" size={14} /></button>
              </form>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
