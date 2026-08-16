import Link from "next/link";
import { createSupabaseServiceRoleClient, requireServerInternalAdmin } from "../../../lib/supabase/server";

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

export default async function PublicationsPage() {
  const identity = await requireServerInternalAdmin();
  const supabase = createSupabaseServiceRoleClient();
  const [publicationsResult, productsResult, campaignsResult] = await Promise.all([
    supabase.from("publications").select("id,product_id,campaign_id,status,public_url,published_at,failure_reason,created_at").eq("workspace_id", identity.workspaceId).order("created_at", { ascending: false }),
    supabase.from("products").select("id,name").eq("workspace_id", identity.workspaceId).is("deleted_at", null),
    supabase.from("campaigns").select("id,name").eq("workspace_id", identity.workspaceId),
  ]);
  const products = new Map((productsResult.data ?? []).map((product) => [product.id, product.name]));
  const campaigns = new Map((campaignsResult.data ?? []).map((campaign) => [campaign.id, campaign.name]));
  const publications = publicationsResult.error ? [] : publicationsResult.data ?? [];

  return (
    <main>
      <p style={{ color: "#5b705d", fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>Publication operations</p>
      <h1 style={{ fontSize: 48, letterSpacing: "-0.05em", margin: "12px 0" }}>发布队列</h1>
      <p style={{ color: "#536057", lineHeight: 1.6, margin: 0 }}>预填和状态记录可以由系统处理；最终发布始终由人工在小红书完成。</p>

      <section aria-label="发布状态" style={{ display: "grid", gap: 18, marginTop: 32 }}>
        {statusGroups.map(([status, label]) => {
          const rows = publications.filter((publication) => publication.status === status);
          return <article key={status} style={{ background: "#fff", border: "1px solid #dbe4d8", borderRadius: 18, padding: 22 }}>
            <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}><h2 style={{ fontSize: 22, margin: 0 }}>{label}</h2><span style={{ color: "#5b705d", fontWeight: 800 }}>{rows.length}</span></div>
            {rows.length === 0 ? <p style={{ color: "#7b887d", marginBottom: 0 }}>暂无记录。</p> : <div style={{ display: "grid", gap: 10, marginTop: 16 }}>{rows.map((publication) => <Link href={`/app/publications/${publication.id}`} key={publication.id} style={{ borderTop: "1px solid #e6ece3", color: "#315d38", display: "block", paddingTop: 12, textDecoration: "none" }}><strong>{campaigns.get(publication.campaign_id) ?? "Campaign"}</strong><span style={{ color: "#536057", display: "block", fontSize: 13, marginTop: 4 }}>{products.get(publication.product_id) ?? "Product"} · {publication.id}</span>{publication.failure_reason ? <span style={{ color: "#7c2d22", display: "block", fontSize: 13, marginTop: 4 }}>{publication.failure_reason}</span> : null}{publication.public_url ? <span style={{ color: "#7b887d", display: "block", fontSize: 12, marginTop: 4 }}>Public URL 已记录；页面不会自动打开链接。</span> : null}</Link>)}</div>}
          </article>;
        })}
      </section>
    </main>
  );
}
