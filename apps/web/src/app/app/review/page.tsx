import { randomUUID } from "node:crypto";
import Link from "next/link";
import { createSupabaseServiceRoleClient, requireServerInternalAdmin } from "../../../lib/supabase/server";

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
  const identity = await requireServerInternalAdmin();
  const supabase = createSupabaseServiceRoleClient();
  const { data: contents, error: contentsError } = await supabase
    .from("contents")
    .select("id,campaign_id,topic_id,status")
    .eq("workspace_id", identity.workspaceId)
    .eq("status", "review_required");
  const contentIds = (contents ?? []).map((content) => content.id);
  const [versionsResult, topicsResult] = await Promise.all([
    contentIds.length === 0 ? Promise.resolve({ data: [], error: null }) : supabase.from("content_versions").select("id,content_id,version,status").eq("workspace_id", identity.workspaceId).in("content_id", contentIds).order("version", { ascending: false }),
    contents && contents.length > 0 ? supabase.from("topic_candidates").select("id,title").eq("workspace_id", identity.workspaceId).in("id", contents.map((content) => content.topic_id)) : Promise.resolve({ data: [], error: null }),
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
      <p style={{ color: "#5b705d", fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>Human review</p>
      <h1 style={{ fontSize: 48, letterSpacing: "-0.05em", margin: "12px 0" }}>审核队列</h1>
      <p style={{ color: "#536057", lineHeight: 1.6, margin: 0 }}>阻塞性 findings 优先显示；没有当前通过的 Review，不提供强制通过路径。</p>
      {contentsError ? <p style={{ background: "#f7e4df", borderRadius: 16, color: "#7c2d22", marginTop: 28, padding: 18 }}>暂时无法加载审核队列。</p> : null}
      <section aria-label="待审核内容" style={{ display: "grid", gap: 16, marginTop: 28 }}>
        {items.length === 0 ? <p style={{ background: "#fff", border: "1px solid #dbe4d8", borderRadius: 18, color: "#536057", padding: 24 }}>当前没有需要人工审核的内容版本。</p> : items.map((item) => {
          const blocking = item.findings.filter((finding) => finding.severity === "blocking");
          const canApprove = item.result === "passed" && blocking.length === 0;
          return <article key={item.versionId} style={{ background: "#fff", border: blocking.length > 0 ? "2px solid #c95745" : "1px solid #dbe4d8", borderRadius: 18, padding: 24 }}>
            <div style={{ alignItems: "start", display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "space-between" }}>
              <div><p style={{ color: "#5b705d", fontSize: 13, fontWeight: 700, margin: 0 }}>Content Version {item.version}</p><h2 style={{ fontSize: 25, margin: "8px 0" }}>{item.topicTitle}</h2><Link href={`/app/contents/${item.contentId}`} style={{ color: "#315d38", fontSize: 13 }}>打开内容详情 →</Link></div>
              <span style={{ background: blocking.length > 0 ? "#f7e4df" : "#e5ecdf", borderRadius: 999, color: blocking.length > 0 ? "#7c2d22" : "#315d38", fontSize: 13, fontWeight: 700, padding: "7px 10px" }}>{blocking.length > 0 ? `${blocking.length} 个阻塞` : item.result === "passed" ? "审核通过" : "待审核"}</span>
            </div>
            {item.findings.length > 0 ? <ul style={{ color: "#536057", lineHeight: 1.6, marginBottom: 0, paddingLeft: 20 }}>{item.findings.map((finding) => <li key={`${finding.code}-${finding.message}`}><strong>{finding.severity} · {finding.code}</strong>：{finding.message}</li>)}</ul> : <p style={{ color: "#7b887d" }}>暂无当前 Review findings。</p>}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
              <form action={`/api/contents/${item.contentId}/review`} method="post"><input name="contentVersionId" type="hidden" value={item.versionId} /><input name="idempotencyKey" type="hidden" value={`review:${item.versionId}:${randomUUID()}`} /><button type="submit" style={{ background: "#f4ead4", border: 0, borderRadius: 999, color: "#536057", cursor: "pointer", fontWeight: 700, padding: "10px 14px" }}>重新审核</button></form>
              {canApprove ? <form action={`/api/contents/${item.contentId}/approve`} method="post"><input name="contentVersionId" type="hidden" value={item.versionId} /><input name="idempotencyKey" type="hidden" value={`approve:${item.versionId}:${randomUUID()}`} /><button type="submit" style={{ background: "#315d38", border: 0, borderRadius: 999, color: "#fff", cursor: "pointer", fontWeight: 700, padding: "10px 14px" }}>批准当前版本</button></form> : null}
            </div>
          </article>;
        })}
      </section>
    </main>
  );
}
