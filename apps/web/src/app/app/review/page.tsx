import { randomUUID } from "node:crypto";
import Link from "next/link";
import { IconMark, StatusPill } from "../../../components/console-ui";
import { createSupabaseServiceRoleClient, requireServerInternalWorkspace } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

type ReviewItem = {
  contentId: string;
  versionId: string;
  version: number;
  status: string;
  topicTitle: string;
  result: string | null;
  findings: Array<{ severity: string; code: string; message: string }>;
};

export default async function ReviewPage() {
  const context = await requireServerInternalWorkspace();
  const supabase = createSupabaseServiceRoleClient();
  const { data: contents, error: contentsError } = await supabase
    .from("contents")
    .select("id,campaign_id,topic_id,status")
    .eq("workspace_id", context.workspaceId)
    .eq("status", "review_required");
  const contentIds = (contents ?? []).map((content) => content.id);
  const [versionsResult, topicsResult] = await Promise.all([
    contentIds.length === 0 ? Promise.resolve({ data: [], error: null }) : supabase.from("content_versions").select("id,content_id,version,status").eq("workspace_id", context.workspaceId).in("content_id", contentIds).order("version", { ascending: false }),
    contents && contents.length > 0 ? supabase.from("topic_candidates").select("id,title").eq("workspace_id", context.workspaceId).in("id", contents.map((content) => content.topic_id)) : Promise.resolve({ data: [], error: null }),
  ]);
  const versions = versionsResult.data ?? [];
  const versionIds = versions.map((version) => version.id);
  const runsResult = versionIds.length === 0 ? { data: [], error: null } : await supabase.from("review_runs").select("id,content_version_id,result,is_current,run_number").in("content_version_id", versionIds).eq("is_current", true);
  const runIds = (runsResult.data ?? []).map((run) => run.id);
  const findingsResult = runIds.length === 0 ? { data: [], error: null } : await supabase.from("review_findings").select("review_run_id,severity,code,message").in("review_run_id", runIds);
  const topicTitles = new Map((topicsResult.data ?? []).map((topic) => [topic.id, topic.title]));
  const runByVersion = new Map((runsResult.data ?? []).map((run) => [run.content_version_id, run]));
  const findingsByRun = new Map<string, ReviewItem["findings"]>();
  for (const finding of findingsResult.data ?? []) findingsByRun.set(finding.review_run_id, [...(findingsByRun.get(finding.review_run_id) ?? []), finding]);
  const latestVersionByContent = new Map<string, (typeof versions)[number]>();
  for (const version of versions) if (!latestVersionByContent.has(version.content_id)) latestVersionByContent.set(version.content_id, version);
  const items: ReviewItem[] = (contents ?? []).flatMap((content) => {
    const version = latestVersionByContent.get(content.id);
    if (!version) return [];
    const run = runByVersion.get(version.id);
    const findings = run ? [...(findingsByRun.get(run.id) ?? [])].sort((left, right) => Number(right.severity === "blocking") - Number(left.severity === "blocking")) : [];
    return [{ contentId: content.id, versionId: version.id, version: version.version, status: version.status, topicTitle: topicTitles.get(content.topic_id) ?? "未命名 Topic", result: run?.result ?? null, findings }];
  }).sort((left, right) => right.findings.filter((finding) => finding.severity === "blocking").length - left.findings.filter((finding) => finding.severity === "blocking").length);

  return (
    <main>
      <div className="page-heading page-heading--compact">
        <div>
          <p className="eyebrow">Human review</p>
          <h1>审核队列</h1>
          <p>阻塞性 findings 优先显示；没有当前通过的 Review，不提供强制通过路径。</p>
        </div>
        <Link className="button button-secondary" href="/app"><IconMark name="arrow" size={16} />返回工作台</Link>
      </div>

      {contentsError ? <div className="alert alert-danger" role="alert"><strong>暂时无法加载审核队列。</strong></div> : null}
      <section aria-label="待审核内容" className="surface-list">
        {items.length === 0 ? (
          <div className="empty-state surface-card">
            <p>当前没有需要人工审核的内容版本。</p>
            <Link className="text-link" href="/app/campaigns">前往选题库 <IconMark name="arrow" size={15} /></Link>
          </div>
        ) : items.map((item) => {
          const blocking = item.findings.filter((finding) => finding.severity === "blocking");
          const canApprove = item.result === "passed" && blocking.length === 0;
          const statusTone = blocking.length > 0 ? "danger" : item.result === "passed" ? "healthy" : "attention";
          const statusLabel = blocking.length > 0 ? `${blocking.length} 个阻塞` : item.result === "passed" ? "审核通过" : "待审核";
          return (
            <article className="surface-card" data-attention={blocking.length > 0} key={item.versionId}>
              <div className="surface-card-header">
                <div>
                  <p className="eyebrow">Content Version {item.version}</p>
                  <h2>{item.topicTitle}</h2>
                  <p><Link href={`/app/contents/${item.contentId}`}>打开内容详情 <IconMark name="arrow" size={14} /></Link></p>
                </div>
                <StatusPill label={statusLabel} tone={statusTone} />
              </div>
              {item.findings.length > 0 ? (
                <ul className="content-list">
                  {item.findings.map((finding) => <li key={`${finding.code}-${finding.message}`}><strong>{finding.severity} · {finding.code}</strong>：{finding.message}</li>)}
                </ul>
              ) : <p className="card-copy card-copy--muted">暂无当前 Review findings。</p>}
              <div className="form-actions">
                <form action={`/api/contents/${item.contentId}/review`} method="post">
                  <input name="contentVersionId" type="hidden" value={item.versionId} />
                  <input name="idempotencyKey" type="hidden" value={`review:${item.versionId}:${randomUUID()}`} />
                  <button className="button button-quiet button-small" type="submit">重新审核</button>
                </form>
                {canApprove ? (
                  <form action={`/api/contents/${item.contentId}/approve`} method="post">
                    <input name="contentVersionId" type="hidden" value={item.versionId} />
                    <input name="idempotencyKey" type="hidden" value={`approve:${item.versionId}:${randomUUID()}`} />
                    <button className="button button-primary button-small" type="submit">批准当前版本</button>
                  </form>
                ) : null}
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
