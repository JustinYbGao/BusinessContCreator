import Link from "next/link";
import { createSupabaseServiceRoleClient, requireServerInternalAdmin } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const identity = await requireServerInternalAdmin();
  const supabase = createSupabaseServiceRoleClient();
  const [productsResult, campaignsResult] = await Promise.all([
    supabase.from("products").select("id,name").eq("workspace_id", identity.workspaceId).is("deleted_at", null).order("created_at"),
    supabase.from("campaigns").select("id,name,product_id,starts_on,ends_on").eq("workspace_id", identity.workspaceId).order("created_at", { ascending: false }),
  ]);
  const products = new Map((productsResult.data ?? []).map((product) => [product.id, product.name]));
  const campaigns = campaignsResult.error ? [] : campaignsResult.data ?? [];

  return (
    <main>
      <p style={{ color: "#5b705d", fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>Campaigns</p>
      <h1 style={{ fontSize: 48, letterSpacing: "-0.05em", margin: "12px 0" }}>内容运营周期</h1>
      <p style={{ color: "#536057", lineHeight: 1.6, margin: 0 }}>每个 Campaign 都绑定一个 Product，选题、内容、审核和发布结果在同一条证据链里推进。</p>

      <section aria-label="Campaign 列表" style={{ display: "grid", gap: 16, marginTop: 32 }}>
        {campaigns.length === 0 ? <p style={{ background: "#fff", border: "1px solid #dbe4d8", borderRadius: 18, color: "#536057", padding: 24 }}>当前 Workspace 还没有 Campaign。</p> : campaigns.map((campaign) => (
          <Link href={`/app/campaigns/${campaign.id}`} key={campaign.id} style={{ background: "#fff", border: "1px solid #dbe4d8", borderRadius: 18, color: "inherit", padding: 24, textDecoration: "none" }}>
            <p style={{ color: "#5b705d", fontSize: 13, fontWeight: 700, margin: 0 }}>{products.get(campaign.product_id) ?? "Product"}</p>
            <h2 style={{ fontSize: 26, letterSpacing: "-0.04em", margin: "8px 0" }}>{campaign.name}</h2>
            <p style={{ color: "#536057", margin: 0 }}>{campaign.starts_on} → {campaign.ends_on}</p>
          </Link>
        ))}
      </section>
    </main>
  );
}
