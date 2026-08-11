"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "../../lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      setMessage(error ? "登录链接发送失败，请稍后重试。" : "登录链接已发送，请检查邮箱。 ");
    } catch {
      setMessage("登录服务暂不可用，请稍后重试。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <section style={{ width: "min(100%, 460px)", background: "#fff", border: "1px solid #dbe4d8", borderRadius: 24, padding: 32, boxShadow: "0 16px 60px rgba(23, 33, 27, 0.08)" }}>
        <Link href="/" style={{ color: "#5b705d", fontSize: 13, fontWeight: 700, textDecoration: "none" }}>← 返回官网</Link>
        <p style={{ color: "#5b705d", fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", marginTop: 48, textTransform: "uppercase" }}>Internal access</p>
        <h1 style={{ fontSize: 42, letterSpacing: "-0.05em", margin: "14px 0" }}>登录控制台</h1>
        <p style={{ color: "#536057", lineHeight: 1.6 }}>使用已获授权的邮箱接收 Supabase Magic Link。</p>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 28 }}>
          <label htmlFor="login-email" style={{ fontWeight: 700 }}>邮箱</label>
          <input id="login-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" placeholder="owner@example.com" style={{ border: "1px solid #b5c4b7", borderRadius: 12, fontSize: 16, padding: "14px 16px" }} />
          <button type="submit" disabled={isSubmitting} style={{ background: isSubmitting ? "#829285" : "#1e4d37", border: 0, borderRadius: 999, color: "#fff", cursor: isSubmitting ? "wait" : "pointer", fontSize: 16, fontWeight: 700, marginTop: 8, padding: "14px 22px" }}>
            {isSubmitting ? "发送中…" : "发送登录链接"}
          </button>
        </form>
        {message ? <p role="status" style={{ color: "#536057", lineHeight: 1.5, marginBottom: 0, marginTop: 20 }}>{message}</p> : null}
      </section>
    </main>
  );
}
