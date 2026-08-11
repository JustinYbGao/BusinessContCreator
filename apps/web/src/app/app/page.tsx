import { createSupabaseServiceRoleClient, requireServerInternalAdmin } from "../../lib/supabase/server";

type ConsoleSnapshot = {
  productName: string;
  campaignName: string;
  reviewCount: number;
  pendingPublicationCount: number;
  dueMetricWindows: number;
};

const emptySnapshot: ConsoleSnapshot = {
  productName: "暂无 Product",
  campaignName: "暂无 Campaign",
  reviewCount: 0,
  pendingPublicationCount: 0,
  dueMetricWindows: 0,
};

async function loadSnapshot(workspaceId: string): Promise<ConsoleSnapshot> {
  try {
    const supabase = createSupabaseServiceRoleClient();
    const [products, campaigns, review, pending, measurable] = await Promise.all([
      supabase.from("products").select("name").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at").limit(1),
      supabase.from("campaigns").select("name").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1),
      supabase.from("contents").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "review_required"),
      supabase.from("publications").select("id").eq("workspace_id", workspaceId).in("status", ["READY_TO_PREFILL", "PREFILLING", "NEEDS_LOGIN", "PREFILL_FAILED", "AWAITING_HUMAN_PUBLISH"]),
      supabase.from("publications").select("id").eq("workspace_id", workspaceId).in("status", ["PUBLISHED", "MEASURING"]),
    ]);

    const measurableIds = (measurable.data ?? []).map((publication) => publication.id);
    let snapshotCount = 0;
    if (measurableIds.length > 0) {
      const snapshots = await supabase.from("metric_snapshots").select("id").in("publication_id", measurableIds);
      snapshotCount = snapshots.data?.length ?? 0;
    }

    return {
      productName: products.data?.[0]?.name ?? emptySnapshot.productName,
      campaignName: campaigns.data?.[0]?.name ?? emptySnapshot.campaignName,
      reviewCount: review.count ?? 0,
      pendingPublicationCount: pending.data?.length ?? 0,
      dueMetricWindows: Math.max(measurableIds.length * 3 - snapshotCount, 0),
    };
  } catch {
    return emptySnapshot;
  }
}

const cards = [
  ["Product", "productName", "当前工作空间的产品"],
  ["Current Campaign", "campaignName", "当前运营周期"],
  ["待审核内容", "reviewCount", "需要人工确认"],
  ["待处理发布", "pendingPublicationCount", "停在人工发布之前"],
  ["待补指标窗口", "dueMetricWindows", "24h / 72h / 7d"],
] as const;

export default async function ConsolePage() {
  const identity = await requireServerInternalAdmin();
  const snapshot = await loadSnapshot(identity.workspaceId);

  return (
    <main>
      <p style={{ color: "#5b705d", fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>Internal console</p>
      <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 48, letterSpacing: "-0.05em", margin: "12px 0" }}>工作台</h1>
          <p style={{ color: "#536057", lineHeight: 1.6, margin: 0 }}>从真实产品事实开始，查看当前内容运营闭环。</p>
        </div>
        <span style={{ color: "#7b887d", fontSize: 13 }}>Workspace: {identity.workspaceId}</span>
      </div>

      <section aria-label="运营概览" style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", marginTop: 40 }}>
        {cards.map(([label, field, caption]) => (
          <article key={label} style={{ background: "#fff", border: "1px solid #dbe4d8", borderRadius: 18, minHeight: 150, padding: 22 }}>
            <p style={{ color: "#5b705d", fontSize: 13, fontWeight: 700, margin: 0 }}>{label}</p>
            <p style={{ fontSize: field === "productName" || field === "campaignName" ? 22 : 44, fontWeight: 800, letterSpacing: "-0.04em", margin: "28px 0 8px", overflowWrap: "anywhere" }}>{String(snapshot[field])}</p>
            <p style={{ color: "#7b887d", fontSize: 13, margin: 0 }}>{caption}</p>
          </article>
        ))}
      </section>

      <section style={{ background: "#e5ecdf", borderRadius: 22, marginTop: 32, padding: 28 }}>
        <p style={{ color: "#5b705d", fontSize: 13, fontWeight: 700, marginTop: 0 }}>发布安全边界</p>
        <h2 style={{ fontSize: 28, letterSpacing: "-0.04em", margin: "12px 0" }}>准备可以自动化，最终发布必须由人完成。</h2>
        <p style={{ color: "#536057", lineHeight: 1.65, marginBottom: 0, maxWidth: 720 }}>控制台只管理经过审核的内容版本和发布准备状态，不保存浏览器 Cookie，也不提供自动点击小红书最终发布按钮的路径。</p>
      </section>
    </main>
  );
}
