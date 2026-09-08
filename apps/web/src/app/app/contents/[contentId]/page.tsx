import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContentDraftSchema, type ContentDraft } from "@social-agent/contracts/content";
import { IconMark, StatusPill } from "../../../../components/console-ui";
import { createSupabaseServiceRoleClient, requireServerInternalWorkspace } from "../../../../lib/supabase/server";

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

function payloadOf(row: VersionRow): ContentDraft | null {
  const parsed = ContentDraftSchema.safeParse(row.payload);
  return parsed.success ? parsed.data : null;
}

function statusText(status: string): string {
  return ({
    draft: "草稿",
    generated: "已生成",
    review_required: "待审核",
    approved: "已批准",
  } as Record<string, string>)[status] ?? status;
}

function statusTone(status: string): "attention" | "healthy" | "quiet" {
  if (status === "approved") return "healthy";
  if (status === "review_required") return "attention";
  return "quiet";
}

export default async function ContentEditorPage({ params }: PageProps) {
  const context = await requireServerInternalWorkspace();
  const { contentId } = await params;
  const supabase = createSupabaseServiceRoleClient();
  const { data: content, error: contentError } = await supabase
    .from("contents")
    .select("id,product_id,campaign_id,topic_id,status,created_by,created_at")
    .eq("workspace_id", context.workspaceId)
    .eq("id", contentId)
    .maybeSingle();
  if (contentError || !content) notFound();

  const [campaignResult, topicResult, briefResult, versionsResult, factsResult, assetsResult, auditsResult] = await Promise.all([
    supabase.from("campaigns").select("id,name,goal,audience").eq("workspace_id", context.workspaceId).eq("id", content.campaign_id).maybeSingle(),
    supabase.from("topic_candidates").select("id,title,angle,pillar,selected").eq("workspace_id", context.workspaceId).eq("id", content.topic_id).maybeSingle(),
    supabase.from("content_briefs").select("id,payload,created_at").eq("workspace_id", context.workspaceId).eq("product_id", content.product_id).eq("campaign_id", content.campaign_id).eq("topic_id", content.topic_id).maybeSingle(),
    supabase.from("content_versions").select("id,version,payload,prompt_version,model_name,content_sha256,status,edit_reason,created_by,created_at").eq("workspace_id", context.workspaceId).eq("content_id", contentId).order("version", { ascending: false }),
    supabase.from("product_facts").select("id,statement,category").eq("workspace_id", context.workspaceId).eq("product_id", content.product_id).eq("status", "verified").eq("public_use_allowed", true),
    supabase.from("assets").select("id,kind,source_locator").eq("workspace_id", context.workspaceId).eq("product_id", content.product_id).eq("provenance", "source").eq("verification_status", "verified").eq("public_use_allowed", true),
    supabase.from("audit_events").select("entity_id,payload").eq("workspace_id", context.workspaceId).eq("entity_type", "content_version").eq("action", "content_version.edited").order("created_at"),
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
      <div className="page-heading page-heading--compact">
        <div>
          <p className="breadcrumb"><Link href="/app">工作台</Link> / 内容版本</p>
          <p className="eyebrow">Content editor</p>
          <h1>{topicResult.data.title}</h1>
          <p>{campaignResult.data.name} · {topicResult.data.pillar}</p>
        </div>
        <div className="page-heading-action">
          <StatusPill label={statusText(content.status)} tone={statusTone(content.status)} />
          {!currentVersion ? (
            <form action={`/api/contents/${contentId}/generate`} method="post">
              <input name="idempotencyKey" type="hidden" value={generateKey} />
              <button className="button button-primary" type="submit">排队生成内容 <IconMark name="arrow" size={16} /></button>
            </form>
          ) : null}
        </div>
      </div>

      <section className="surface-card">
        <p className="editor-section-label">Content brief</p>
        <p>{campaignResult.data.goal} · 面向 {campaignResult.data.audience}</p>
        <p>{topicResult.data.angle}</p>
        <div className="chip-row">
          <span className="chip" data-tone="healthy">Facts {Array.isArray(brief.factIds) ? brief.factIds.length : 0}</span>
          <span className="chip" data-tone="attention">Assets {Array.isArray(brief.assetIds) ? brief.assetIds.length : 0}</span>
          <span className="chip">CTA {String(brief.desiredCta ?? "未设置")}</span>
        </div>
      </section>

      {!currentVersion || !currentPayload ? (
        <section className="surface-card surface-card--spaced-small">
          <p className="eyebrow">Generation status</p>
          <h2>等待生成</h2>
          <p className="card-copy">内容版本尚未生成，生成任务会在服务端使用本 Brief 和已验证事实。</p>
        </section>
      ) : (
        <form action={`/api/contents/${contentId}/generate`} className="editor-form" method="post">
          <input name="action" type="hidden" value="edit" />
          <input name="idempotencyKey" type="hidden" value={`edit:${contentId}:${randomUUID()}`} />
          <section className="editor-section">
            <p className="editor-section-label">Content draft</p>
            <div className="editor-input-grid">
              <label className="editor-field"><span>Recommended title</span><input className="editor-input" defaultValue={currentPayload.recommendedTitle} name="recommendedTitle" /></label>
              <label className="editor-field"><span>Hashtags · 用空格或逗号分隔</span><input className="editor-input" defaultValue={currentPayload.hashtags.join(" ")} name="hashtags" /></label>
            </div>
            <div className="editor-field card-divider"><span>Title candidates</span><div className="editor-stack">{currentPayload.titleCandidates.map((title, index) => <input className="editor-input" key={`title-${index + 1}`} defaultValue={title} name={`titleCandidate${index + 1}`} />)}</div></div>
            <label className="editor-field card-divider"><span>Body</span><textarea className="editor-textarea" defaultValue={currentPayload.body} name="body" rows={10} /></label>
            <label className="editor-field card-divider"><span>Interaction prompt</span><input className="editor-input" defaultValue={currentPayload.interactionPrompt} name="interactionPrompt" /></label>
          </section>

          <section className="editor-section">
            <p className="editor-section-label">Seven-page script</p>
            <div className="editor-stack">
              {currentPayload.pages.map((page) => (
                <fieldset className="editor-fieldset" key={page.page}>
                  <legend>Page {page.page} · {page.purpose}</legend>
                  <input className="editor-input" defaultValue={page.headline} name={`page${page.page}Headline`} />
                  <textarea className="editor-textarea" defaultValue={page.body} name={`page${page.page}Body`} rows={3} />
                  {page.sourceAssetId ? <p className="card-meta">Source asset: {page.sourceAssetId}</p> : null}
                </fieldset>
              ))}
            </div>
          </section>

          <section className="editor-section">
            <p className="editor-section-label">Claim Ledger · 只读 Fact 引用</p>
            <ul className="content-list">
              {currentPayload.claims.map((claim) => <li key={claim.factId}><strong>{facts.get(claim.factId)?.statement ?? `Fact ${claim.factId}`}</strong><br />{claim.text}<br /><small>Fact ID: {claim.factId}</small></li>)}
            </ul>
          </section>

          <section className="editor-section">
            <p className="editor-section-label">Source facts & assets</p>
            <div className="two-column-copy">
              <div><h3>Source Facts</h3><ul>{facts.size === 0 ? <li>暂无可用 Fact</li> : Array.from(facts.values()).map((fact) => <li key={fact.id}>{fact.statement} <small>({fact.category} · {fact.id})</small></li>)}</ul></div>
              <div><h3>Source Assets</h3><ul>{assets.length === 0 ? <li>暂无可用来源素材</li> : assets.map((asset) => <li key={asset.id}>{asset.kind} · {asset.source_locator ?? "source asset"} <small>({asset.id})</small></li>)}</ul></div>
            </div>
          </section>

          <section className="editor-section">
            <p className="editor-section-label">Version metadata</p>
            <p>Model: {currentVersion.model_name}<br />Prompt version: {currentVersion.prompt_version}<br />SHA-256: {currentVersion.content_sha256}</p>
            <label className="editor-field"><span>人工编辑原因（必填）</span><input className="editor-input" id="edit-reason" name="editReason" required placeholder="例如：修正为已确认的使用场景" /></label>
            <button className="button button-primary" type="submit">保存为新版本 <IconMark name="arrow" size={16} /></button>
          </section>
        </form>
      )}

      <section className="surface-card surface-card--spaced-small">
        <p className="eyebrow">Version history</p>
        {versions.length === 0 ? <p className="card-copy">暂无历史版本。</p> : (
          <ol className="content-list">
            {versions.map((version) => <li key={version.id}><strong>v{version.version} · {statusText(version.status)}</strong> · {version.model_name} · prompt {version.prompt_version}<br />创建者：{version.created_by} · 编辑原因：{version.edit_reason ?? editReasons.get(version.id) ?? "模型生成"}<br /><small>{version.created_at} · {version.content_sha256}</small></li>)}
          </ol>
        )}
      </section>
    </main>
  );
}
