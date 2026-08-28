export interface PasswordSignInResponse {
  error?: { message?: string | null } | null;
}

export interface MagicLinkResponse {
  error?: { message?: string | null } | null;
}

export interface PasswordLoginSuccess {
  kind: "success";
  redirectTo: "/app" | "/app/settings/password";
}

export interface LoginErrorResult {
  kind: "error";
  message: string;
}

export interface PasswordLoginDependencies {
  email: string;
  password: string;
  signInWithPassword(input: { email: string; password: string }): Promise<PasswordSignInResponse>;
  fetchAccount(): Promise<{ mustChangePassword: boolean }>;
}

export interface MagicLinkDependencies {
  email: string;
  emailRedirectTo: string;
  signInWithOtp(input: {
    email: string;
    options: {
      shouldCreateUser: false;
      emailRedirectTo: string;
    };
  }): Promise<MagicLinkResponse>;
}

function isInvalidCredentialsMessage(message: string | null | undefined): boolean {
  if (!message) {
    return false;
  }

  const normalizedMessage = message.trim().toLowerCase();
  return normalizedMessage === "invalid login credentials" || normalizedMessage === "invalid credentials";
}

export async function submitPasswordLogin({
  email,
  password,
  signInWithPassword,
  fetchAccount,
}: PasswordLoginDependencies): Promise<PasswordLoginSuccess | LoginErrorResult> {
  try {
    const { error } = await signInWithPassword({ email, password });
    if (error) {
      return {
        kind: "error",
        message: isInvalidCredentialsMessage(error.message)
          ? "邮箱或密码错误，请重试。"
          : "登录服务暂不可用，请稍后重试。",
      };
    }

    try {
      const account = await fetchAccount();
      return {
        kind: "success",
        redirectTo: account.mustChangePassword ? "/app/settings/password" : "/app",
      };
    } catch {
      return {
        kind: "success",
        redirectTo: "/app",
      };
    }
  } catch {
    return {
      kind: "error",
      message: "登录服务暂不可用，请稍后重试。",
    };
  }
}

export async function requestMagicLink({
  email,
  emailRedirectTo,
  signInWithOtp,
}: MagicLinkDependencies): Promise<{ kind: "success"; message: string } | LoginErrorResult> {
  try {
    const { error } = await signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo,
      },
    });

    if (error) {
      return {
        kind: "error",
        message: "登录链接发送失败，请稍后重试。",
      };
    }

    return {
      kind: "success",
      message: "登录链接已发送，请检查邮箱。",
    };
  } catch {
    return {
      kind: "error",
      message: "登录服务暂不可用，请稍后重试。",
    };
  }
}
