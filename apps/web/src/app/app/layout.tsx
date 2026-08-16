import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { HttpError } from "../../lib/auth";
import { requireServerInternalAdmin } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

const navigation = [
  ["工作台", "/app"],
  ["产品", "/app/products"],
  ["选题", "/app/campaigns"],
  ["审核", "/app/review"],
  ["发布", "/app/publications"],
  ["复盘", "/app/analytics"],
  ["设置", "/app/settings/publisher-devices"],
] as const;

async function loadIdentity() {
  try {
    return await requireServerInternalAdmin();
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) redirect("/login");
    if (error instanceof HttpError && error.status === 403) redirect("/login?error=not_allowed");
    throw error;
  }
}

export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  const identity = await loadIdentity();

  return (
    <div style={{ minHeight: "100vh", background: "#f6f7f2" }}>
      <header style={{ borderBottom: "1px solid #dbe4d8", background: "#fff" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 28px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
            <Link href="/app" style={{ color: "#17211b", fontSize: 20, fontWeight: 800, textDecoration: "none" }}>SocialMediaAgent</Link>
            <span style={{ color: "#536057", fontSize: 13 }}>{identity.email}</span>
          </div>
          <nav aria-label="控制台导航" style={{ display: "flex", flexWrap: "wrap", gap: 18, marginTop: 24 }}>
            {navigation.map(([label, href]) => <Link key={href} href={href} style={{ color: "#536057", fontSize: 14, fontWeight: 700, textDecoration: "none" }}>{label}</Link>)}
          </nav>
        </div>
      </header>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 28px 72px" }}>
        {children}
      </div>
    </div>
  );
}
