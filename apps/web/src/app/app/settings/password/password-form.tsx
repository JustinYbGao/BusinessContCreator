"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export default function PasswordForm() {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    if (newPassword !== confirmPassword) {
      setMessage("密码更新失败，请稍后重试。");
      setIsSubmitting(false);
      return;
    }

    try {
      const response = await fetch("/api/account/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          newPassword,
          confirmPassword,
        }),
      });

      if (!response.ok) {
        setMessage("密码更新失败，请稍后重试。");
        return;
      }

      setNewPassword("");
      setConfirmPassword("");
      router.replace("/app");
    } catch {
      setMessage("密码更新失败，请稍后重试。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label htmlFor="password-new">新密码</label>
      <input autoComplete="new-password" id="password-new" minLength={12} onChange={(event) => setNewPassword(event.target.value)} required type="password" value={newPassword} />

      <label htmlFor="password-confirm">确认新密码</label>
      <input autoComplete="new-password" id="password-confirm" minLength={12} onChange={(event) => setConfirmPassword(event.target.value)} required type="password" value={confirmPassword} />

      <button className="button button-primary" disabled={isSubmitting} type="submit">{isSubmitting ? "保存中…" : "保存新密码"}</button>
      {message ? <p className="form-message" role="status">{message}</p> : <p className="form-message">密码不会出现在 URL、日志或响应中。</p>}
    </form>
  );
}
