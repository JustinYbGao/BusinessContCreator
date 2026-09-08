import Link from "next/link";
import { notFound } from "next/navigation";
import { IconMark, StatusPill } from "../../../../../components/console-ui";
import { createSupabaseServiceRoleClient, requireServerInternalWorkspace } from "../../../../../lib/supabase/server";

type PageProps = { params: Promise<{ productId: string }> };

export default async function ProductAssetsPage({ params }: PageProps) {
  const context = await requireServerInternalWorkspace();
  const { productId } = await params;
  const supabase = createSupabaseServiceRoleClient();
  const [productResult, assetsResult] = await Promise.all([
    supabase.from("products").select("id,name").eq("workspace_id", context.workspaceId).eq("id", productId).is("deleted_at", null).maybeSingle(),
    supabase.from("assets").select("id,kind,source_locator,verification_status,public_use_allowed,mime_type,byte_size,width,height,sha256,created_at").eq("workspace_id", context.workspaceId).eq("product_id", productId).eq("provenance", "source").order("created_at"),
  ]);
  if (productResult.error || !productResult.data || assetsResult.error) notFound();
  const product = productResult.data;
  const assets = assetsResult.data ?? [];

  return (
    <main>
      <div className="page-heading page-heading--compact">
        <div>
          <p className="breadcrumb"><Link href={`/app/products/${productId}/facts`}>产品事实</Link> / {product.name}</p>
          <p className="eyebrow">Source assets</p>
          <h1>来源素材</h1>
          <p>素材必须经过解码、元数据清理和 QR 检查；只有 verified 且 public-use 的素材才能被后续视觉流程引用。</p>
        </div>
        <Link className="button button-secondary" href={`/app/products/${productId}/facts`}>查看产品事实 <IconMark name="arrow" size={16} /></Link>
      </div>

      <section className="surface-list">
        {assets.length === 0 ? <div className="empty-state surface-card"><p>还没有来源素材。</p></div> : assets.map((asset) => {
          const verified = asset.verification_status === "verified" && asset.public_use_allowed;
          return (
            <article className="surface-card" data-selected={verified} key={asset.id}>
              <div className="surface-card-header">
                <div>
                  <p className="eyebrow">{asset.kind}</p>
                  <h2>{asset.mime_type}</h2>
                </div>
                <StatusPill label={`${asset.verification_status}${asset.public_use_allowed ? " · 可公开使用" : " · 待核验"}`} tone={verified ? "healthy" : "attention"} />
              </div>
              <dl className="definition-list card-divider">
                <div><dt>相对来源</dt><dd>{asset.source_locator ?? "—"}</dd></div>
                <div><dt>图片元数据</dt><dd>{asset.mime_type} · {asset.width ?? "?"}×{asset.height ?? "?"} · {asset.byte_size} bytes</dd></div>
                <div><dt>SHA-256</dt><dd className="mono">{asset.sha256}</dd></div>
              </dl>
              <form action={`/api/products/${productId}/assets`} className="form-actions" method="post">
                <input name="assetId" type="hidden" value={asset.id} />
                <button className="button button-primary button-small" name="decision" type="submit" value="verify">核验素材</button>
                <button className="button button-quiet button-small" name="decision" type="submit" value="public-use">允许公开使用</button>
                <button className="button button-danger button-small" name="decision" type="submit" value="block">阻止使用</button>
              </form>
            </article>
          );
        })}
      </section>
    </main>
  );
}
