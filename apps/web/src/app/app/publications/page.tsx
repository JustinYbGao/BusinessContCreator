import Link from "next/link";
import { IconMark, StatusPill } from "../../../components/console-ui";
import { createSupabaseServiceRoleClient, requireServerInternalWorkspace } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

const statusGroups = [
  ["READY_TO_PREFILL", "准备预填"],
  ["PREFILLING", "预填中"],
  ["NEEDS_LOGIN", "需要人工登录"],
  ["PREFILL_FAILED", "预填失败"],
  ["AWAITING_HUMAN_PUBLISH", "等待人工发布"],
  ["PUBLISHED", "已发布"],
  ["MEASURING", "测量中"],
  ["RETROSPECTED", "已复盘"],
] as const;

function statusTone(status: string): "attention" | "healthy" | "danger" | "quiet" {
  if (status === "PUBLISHED" || status === "RETROSPECTED") return "healthy";
  if (status === "PREFILL_FAILED") return "danger";
  if (status === "AWAITING_HUMAN_PUBLISH" || status === "NEEDS_LOGIN") return "attention";
  return "quiet";
}

export default async function PublicationsPage() {
  const context = await requireServerInternalWorkspace();
  const supabase = createSupabaseServiceRoleClient();
  const [publicationsResult, productsResult, campaignsResult] = await Promise.all([
    supabase.from("publications").select("id,product_id,campaign_id,status,public_url,published_at,failure_reason,created_at").eq("workspace_id", context.workspaceId).order("created_at", { ascending: false }),
    supabase.from("products").select("id,name").eq("workspace_id", context.workspaceId).is("deleted_at", null),
    supabase.from("campaigns").select("id,name").eq("workspace_id", context.workspaceId),
  ]);
  const products = new Map((productsResult.data ?? []).map((product) => [product.id, product.name]));
  const campaigns = new Map((campaignsResult.data ?? []).map((campaign) => [campaign.id, campaign.name]));
  const publications = publicationsResult.error ? [] : publicationsResult.data ?? [];
  const hasError = Boolean(publicationsResult.error || productsResult.error || campaignsResult.error);

  return (
    <main>
      <div className="page-heading page-heading--compact">
        <div>
          <p className="eyebrow">Publication operations</p>
          <h1>发布队列</h1>
          <p>预填和状态记录可以由系统处理；最终发布始终由人工在小红书完成。</p>
        </div>
        <Link className="button button-secondary" href="/app"><IconMark name="arrow" size={16} />返回工作台</Link>
      </div>

      {hasError ? <div className="alert alert-danger" role="alert"><strong>部分发布数据暂时无法加载，请稍后重试。</strong></div> : null}
      <section aria-label="发布状态" className="surface-list">
        {statusGroups.map(([status, label]) => {
          const rows = publications.filter((publication) => publication.status === status);
          return (
            <article className="surface-card" key={status}>
              <div className="surface-card-header">
                <div>
                  <p className="eyebrow">{status}</p>
                  <h2>{label}</h2>
                </div>
                <StatusPill label={`${rows.length} 项`} tone={statusTone(status)} />
              </div>
              {rows.length === 0 ? <p className="card-copy card-copy--muted">暂无记录。</p> : (
                <div className="data-list">
                  {rows.map((publication) => (
                    <Link className="data-list-row" href={`/app/publications/${publication.id}`} key={publication.id}>
                      <span>
                        <strong>{campaigns.get(publication.campaign_id) ?? "Campaign"}</strong>
                        <br />{products.get(publication.product_id) ?? "Product"} · <span className="mono">{publication.id}</span>
                        {publication.failure_reason ? <><br /><span className="failure-copy">{publication.failure_reason}</span></> : null}
                        {publication.public_url ? <><br /><span>公开链接已记录；页面不会自动打开链接。</span></> : null}
                      </span>
                      <IconMark name="arrow" size={15} />
                    </Link>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </section>
    </main>
  );
}
