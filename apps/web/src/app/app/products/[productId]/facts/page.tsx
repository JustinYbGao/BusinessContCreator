import Link from "next/link";
import { notFound } from "next/navigation";
import { IconMark, StatusPill } from "../../../../../components/console-ui";
import { createSupabaseServiceRoleClient, requireServerInternalWorkspace } from "../../../../../lib/supabase/server";

type PageProps = { params: Promise<{ productId: string }> };

const categories = ["positioning", "feature", "constraint", "data", "price", "status"] as const;

export default async function ProductFactsPage({ params }: PageProps) {
  const context = await requireServerInternalWorkspace();
  const { productId } = await params;
  const supabase = createSupabaseServiceRoleClient();
  const [productResult, factsResult] = await Promise.all([
    supabase.from("products").select("id,name").eq("workspace_id", context.workspaceId).eq("id", productId).is("deleted_at", null).maybeSingle(),
    supabase.from("product_facts").select("id,statement,category,source_locator,evidence_excerpt,status,public_use_allowed,verified_at").eq("workspace_id", context.workspaceId).eq("product_id", productId).order("created_at"),
  ]);
  if (productResult.error || !productResult.data || factsResult.error) notFound();
  const product = productResult.data;
  const facts = factsResult.data ?? [];

  return (
    <main>
      <div className="page-heading page-heading--compact">
        <div>
          <p className="breadcrumb"><Link href="/app/products">产品库</Link> / {product.name}</p>
          <p className="eyebrow">Product facts</p>
          <h1>事实核验</h1>
          <p>只有经过人工核验并允许公开使用的事实，才能进入后续内容流程。</p>
        </div>
        <Link className="button button-secondary" href={`/app/products/${productId}/assets`}>查看来源素材 <IconMark name="arrow" size={16} /></Link>
      </div>

      <section className="surface-list">
        {facts.length === 0 ? <div className="empty-state surface-card"><p>还没有候选事实。可以先添加一条手工来源。</p></div> : facts.map((fact) => {
          const verified = fact.status === "verified" && fact.public_use_allowed;
          return (
            <article className="surface-card" data-selected={verified} key={fact.id}>
              <div className="surface-card-header">
                <div>
                  <p className="eyebrow">{fact.category}</p>
                  <h2>{fact.statement}</h2>
                </div>
                <StatusPill label={`${fact.status}${fact.public_use_allowed ? " · 可公开使用" : " · 候选"}`} tone={verified ? "healthy" : fact.status === "blocked" ? "danger" : "attention"} />
              </div>
              <dl className="definition-list card-divider">
                <div><dt>来源定位</dt><dd>{fact.source_locator}</dd></div>
                <div><dt>证据摘录</dt><dd>{fact.evidence_excerpt}</dd></div>
              </dl>
              <form action={`/api/products/${productId}/facts`} className="editor-form" method="post">
                <input name="factId" type="hidden" value={fact.id} />
                <label className="editor-field">
                  <span>编辑后的事实</span>
                  <input className="editor-input" name="editedStatement" placeholder="可选：编辑后再核验" value={fact.statement} readOnly={fact.status === "blocked"} />
                </label>
                <div className="form-actions">
                  <button className="button button-primary button-small" formAction={`/api/products/${productId}/facts`} name="decision" type="submit" value="verify">核验</button>
                  <button className="button button-quiet button-small" formAction={`/api/products/${productId}/facts`} name="decision" type="submit" value="edit-and-verify">编辑并核验</button>
                  <button className="button button-danger button-small" formAction={`/api/products/${productId}/facts`} name="decision" type="submit" value="block">阻止使用</button>
                </div>
              </form>
            </article>
          );
        })}
      </section>

      <section className="policy-panel surface-card--spaced">
        <p className="eyebrow">Manual source</p>
        <h2>添加手工来源事实</h2>
        <p>手工录入只会创建 candidate Fact 和 manual Source，不能直接创建 verified Fact。</p>
        <form action={`/api/products/${productId}/facts`} className="editor-form" method="post">
          <label className="editor-field"><span>事实陈述</span><input className="editor-input" name="statement" placeholder="事实陈述" required /></label>
          <label className="editor-field"><span>事实类别</span><select className="editor-input" defaultValue="feature" name="category">{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
          <label className="editor-field"><span>来源备注或可复核的运营证据</span><textarea className="editor-textarea" name="sourceNote" placeholder="来源备注或可复核的运营证据" required rows={4} /></label>
          <button className="button button-primary" type="submit">创建候选事实 <IconMark name="arrow" size={16} /></button>
        </form>
      </section>
    </main>
  );
}
