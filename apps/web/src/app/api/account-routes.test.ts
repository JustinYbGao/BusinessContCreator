import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError, type InternalMemberIdentity } from "../../lib/auth";

const identity: InternalMemberIdentity = {
  userId: "00000000-0000-4000-8000-000000000099",
  email: "member@example.com",
  workspaceId: "00000000-0000-4000-8000-000000000001",
  role: "member",
  status: "active",
  mustChangePassword: true,
};

async function loadRoutes() {
  return {
    me: await import("./account/me/route"),
    password: await import("./account/password/route"),
  };
}

describe("Task 4 account route boundaries", () => {
  const requireIdentity = vi.fn();
  const updateAuthenticatedPassword = vi.fn();
  const clearMustChangePassword = vi.fn();
  const markPasswordChanged = vi.fn();
  const createMemberStore = vi.fn();

  beforeEach(() => {
    requireIdentity.mockReset();
    requireIdentity.mockResolvedValue(identity);
    updateAuthenticatedPassword.mockReset();
    updateAuthenticatedPassword.mockResolvedValue(undefined);
    clearMustChangePassword.mockReset();
    clearMustChangePassword.mockResolvedValue(undefined);
    markPasswordChanged.mockReset();
    markPasswordChanged.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000201",
      workspaceId: identity.workspaceId,
      userId: identity.userId,
      email: identity.email,
      displayName: null,
      role: identity.role,
      status: identity.status,
      mustChangePassword: false,
      createdBy: null,
      revokedAt: null,
    });
    createMemberStore.mockReset();
    createMemberStore.mockReturnValue({ markPasswordChanged });
  });

  it("returns the current member identity with no-store caching", async () => {
    const { me } = await loadRoutes();

    const response = await me.handleAccountMeGet(new Request("http://localhost/api/account/me"), {
      requireIdentity,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      member: {
        userId: identity.userId,
        email: identity.email,
        workspaceId: identity.workspaceId,
        role: identity.role,
        status: identity.status,
        mustChangePassword: true,
      },
    });
  });

  it("changes only the authenticated user password and clears the current membership flag through the member store", async () => {
    const { password } = await loadRoutes();

    const response = await password.handleAccountPasswordPost(new Request("http://localhost/api/account/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        newPassword: "updated-password",
        confirmPassword: "updated-password",
      }),
    }), {
      requireIdentity,
      updateAuthenticatedPassword,
      createMemberStore,
    });

    expect(updateAuthenticatedPassword).toHaveBeenCalledWith(identity, "updated-password");
    expect(createMemberStore).toHaveBeenCalledTimes(1);
    expect(markPasswordChanged).toHaveBeenCalledWith(identity.workspaceId, identity.userId, false);
    expect(updateAuthenticatedPassword.mock.invocationCallOrder[0]).toBeLessThan(markPasswordChanged.mock.invocationCallOrder[0]);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });
    expect(JSON.stringify(body)).not.toContain("updated-password");
  });

  it("rejects mismatched or user-targeted password change payloads", async () => {
    const { password } = await loadRoutes();

    const mismatch = await password.handleAccountPasswordPost(new Request("http://localhost/api/account/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        newPassword: "updated-password",
        confirmPassword: "different-password",
      }),
    }), {
      requireIdentity,
      updateAuthenticatedPassword,
      clearMustChangePassword,
    });
    expect(mismatch.status).toBe(400);
    expect(await mismatch.json()).toEqual({ ok: false, error: "INVALID_ACCOUNT_PASSWORD_INPUT" });

    const targeted = await password.handleAccountPasswordPost(new Request("http://localhost/api/account/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "00000000-0000-4000-8000-000000000123",
        newPassword: "updated-password",
        confirmPassword: "updated-password",
      }),
    }), {
      requireIdentity,
      updateAuthenticatedPassword,
      clearMustChangePassword,
    });
    expect(targeted.status).toBe(400);
    expect(await targeted.json()).toEqual({ ok: false, error: "INVALID_ACCOUNT_PASSWORD_INPUT" });
    expect(updateAuthenticatedPassword).not.toHaveBeenCalled();
    expect(clearMustChangePassword).not.toHaveBeenCalled();
  });

  it("masks authenticated password update failures and fails closed when the store-backed flag clear updates no membership row", async () => {
    const { password } = await loadRoutes();
    updateAuthenticatedPassword.mockRejectedValueOnce(new Error("provider secret"));
    markPasswordChanged.mockRejectedValueOnce(new Error("MEMBER_PASSWORD_RESET_FAILED"));

    const authFailure = await password.handleAccountPasswordPost(new Request("http://localhost/api/account/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        newPassword: "updated-password",
        confirmPassword: "updated-password",
      }),
    }), {
      requireIdentity,
      updateAuthenticatedPassword,
      clearMustChangePassword,
    });
    expect(authFailure.status).toBe(502);
    expect(await authFailure.json()).toEqual({ ok: false, error: "ACCOUNT_PASSWORD_UPDATE_FAILED" });

    const memberFailure = await password.handleAccountPasswordPost(new Request("http://localhost/api/account/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        newPassword: "updated-password",
        confirmPassword: "updated-password",
      }),
    }), {
      requireIdentity,
      updateAuthenticatedPassword,
      createMemberStore,
    });
    expect(updateAuthenticatedPassword).toHaveBeenCalledTimes(2);
    expect(markPasswordChanged).toHaveBeenCalledTimes(1);
    expect(updateAuthenticatedPassword.mock.invocationCallOrder[1]).toBeLessThan(markPasswordChanged.mock.invocationCallOrder[0]);
    expect(memberFailure.status).toBe(502);
    expect(await memberFailure.json()).toEqual({ ok: false, error: "ACCOUNT_PASSWORD_UPDATE_FAILED" });
  });

  it("fails closed on member auth for account routes", async () => {
    const { me } = await loadRoutes();
    requireIdentity.mockRejectedValueOnce(new HttpError(403, "MEMBER_REVOKED"));

    const response = await me.handleAccountMeGet(new Request("http://localhost/api/account/me"), {
      requireIdentity,
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: "MEMBER_REVOKED" });
  });
});
