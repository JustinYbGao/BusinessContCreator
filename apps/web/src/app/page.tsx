import Link from "next/link";

const steps = [
  ["01", "理解产品", "只从已确认的产品事实出发，减少脱离真实能力的表达。"],
  ["02", "发现选题", "围绕真实用户问题和内容支柱安排下一周的内容。"],
  ["03", "生成内容", "生成标题、正文、话题、互动问题和视觉脚本。"],
  ["04", "发布准备", "通过事实与合规审核后，准备好可供人工复核的发布包。"],
  ["05", "复盘迭代", "记录指标与证据，把下一轮动作建立在可追溯的结果上。"],
] as const;

const pageStyle = { maxWidth: 1120, margin: "0 auto", padding: "0 28px" };
const eyebrowStyle = { color: "#5b705d", fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" as const };

export default function HomePage() {
  return (
    <main>
      <nav style={{ ...pageStyle, display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 24, paddingBottom: 24 }}>
        <Link href="/" style={{ color: "#17211b", fontSize: 20, fontWeight: 800, textDecoration: "none" }}>
          SocialMediaAgent
        </Link>
        <Link href="/login" style={{ color: "#17211b", fontSize: 14, fontWeight: 700, textDecoration: "none" }}>
          内部登录 →
        </Link>
      </nav>

      <section style={{ ...pageStyle, paddingTop: 96, paddingBottom: 112 }}>
        <p style={eyebrowStyle}>Product-grounded content operations</p>
        <h1 style={{ maxWidth: 760, margin: "18px 0 24px", fontSize: "clamp(48px, 8vw, 92px)", lineHeight: 0.98, letterSpacing: "-0.06em" }}>
          把产品资料，<br />变成持续增长的内容系统。
        </h1>
        <p style={{ maxWidth: 620, color: "#536057", fontSize: 20, lineHeight: 1.65 }}>
          SocialMediaAgent 帮助独立开发者和小团队持续完成选题、内容、审核、发布准备与复盘，让每一篇内容都回到真实产品和下一步行动。
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 32 }}>
          <a href="#waitlist" style={{ background: "#1e4d37", borderRadius: 999, color: "#fff", padding: "14px 22px", textDecoration: "none", fontWeight: 700 }}>
            申请内测
          </a>
          <Link href="/login" style={{ border: "1px solid #b5c4b7", borderRadius: 999, color: "#1e4d37", padding: "14px 22px", textDecoration: "none", fontWeight: 700 }}>
            内部登录
          </Link>
        </div>
      </section>

      <section style={{ background: "#e5ecdf", padding: "76px 0" }}>
        <div style={pageStyle}>
          <p style={eyebrowStyle}>One continuous loop</p>
          <h2 style={{ maxWidth: 640, margin: "16px 0 44px", fontSize: 42, letterSpacing: "-0.04em" }}>从事实出发，回到下一轮行动。</h2>
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
            {steps.map(([number, title, description]) => (
              <article key={number} style={{ minHeight: 190, background: "#f6f7f2", borderRadius: 18, padding: 22 }}>
                <span style={{ color: "#9aa997", fontSize: 13, fontWeight: 800 }}>{number}</span>
                <h3 style={{ margin: "36px 0 10px", fontSize: 22 }}>{title}</h3>
                <p style={{ color: "#536057", lineHeight: 1.55, margin: 0 }}>{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section style={{ ...pageStyle, display: "grid", gap: 56, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", paddingTop: 92, paddingBottom: 92 }}>
        <div>
          <p style={eyebrowStyle}>Internal practice</p>
          <h2 style={{ margin: "16px 0 20px", fontSize: 42, letterSpacing: "-0.04em" }}>DormChef 是第一个真实产品。</h2>
          <p style={{ color: "#536057", lineHeight: 1.7, maxWidth: 520 }}>
            阶段 1 用 DormChef 验证从产品事实到小红书图文发布准备的完整闭环。当前页面只说明实践范围，不展示尚未完成验证的客户数据、证言或增长结果。
          </p>
        </div>
        <div style={{ alignSelf: "end", background: "#17211b", borderRadius: 24, color: "#eef4e9", padding: 28 }}>
          <p style={{ color: "#b8d3b8", fontWeight: 700, marginTop: 0 }}>安全边界</p>
          <p style={{ fontSize: 24, lineHeight: 1.35, marginBottom: 0 }}>系统可以准备和填充，但最终发布由人完成。</p>
        </div>
      </section>

      <section id="waitlist" style={{ background: "#d2e0d0", padding: "76px 0" }}>
        <div style={{ ...pageStyle, display: "grid", gap: 32, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", alignItems: "end" }}>
          <div>
            <p style={eyebrowStyle}>Early access</p>
            <h2 style={{ margin: "16px 0 12px", fontSize: 42, letterSpacing: "-0.04em" }}>想一起验证内容闭环？</h2>
            <p style={{ color: "#536057", lineHeight: 1.6, margin: 0 }}>留下邮箱，内测开放时我们会联系你。</p>
          </div>
          <form action="/api/waitlist" method="post" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label htmlFor="waitlist-email" style={{ fontWeight: 700 }}>工作邮箱</label>
            <input id="waitlist-email" name="email" type="email" required placeholder="you@example.com" style={{ border: "1px solid #9caf9a", borderRadius: 12, fontSize: 16, padding: "14px 16px" }} />
            <label style={{ position: "absolute", left: "-10000px" }} aria-hidden="true">
              Website
              <input name="website" tabIndex={-1} autoComplete="off" />
            </label>
            <button type="submit" style={{ alignSelf: "flex-start", background: "#1e4d37", border: 0, borderRadius: 999, color: "#fff", cursor: "pointer", fontSize: 16, fontWeight: 700, padding: "14px 22px" }}>
              提交申请
            </button>
          </form>
        </div>
      </section>

      <footer style={{ ...pageStyle, color: "#6b796d", fontSize: 13, paddingTop: 28, paddingBottom: 28 }}>
        SocialMediaAgent · 真实产品事实优先 · 人工拥有最终发布权
      </footer>
    </main>
  );
}
