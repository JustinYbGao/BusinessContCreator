import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServiceRoleClient, requireServerInternalAdmin } from "../../../../../lib/supabase/server";

type PageProps = { params: Promise<{ productId: string }> };

export default async function ProductAssetsPage({ params }: PageProps) {
  const identity = await requireServerInternalAdmin();
  const { productId } = await params;
  const supabase = createSupabaseServiceRoleClient();
  const [productResult, assetsResult] = await Promise.all([
    supabase.from("products").select("id,name").eq("workspace_id", identity.workspaceId).eq("id", productId).is("deleted_at", null).maybeSingle(),
    supabase.from("assets").select("id,kind,source_locator,verification_status,public_use_allowed,mime_type,byte_size,width,height,sha256,created_at").eq("workspace_id", identity.workspaceId).eq("product_id", productId).eq("provenance", "source").order("created_at"),
  ]);
  if (productResult.error || !productResult.data || assetsResult.error) notFound();
  const product = productResult.data;
  const assets = assetsResult.data ?? [];

  return (
    <main>
      <p style={{ color: "#5b705d", fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>Source assets</p>
      <p style={{ margin: "12px 0 4px" }}><Link href={`/app/products/${productId}/facts`} style={{ color: "#5b705d" }}>Product facts</Link> / {product.name}</p>
      <h1 style={{ fontSize: 44, letterSpacing: "-0.05em", margin: "10px 0" }}>来源素材</h1>
      <p style={{ color: "#536057", lineHeight: 1.6, margin: 0 }}>素材必须经过解码、元数据清理和 QR 检查；只有 verified 且 public-use 的素材才能被后续视觉流程引用。</p>

      <section style={{ display: "grid", gap: 16, marginTop: 32 }}>
        {assets.length === 0 ? <p style={{ background: "#fff", border: "1px solid #dbe4d8", borderRadius: 18, color: "#536057", padding: 24 }}>还没有来源素材。</p> : assets.map((asset) => (
          <article key={asset.id} style={{ background: "#fff", border: "1px solid #dbe4d8", borderRadius: 18, padding: 24 }}>
            <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "space-between" }}>
              <h2 style={{ fontSize: 20, margin: 0 }}>{asset.kind}</h2>
              <span style={{ background: asset.verification_status === "verified" && asset.public_use_allowed ? "#dff0df" : "#f4ead4", borderRadius: 999, color: "#365e3b", fontSize: 12, fontWeight: 700, padding: "6px 10px" }}>{asset.verification_status}{asset.public_use_allowed ? " · public" : " · candidate"}</span>
            </div>
            <dl style={{ color: "#536057", display: "grid", gap: 8, fontSize: 14, lineHeight: 1.55, margin: "18px 0 0" }}>
              <div><dt style={{ display: "inline", fontWeight: 700 }}>相对来源：</dt><dd style={{ display: "inline", margin: 0, overflowWrap: "anywhere" }}>{asset.source_locator ?? "—"}</dd></div>
              <div><dt style={{ display: "inline", fontWeight: 700 }}>图片：</dt><dd style={{ display: "inline", margin: 0 }}>{asset.mime_type} · {asset.width ?? "?"}×{asset.height ?? "?"} · {asset.byte_size} bytes</dd></div>
              <div><dt style={{ display: "inline", fontWeight: 700 }}>SHA-256：</dt><dd style={{ display: "inline", fontFamily: "monospace", margin: 0, overflowWrap: "anywhere" }}>{asset.sha256}</dd></div>
            </dl>
            <form action={`/api/products/${productId}/assets`} method="post" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 20 }}>
              <input name="assetId" type="hidden" value={asset.id} />
              <button name="decision" type="submit" value="verify" style={{ background: "#315d38", border: 0, borderRadius: 999, color: "#fff", cursor: "pointer", fontWeight: 700, padding: "10px 16px" }}>verify</button>
              <button name="decision" type="submit" value="public-use" style={{ background: "#e5ecdf", border: 0, borderRadius: 999, color: "#315d38", cursor: "pointer", fontWeight: 700, padding: "10px 16px" }}>public-use</button>
              <button name="decision" type="submit" value="block" style={{ background: "#fff", border: "1px solid #caa9a1", borderRadius: 999, color: "#8a3e35", cursor: "pointer", fontWeight: 700, padding: "10px 16px" }}>block</button>
            </form>
          </article>
        ))}
      </section>
    </main>
  );
}
