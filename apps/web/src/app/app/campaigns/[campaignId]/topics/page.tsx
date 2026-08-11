import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServiceRoleClient, requireServerInternalAdmin } from "../../../../../lib/supabase/server";

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
  const identity = await requireServerInternalAdmin();
  const { campaignId } = await params;
  const supabase = createSupabaseServiceRoleClient();
  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("id,name,product_id,starts_on,ends_on,pillar_quotas")
    .eq("workspace_id", identity.workspaceId)
    .eq("id", campaignId)
    .maybeSingle();
  if (campaignError || !campaign) notFound();

  const [productResult, topicsResult, factsResult] = await Promise.all([
    supabase.from("products").select("id").eq("workspace_id", identity.workspaceId).eq("id", campaign.product_id).is("deleted_at", null).maybeSingle(),
    supabase.from("topic_candidates").select("id,title,angle,pillar,fact_ids,scores,total_score,selected").eq("workspace_id", identity.workspaceId).eq("campaign_id", campaignId).order("total_score", { ascending: false }),
    supabase.from("product_facts").select("id,statement,category,status,public_use_allowed").eq("workspace_id", identity.workspaceId).eq("product_id", campaign.product_id).eq("status", "verified").eq("public_use_allowed", true),
  ]);
  if (productResult.error || !productResult.data || topicsResult.error || factsResult.error) notFound();
  const topics = (topicsResult.data ?? []) as TopicRow[];
  const factRows = (factsResult.data ?? []) as FactRow[];
  const facts = new Map(factRows.map((fact): [string, FactRow] => [fact.id, fact]));
  const selectedTopics = topics.filter((topic) => topic.selected).slice(0, 3);
  const idempotencyKey = `topics:${campaignId}:${randomUUID()}`;

  return (
    <main>
      <p style={{ color: "#5b705d", fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>Topic review</p>
      <p style={{ margin: "12px 0 4px" }}><Link href="/app" style={{ color: "#5b705d" }}>工作台</Link> / {campaign.name}</p>
      <div style={{ alignItems: "end", display: "flex", flexWrap: "wrap", gap: 20, justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 44, letterSpacing: "-0.05em", margin: "10px 0" }}>每周选题</h1>
          <p style={{ color: "#536057", lineHeight: 1.6, margin: 0 }}>{campaign.starts_on} → {campaign.ends_on} · 先看证据，再决定内容方向。</p>
        </div>
        <form action="/api/topics/generate" method="post">
          <input name="campaignId" type="hidden" value={campaignId} />
          <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
          <button type="submit" style={{ background: "#315d38", border: 0, borderRadius: 999, color: "#fff", cursor: "pointer", fontWeight: 700, padding: "12px 18px" }}>生成 9 个候选</button>
        </form>
      </div>

      <section style={{ background: "#e5ecdf", borderRadius: 22, marginTop: 28, padding: 22 }}>
        <p style={{ color: "#315d38", fontSize: 13, fontWeight: 700, margin: 0 }}>本周期配额</p>
        <p style={{ color: "#536057", lineHeight: 1.6, marginBottom: 0 }}>{JSON.stringify(campaign.pillar_quotas)}</p>
      </section>

      <section aria-label="本周建议排期" style={{ background: "#fff", border: "1px solid #dbe4d8", borderRadius: 22, marginTop: 28, padding: 24 }}>
        <p style={{ color: "#5b705d", fontSize: 13, fontWeight: 700, margin: 0 }}>本周建议排期</p>
        {selectedTopics.length === 0 ? <p style={{ color: "#536057", lineHeight: 1.6, marginBottom: 0 }}>生成并选中候选后，这里会显示 3 个本周发布槽位。</p> : (
          <ol style={{ display: "grid", gap: 10, margin: "14px 0 0", paddingLeft: 22 }}>
            {selectedTopics.map((topic, index) => <li key={topic.id} style={{ color: "#536057", lineHeight: 1.6 }}><strong style={{ color: "#17211b" }}>发布槽位 {index + 1} · {topic.title}</strong><br />{topic.pillar} · 评分 {Number(topic.total_score).toFixed(3)}</li>)}
          </ol>
        )}
      </section>

      <section style={{ display: "grid", gap: 16, marginTop: 28 }}>
        {topics.length === 0 ? <p style={{ background: "#fff", border: "1px solid #dbe4d8", borderRadius: 18, color: "#536057", padding: 24 }}>还没有候选选题。请生成一轮候选。</p> : topics.map((topic) => (
          <article key={topic.id} style={{ background: "#fff", border: topic.selected ? "2px solid #315d38" : "1px solid #dbe4d8", borderRadius: 18, padding: 24 }}>
            <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "space-between" }}>
              <span style={{ background: "#f4ead4", borderRadius: 999, color: "#536057", fontSize: 12, fontWeight: 700, padding: "6px 10px" }}>{topic.pillar}{topic.selected ? " · 本周入选" : ""}</span>
              <strong style={{ color: "#315d38", fontSize: 22 }}>{Number(topic.total_score).toFixed(3)}</strong>
            </div>
            <h2 style={{ fontSize: 24, lineHeight: 1.35, margin: "16px 0 8px" }}>{topic.title}</h2>
            <p style={{ color: "#536057", lineHeight: 1.6, marginTop: 0 }}>{topic.angle}</p>
            <div style={{ display: "grid", gap: 18, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              <div>
                <p style={{ color: "#5b705d", fontSize: 13, fontWeight: 700 }}>评分贡献</p>
                <ul style={{ color: "#536057", lineHeight: 1.6, paddingLeft: 20 }}>{scoreEntries(topic.scores).map(([name, value]) => <li key={name}>{name}: {String(value)}</li>)}</ul>
              </div>
              <div>
                <p style={{ color: "#5b705d", fontSize: 13, fontWeight: 700 }}>证据 Facts</p>
                <ul style={{ color: "#536057", lineHeight: 1.6, paddingLeft: 20 }}>{topic.fact_ids.map((factId) => <li key={factId}>{facts.get(factId)?.statement ?? `Fact ${factId}`}</li>)}</ul>
              </div>
              <div>
                <p style={{ color: "#5b705d", fontSize: 13, fontWeight: 700 }}>风险提示</p>
                <p style={{ color: "#536057", lineHeight: 1.6, marginTop: 0 }}>{Array.isArray(topic.scores.risks) && topic.scores.risks.length > 0 ? topic.scores.risks.join("；") : "暂无结构化风险提示"}</p>
              </div>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
