import Link from "next/link";
import { IconMark } from "../../../components/console-ui";
import { createSupabaseServiceRoleClient, requireServerInternalWorkspace } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const context = await requireServerInternalWorkspace();
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("products")
    .select("id,name,slug,positioning,created_at")
    .eq("workspace_id", context.workspaceId)
    .is("deleted_at", null)
    .order("created_at");
  const products = error ? [] : data ?? [];

  return (
    <main>
      <div className="page-heading page-heading--compact">
        <div>
          <p className="eyebrow">Product grounding</p>
          <h1>产品事实库</h1>
          <p>先确认产品资料、来源素材和可公开使用范围，再让选题与内容进入下一步。</p>
        </div>
        <Link className="button button-secondary" href="/app"><IconMark name="arrow" size={16} />返回工作台</Link>
      </div>

      {error ? <div className="alert alert-danger" role="alert"><strong>暂时无法加载产品资料。</strong></div> : null}
      <section aria-label="产品列表" className="surface-list">
        {products.length === 0 ? <div className="empty-state surface-card"><p>当前 Workspace 还没有可用产品。</p></div> : products.map((product) => (
          <article className="surface-card" key={product.id}>
            <div className="surface-card-header">
              <div>
                <p className="eyebrow">{product.slug}</p>
                <h2>{product.name}</h2>
                <p>{product.positioning ?? "尚未填写产品定位。"}</p>
              </div>
              <div className="page-actions">
                <Link className="button button-secondary button-small" href={`/app/products/${product.id}/facts`}>事实核验 <IconMark name="arrow" size={14} /></Link>
                <Link className="button button-quiet button-small" href={`/app/products/${product.id}/assets`}>来源素材 <IconMark name="arrow" size={14} /></Link>
              </div>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
