import { describe, expect, it, vi } from "vitest";
import { requestMagicLink, submitPasswordLogin } from "./login-model.js";

describe("login model", () => {
  it("routes first-time members to the password settings page after password sign-in", async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({ error: null });
    const fetchAccount = vi.fn().mockResolvedValue({ mustChangePassword: true });

    await expect(submitPasswordLogin({
      email: "member@example.com",
      password: "temporary-password",
      signInWithPassword,
      fetchAccount,
    })).resolves.toEqual({
      kind: "success",
      redirectTo: "/app/settings/password",
    });

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "member@example.com",
      password: "temporary-password",
    });
    expect(fetchAccount).toHaveBeenCalledTimes(1);
  });

  it("maps invalid credentials to a generic inline error", async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({
      error: { message: "Invalid login credentials" },
    });

    await expect(submitPasswordLogin({
      email: "member@example.com",
      password: "wrong-password",
      signInWithPassword,
      fetchAccount: vi.fn(),
    })).resolves.toEqual({
      kind: "error",
      message: "邮箱或密码错误，请重试。",
    });
  });

  it("maps rate limit auth errors to the service unavailable message", async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({
      error: { message: "Rate limit exceeded" },
    });

    await expect(submitPasswordLogin({
      email: "member@example.com",
      password: "wrong-password",
      signInWithPassword,
      fetchAccount: vi.fn(),
    })).resolves.toEqual({
      kind: "error",
      message: "登录服务暂不可用，请稍后重试。",
    });
  });

  it("maps unknown password sign-in auth errors to the service unavailable message", async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({
      error: { message: "Something unexpected happened" },
    });

    await expect(submitPasswordLogin({
      email: "member@example.com",
      password: "wrong-password",
      signInWithPassword,
      fetchAccount: vi.fn(),
    })).resolves.toEqual({
      kind: "error",
      message: "登录服务暂不可用，请稍后重试。",
    });
  });

  it("keeps Magic Link as a secondary fallback without enabling self-signup", async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });

    await expect(requestMagicLink({
      email: "member@example.com",
      emailRedirectTo: "https://example.com/auth/callback",
      signInWithOtp,
    })).resolves.toEqual({
      kind: "success",
      message: "登录链接已发送，请检查邮箱。",
    });

    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "member@example.com",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "https://example.com/auth/callback",
      },
    });
  });

  it("falls back to the app shell when account status lookup is unavailable", async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({ error: null });
    const fetchAccount = vi.fn().mockRejectedValue(new Error("ACCOUNT_LOOKUP_FAILED"));

    await expect(submitPasswordLogin({
      email: "member@example.com",
      password: "temporary-password",
      signInWithPassword,
      fetchAccount,
    })).resolves.toEqual({
      kind: "success",
      redirectTo: "/app",
    });
  });
});
