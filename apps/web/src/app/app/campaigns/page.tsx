import Link from "next/link";
import { IconMark } from "../../../components/console-ui";
import { createSupabaseServiceRoleClient, requireServerInternalWorkspace } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const context = await requireServerInternalWorkspace();
  const supabase = createSupabaseServiceRoleClient();
  const [productsResult, campaignsResult] = await Promise.all([
    supabase.from("products").select("id,name").eq("workspace_id", context.workspaceId).is("deleted_at", null).order("created_at"),
    supabase.from("campaigns").select("id,name,product_id,starts_on,ends_on").eq("workspace_id", context.workspaceId).order("created_at", { ascending: false }),
  ]);
  const products = new Map((productsResult.data ?? []).map((product) => [product.id, product.name]));
  const campaigns = campaignsResult.error ? [] : campaignsResult.data ?? [];
  const hasError = Boolean(productsResult.error || campaignsResult.error);

  return (
    <main>
      <div className="page-heading page-heading--compact">
        <div>
          <p className="eyebrow">Content planning</p>
          <h1>内容运营周期</h1>
          <p>每个 Campaign 都绑定一个 Product，选题、内容、审核和发布结果在同一条证据链里推进。</p>
        </div>
        <Link className="button button-secondary" href="/app">返回工作台 <IconMark name="arrow" size={16} /></Link>
      </div>

      {hasError ? <div className="alert alert-danger" role="alert"><strong>暂时无法加载内容运营周期，请稍后重试。</strong></div> : null}

      <section aria-label="Campaign 列表" className="surface-list">
        {campaigns.length === 0 ? (
          <div className="empty-state surface-card">
            <p>当前 Workspace 还没有 Campaign。</p>
            <Link className="text-link" href="/app">回到工作台 <IconMark name="arrow" size={15} /></Link>
          </div>
        ) : campaigns.map((campaign) => (
          <Link className="surface-card" href={`/app/campaigns/${campaign.id}`} key={campaign.id}>
            <div className="surface-card-header">
              <div>
                <p className="eyebrow">{products.get(campaign.product_id) ?? "Product"}</p>
                <h2>{campaign.name}</h2>
                <p className="card-copy">{campaign.starts_on} → {campaign.ends_on}</p>
              </div>
              <span className="text-link" aria-hidden="true">打开周期 <IconMark name="arrow" size={15} /></span>
            </div>
          </Link>
        ))}
      </section>
    </main>
  );
}
