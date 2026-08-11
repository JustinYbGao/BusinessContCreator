import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContentDraftSchema, type ContentDraft } from "@social-agent/contracts/content";
import { createSupabaseServiceRoleClient, requireServerInternalAdmin } from "../../../../lib/supabase/server";

type PageProps = { params: Promise<{ contentId: string }> };
type VersionRow = {
  id: string;
  version: number;
  payload: unknown;
  prompt_version: string;
  model_name: string;
  content_sha256: string;
  status: string;
  edit_reason: string | null;
  created_by: string;
  created_at: string;
};
type FactRow = { id: string; statement: string; category: string };
type AssetRow = { id: string; kind: string; source_locator: string | null };
type AuditRow = { entity_id: string | null; payload: unknown };

const cardStyle = { background: "#fff", border: "1px solid #dbe4d8", borderRadius: 18, padding: 24 };
const labelStyle = { color: "#5b705d", fontSize: 13, fontWeight: 700, margin: "0 0 8px" };
const inputStyle = { border: "1px solid #b8c8b8", borderRadius: 10, boxSizing: "border-box" as const, font: "inherit", padding: "10px 12px", width: "100%" };

function payloadOf(row: VersionRow): ContentDraft | null {
  const parsed = ContentDraftSchema.safeParse(row.payload);
  return parsed.success ? parsed.data : null;
}

export default async function ContentEditorPage({ params }: PageProps) {
  const identity = await requireServerInternalAdmin();
  const { contentId } = await params;
  const supabase = createSupabaseServiceRoleClient();
  const { data: content, error: contentError } = await supabase
    .from("contents")
    .select("id,product_id,campaign_id,topic_id,status,created_by,created_at")
    .eq("workspace_id", identity.workspaceId)
    .eq("id", contentId)
    .maybeSingle();
  if (contentError || !content) notFound();

  const [campaignResult, topicResult, briefResult, versionsResult, factsResult, assetsResult, auditsResult] = await Promise.all([
    supabase.from("campaigns").select("id,name,goal,audience").eq("workspace_id", identity.workspaceId).eq("id", content.campaign_id).maybeSingle(),
    supabase.from("topic_candidates").select("id,title,angle,pillar,selected").eq("workspace_id", identity.workspaceId).eq("id", content.topic_id).maybeSingle(),
    supabase.from("content_briefs").select("id,payload,created_at").eq("workspace_id", identity.workspaceId).eq("product_id", content.product_id).eq("campaign_id", content.campaign_id).eq("topic_id", content.topic_id).maybeSingle(),
    supabase.from("content_versions").select("id,version,payload,prompt_version,model_name,content_sha256,status,edit_reason,created_by,created_at").eq("workspace_id", identity.workspaceId).eq("content_id", contentId).order("version", { ascending: false }),
    supabase.from("product_facts").select("id,statement,category").eq("workspace_id", identity.workspaceId).eq("product_id", content.product_id).eq("status", "verified").eq("public_use_allowed", true),
    supabase.from("assets").select("id,kind,source_locator").eq("workspace_id", identity.workspaceId).eq("product_id", content.product_id).eq("provenance", "source").eq("verification_status", "verified").eq("public_use_allowed", true),
    supabase.from("audit_events").select("entity_id,payload").eq("workspace_id", identity.workspaceId).eq("entity_type", "content_version").eq("action", "content_version.edited").order("created_at"),
  ]);
  if (campaignResult.error || topicResult.error || briefResult.error || versionsResult.error || factsResult.error || assetsResult.error || auditsResult.error || !campaignResult.data || !topicResult.data || !briefResult.data) notFound();

  const versions = (versionsResult.data ?? []) as VersionRow[];
  const currentVersion = versions[0] ?? null;
  const currentPayload = currentVersion ? payloadOf(currentVersion) : null;
  const factRows = (factsResult.data ?? []) as FactRow[];
  const facts = new Map<string, FactRow>(factRows.map((fact): [string, FactRow] => [fact.id, fact]));
  const assets = (assetsResult.data ?? []) as AssetRow[];
  const editReasons = new Map<string, string>();
  for (const audit of (auditsResult.data ?? []) as AuditRow[]) {
    const payload = audit.payload && typeof audit.payload === "object" && !Array.isArray(audit.payload) ? audit.payload as Record<string, unknown> : {};
    if (audit.entity_id && typeof payload.editReason === "string") editReasons.set(audit.entity_id, payload.editReason);
  }
  const brief = briefResult.data.payload as Record<string, unknown>;
  const generateKey = `content:${contentId}:${randomUUID()}`;

  return (
    <main>
      <p style={{ color: "#5b705d", fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>Content editor</p>
      <p style={{ margin: "12px 0 4px" }}><Link href="/app" style={{ color: "#5b705d" }}>工作台</Link> / 内容版本</p>
      <div style={{ alignItems: "end", display: "flex", flexWrap: "wrap", gap: 20, justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 42, letterSpacing: "-0.05em", margin: "10px 0" }}>{topicResult.data.title}</h1>
          <p style={{ color: "#536057", lineHeight: 1.6, margin: 0 }}>{campaignResult.data.name} · {topicResult.data.pillar} · {content.status}</p>
        </div>
        {!currentVersion ? (
          <form action={`/api/contents/${contentId}/generate`} method="post">
            <input name="idempotencyKey" type="hidden" value={generateKey} />
            <button type="submit" style={{ background: "#315d38", border: 0, borderRadius: 999, color: "#fff", cursor: "pointer", fontWeight: 700, padding: "12px 18px" }}>排队生成内容</button>
          </form>
        ) : null}
      </div>

      <section style={{ ...cardStyle, marginTop: 28 }}>
        <p style={labelStyle}>Content brief</p>
        <p style={{ color: "#536057", lineHeight: 1.6, margin: 0 }}>{campaignResult.data.goal} · 面向 {campaignResult.data.audience}</p>
        <p style={{ color: "#536057", lineHeight: 1.6 }}>{topicResult.data.angle}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <span style={{ background: "#e5ecdf", borderRadius: 999, color: "#315d38", fontSize: 13, padding: "6px 10px" }}>Facts {Array.isArray(brief.factIds) ? brief.factIds.length : 0}</span>
          <span style={{ background: "#f4ead4", borderRadius: 999, color: "#536057", fontSize: 13, padding: "6px 10px" }}>Assets {Array.isArray(brief.assetIds) ? brief.assetIds.length : 0}</span>
          <span style={{ background: "#eef0ea", borderRadius: 999, color: "#536057", fontSize: 13, padding: "6px 10px" }}>CTA {String(brief.desiredCta ?? "未设置")}</span>
        </div>
      </section>

      {!currentVersion || !currentPayload ? (
        <section style={{ ...cardStyle, marginTop: 18 }}>
          <h2 style={{ marginTop: 0 }}>等待生成</h2>
          <p style={{ color: "#536057", lineHeight: 1.6, marginBottom: 0 }}>内容版本尚未生成，生成任务会在服务端使用本 Brief 和已验证事实。</p>
        </section>
      ) : (
        <>
          <form action={`/api/contents/${contentId}/generate`} method="post" style={{ display: "grid", gap: 18, marginTop: 28 }}>
            <input name="action" type="hidden" value="edit" />
            <input name="idempotencyKey" type="hidden" value={`edit:${contentId}:${randomUUID()}`} />
            <section style={cardStyle}>
              <div style={{ display: "grid", gap: 18, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
                <div>
                  <p style={labelStyle}>Recommended title</p>
                  <input defaultValue={currentPayload.recommendedTitle} name="recommendedTitle" style={inputStyle} />
                </div>
                <div>
                  <p style={labelStyle}>Hashtags · 用空格或逗号分隔</p>
                  <input defaultValue={currentPayload.hashtags.join(" ")} name="hashtags" style={inputStyle} />
                </div>
              </div>
              <p style={{ ...labelStyle, marginTop: 22 }}>Title candidates</p>
              <div style={{ display: "grid", gap: 10 }}>
                {currentPayload.titleCandidates.map((title, index) => <input key={`title-${index + 1}`} defaultValue={title} name={`titleCandidate${index + 1}`} style={inputStyle} />)}
              </div>
              <p style={{ ...labelStyle, marginTop: 22 }}>Body</p>
              <textarea defaultValue={currentPayload.body} name="body" rows={10} style={{ ...inputStyle, lineHeight: 1.6, resize: "vertical" }} />
              <p style={{ ...labelStyle, marginTop: 22 }}>Interaction prompt</p>
              <input defaultValue={currentPayload.interactionPrompt} name="interactionPrompt" style={inputStyle} />
            </section>

            <section style={cardStyle}>
              <p style={labelStyle}>Seven-page script</p>
              <div style={{ display: "grid", gap: 16 }}>
                {currentPayload.pages.map((page) => (
                  <fieldset key={page.page} style={{ border: "1px solid #dbe4d8", borderRadius: 14, padding: 16 }}>
                    <legend style={{ color: "#315d38", fontWeight: 800, padding: "0 8px" }}>Page {page.page} · {page.purpose}</legend>
                    <input defaultValue={page.headline} name={`page${page.page}Headline`} style={inputStyle} />
                    <textarea defaultValue={page.body} name={`page${page.page}Body`} rows={3} style={{ ...inputStyle, lineHeight: 1.6, marginTop: 10, resize: "vertical" }} />
                    {page.sourceAssetId ? <p style={{ color: "#7b887d", fontSize: 12, marginBottom: 0 }}>Source asset: {page.sourceAssetId}</p> : null}
                  </fieldset>
                ))}
              </div>
            </section>

            <section style={cardStyle}>
              <p style={labelStyle}>Claim Ledger · 只读 Fact 引用</p>
              <ul style={{ color: "#536057", lineHeight: 1.6, margin: 0, paddingLeft: 20 }}>
                {currentPayload.claims.map((claim) => <li key={claim.factId}><strong>{facts.get(claim.factId)?.statement ?? `Fact ${claim.factId}`}</strong><br />{claim.text}<br /><small>Fact ID: {claim.factId}</small></li>)}
              </ul>
            </section>

            <section style={cardStyle}>
              <p style={labelStyle}>Source Facts</p>
              <ul style={{ color: "#536057", lineHeight: 1.6, margin: 0, paddingLeft: 20 }}>
                {facts.size === 0 ? <li>暂无可用 Fact</li> : Array.from(facts.values()).map((fact) => <li key={fact.id}>{fact.statement} <small>({fact.category} · {fact.id})</small></li>)}
              </ul>
              <p style={{ ...labelStyle, marginTop: 22 }}>Source Assets</p>
              <ul style={{ color: "#536057", lineHeight: 1.6, margin: 0, paddingLeft: 20 }}>
                {assets.length === 0 ? <li>暂无可用来源素材</li> : assets.map((asset) => <li key={asset.id}>{asset.kind} · {asset.source_locator ?? "source asset"} <small>({asset.id})</small></li>)}
              </ul>
            </section>

            <section style={cardStyle}>
              <p style={labelStyle}>Version metadata</p>
              <p style={{ color: "#536057", lineHeight: 1.6 }}>Model: {currentVersion.model_name}<br />Prompt version: {currentVersion.prompt_version}<br />SHA-256: {currentVersion.content_sha256}</p>
              <label htmlFor="edit-reason" style={labelStyle}>人工编辑原因（必填）</label>
              <input id="edit-reason" name="editReason" required placeholder="例如：修正为已确认的使用场景" style={inputStyle} />
              <button type="submit" style={{ background: "#315d38", border: 0, borderRadius: 999, color: "#fff", cursor: "pointer", fontWeight: 700, marginTop: 16, padding: "12px 18px" }}>保存为新版本</button>
            </section>
          </form>
        </>
      )}

      <section style={{ ...cardStyle, marginTop: 18 }}>
        <p style={labelStyle}>Version history</p>
        {versions.length === 0 ? <p style={{ color: "#536057", marginBottom: 0 }}>暂无历史版本。</p> : (
          <ol style={{ color: "#536057", lineHeight: 1.6, margin: 0, paddingLeft: 22 }}>
            {versions.map((version) => <li key={version.id}><strong>v{version.version} · {version.status}</strong> · {version.model_name} · prompt {version.prompt_version}<br />创建者：{version.created_by} · 编辑原因：{version.edit_reason ?? editReasons.get(version.id) ?? "模型生成"}<br /><small>{version.created_at} · {version.content_sha256}</small></li>)}
          </ol>
        )}
      </section>
    </main>
  );
}
