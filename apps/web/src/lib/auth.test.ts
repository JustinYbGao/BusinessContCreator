import { describe, expect, it } from "vitest";
import {
  type AuthEnvironment,
  type AuthPort,
  type WorkspaceLookupPort,
  requireInternalAdmin,
} from "./auth.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";

const env: AuthEnvironment = {
  ADMIN_EMAIL_ALLOWLIST: " owner@example.com,SECOND@example.com ",
  INTERNAL_WORKSPACE_ID: workspaceId,
};

function fakeAuth(email: string | null): AuthPort {
  return {
    getUser: async () => email ? { id: "user-1", email } : null,
  };
}

function workspaceLookup(exists = true): WorkspaceLookupPort {
  return { exists: async () => exists };
}

describe("requireInternalAdmin", () => {
  it("fails closed when the session lookup is unavailable", async () => {
    const unavailableAuth: AuthPort = {
      getUser: async () => {
        throw new Error("auth backend unavailable");
      },
    };

    await expect(requireInternalAdmin(unavailableAuth, workspaceLookup(), env))
      .rejects.toMatchObject({ status: 500, code: "AUTH_UNAVAILABLE" });
  });

  it("rejects a missing session with 401", async () => {
    await expect(requireInternalAdmin(fakeAuth(null), workspaceLookup(), env))
      .rejects.toMatchObject({ status: 401 });
  });

  it("rejects an email outside the allowlist with 403", async () => {
    await expect(requireInternalAdmin(fakeAuth("other@example.com"), workspaceLookup(), env))
      .rejects.toMatchObject({ status: 403 });
  });

  it("normalizes the configured allowlist and authenticated email to lowercase", async () => {
    await expect(requireInternalAdmin(fakeAuth("OWNER@EXAMPLE.COM"), workspaceLookup(), env))
      .resolves.toMatchObject({ email: "owner@example.com", workspaceId });
  });

  it("accepts the configured admin only when the internal Workspace exists", async () => {
    await expect(requireInternalAdmin(fakeAuth("owner@example.com"), workspaceLookup(), env))
      .resolves.toMatchObject({ userId: "user-1", email: "owner@example.com", workspaceId });

    await expect(requireInternalAdmin(fakeAuth("owner@example.com"), workspaceLookup(false), env))
      .rejects.toMatchObject({ status: 500 });
  });

  it("fails closed when the Workspace lookup is unavailable", async () => {
    const unavailableWorkspaces: WorkspaceLookupPort = {
      exists: async () => {
        throw new Error("database unavailable");
      },
    };

    await expect(requireInternalAdmin(fakeAuth("owner@example.com"), unavailableWorkspaces, env))
      .rejects.toMatchObject({ status: 500, code: "WORKSPACE_UNAVAILABLE" });
  });

  it("rejects a missing or invalid INTERNAL_WORKSPACE_ID", async () => {
    await expect(requireInternalAdmin(fakeAuth("owner@example.com"), workspaceLookup(), {
      ADMIN_EMAIL_ALLOWLIST: "owner@example.com",
    })).rejects.toMatchObject({ status: 500 });

    await expect(requireInternalAdmin(fakeAuth("owner@example.com"), workspaceLookup(), {
      ...env,
      INTERNAL_WORKSPACE_ID: "not-a-uuid",
    })).rejects.toMatchObject({ status: 500 });
  });

  it("derives identity from server auth and configured Workspace, not request JSON", async () => {
    const requestJson = {
      email: "attacker@example.com",
      workspaceId: "00000000-0000-4000-8000-000000000099",
    };

    const identity = await requireInternalAdmin(fakeAuth("owner@example.com"), workspaceLookup(), env);

    expect(identity).toEqual({ userId: "user-1", email: "owner@example.com", workspaceId });
    expect(identity.email).not.toBe(requestJson.email);
    expect(identity.workspaceId).not.toBe(requestJson.workspaceId);
  });
});
