import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServiceRoleClient, requireServerInternalAdmin } from "../../../../../lib/supabase/server";

type PageProps = { params: Promise<{ productId: string }> };

const categories = ["positioning", "feature", "constraint", "data", "price", "status"] as const;

export default async function ProductFactsPage({ params }: PageProps) {
  const identity = await requireServerInternalAdmin();
  const { productId } = await params;
  const supabase = createSupabaseServiceRoleClient();
  const [productResult, factsResult] = await Promise.all([
    supabase.from("products").select("id,name").eq("workspace_id", identity.workspaceId).eq("id", productId).is("deleted_at", null).maybeSingle(),
    supabase.from("product_facts").select("id,statement,category,source_locator,evidence_excerpt,status,public_use_allowed,verified_at").eq("workspace_id", identity.workspaceId).eq("product_id", productId).order("created_at"),
  ]);
  if (productResult.error || !productResult.data || factsResult.error) notFound();
  const product = productResult.data;
  const facts = factsResult.data ?? [];

  return (
    <main>
      <p style={{ color: "#5b705d", fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>Product facts</p>
      <div style={{ alignItems: "end", display: "flex", flexWrap: "wrap", gap: 20, justifyContent: "space-between" }}>
        <div>
          <p style={{ margin: "12px 0 4px" }}><Link href="/app/products" style={{ color: "#5b705d" }}>Products</Link> / {product.name}</p>
          <h1 style={{ fontSize: 44, letterSpacing: "-0.05em", margin: "10px 0" }}>事实核验</h1>
          <p style={{ color: "#536057", lineHeight: 1.6, margin: 0 }}>只有经过人工核验并允许公开使用的事实，才能进入后续内容流程。</p>
        </div>
        <Link href={`/app/products/${productId}/assets`} style={{ color: "#365e3b", fontWeight: 700 }}>查看来源素材 →</Link>
      </div>

      <section style={{ display: "grid", gap: 16, marginTop: 32 }}>
        {facts.length === 0 ? <p style={{ background: "#fff", border: "1px solid #dbe4d8", borderRadius: 18, color: "#536057", padding: 24 }}>还没有候选事实。可以先添加一条手工来源。</p> : facts.map((fact) => (
          <article key={fact.id} style={{ background: "#fff", border: "1px solid #dbe4d8", borderRadius: 18, padding: 24 }}>
            <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "space-between" }}>
              <span style={{ background: fact.status === "verified" && fact.public_use_allowed ? "#dff0df" : "#f4ead4", borderRadius: 999, color: "#365e3b", fontSize: 12, fontWeight: 700, padding: "6px 10px" }}>{fact.status}{fact.public_use_allowed ? " · public" : " · candidate"}</span>
              <span style={{ color: "#7b887d", fontSize: 12 }}>{fact.category}</span>
            </div>
            <h2 style={{ fontSize: 22, lineHeight: 1.4, margin: "18px 0 10px" }}>{fact.statement}</h2>
            <dl style={{ color: "#536057", display: "grid", gap: 8, fontSize: 14, lineHeight: 1.55, margin: 0 }}>
              <div><dt style={{ display: "inline", fontWeight: 700 }}>来源定位：</dt><dd style={{ display: "inline", margin: 0, overflowWrap: "anywhere" }}>{fact.source_locator}</dd></div>
              <div><dt style={{ display: "inline", fontWeight: 700 }}>证据摘录：</dt><dd style={{ display: "inline", margin: 0 }}>{fact.evidence_excerpt}</dd></div>
            </dl>
            <form action={`/api/products/${productId}/facts`} method="post" style={{ display: "grid", gap: 10, marginTop: 20 }}>
              <input name="factId" type="hidden" value={fact.id} />
              <input aria-label="编辑后的事实" name="editedStatement" placeholder="可选：编辑后再核验" style={{ border: "1px solid #cdd8cc", borderRadius: 10, font: "inherit", padding: "10px 12px" }} value={fact.statement} readOnly={fact.status === "blocked"} />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button formAction={`/api/products/${productId}/facts`} name="decision" type="submit" value="verify" style={{ background: "#315d38", border: 0, borderRadius: 999, color: "#fff", cursor: "pointer", fontWeight: 700, padding: "10px 16px" }}>verify</button>
                <button formAction={`/api/products/${productId}/facts`} name="decision" type="submit" value="edit-and-verify" style={{ background: "#e5ecdf", border: 0, borderRadius: 999, color: "#315d38", cursor: "pointer", fontWeight: 700, padding: "10px 16px" }}>edit-and-verify</button>
                <button formAction={`/api/products/${productId}/facts`} name="decision" type="submit" value="block" style={{ background: "#fff", border: "1px solid #caa9a1", borderRadius: 999, color: "#8a3e35", cursor: "pointer", fontWeight: 700, padding: "10px 16px" }}>block</button>
              </div>
            </form>
          </article>
        ))}
      </section>

      <section style={{ background: "#e5ecdf", borderRadius: 22, marginTop: 32, padding: 24 }}>
        <h2 style={{ fontSize: 24, margin: "0 0 8px" }}>添加手工来源事实</h2>
        <p style={{ color: "#536057", fontSize: 14, lineHeight: 1.55, marginTop: 0 }}>手工录入只会创建 candidate Fact 和 manual Source，不能直接创建 verified Fact。</p>
        <form action={`/api/products/${productId}/facts`} method="post" style={{ display: "grid", gap: 12, maxWidth: 720 }}>
          <input name="statement" placeholder="事实陈述" required style={{ border: "1px solid #cdd8cc", borderRadius: 10, font: "inherit", padding: "11px 12px" }} />
          <select defaultValue="feature" name="category" style={{ border: "1px solid #cdd8cc", borderRadius: 10, font: "inherit", padding: "11px 12px" }}>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select>
          <textarea name="sourceNote" placeholder="来源备注或可复核的运营证据" required rows={4} style={{ border: "1px solid #cdd8cc", borderRadius: 10, font: "inherit", padding: "11px 12px" }} />
          <button type="submit" style={{ background: "#315d38", border: 0, borderRadius: 999, color: "#fff", cursor: "pointer", fontWeight: 700, justifySelf: "start", padding: "11px 18px" }}>创建候选事实</button>
        </form>
      </section>
    </main>
  );
}
