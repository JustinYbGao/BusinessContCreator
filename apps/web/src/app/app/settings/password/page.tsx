import Link from "next/link";
import PasswordForm from "./password-form";

export const dynamic = "force-dynamic";

export default function PasswordSettingsPage() {
  return (
    <main>
      <div className="page-heading page-heading--compact">
        <div>
          <p className="eyebrow">账户安全</p>
          <h1>更新登录密码</h1>
          <p>这是首次登录后的强制步骤。新密码只会留在输入框和请求体里，提交完成后会回到工作台。</p>
        </div>
        <div className="page-heading-action">
          <Link className="text-link" href="/app">返回工作台</Link>
        </div>
      </div>

      <section className="surface surface-padded">
        <PasswordForm />
      </section>
    </main>
  );
}
