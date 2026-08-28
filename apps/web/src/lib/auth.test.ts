import { describe, expect, it } from "vitest";
import {
  type AuthEnvironment,
  type AuthPort,
  type InternalMemberIdentity,
  type MemberLookupPort,
  type WorkspaceLookupPort,
  requireInternalAdmin,
  requireInternalMember,
  requireInternalMemberAdmin,
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

function memberLookup(identity: InternalMemberIdentity | null): MemberLookupPort {
  return {
    getByUserId: async () => identity,
  };
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

describe("requireInternalMember", () => {
  it("returns the matching active member row", async () => {
    await expect(
      requireInternalMember(
        fakeAuth("member@example.com"),
        workspaceLookup(),
        memberLookup({
          userId: "user-1",
          email: "member@example.com",
          workspaceId,
          role: "member",
          status: "active",
          mustChangePassword: true,
        }),
        env,
      ),
    ).resolves.toEqual({
      userId: "user-1",
      email: "member@example.com",
      workspaceId,
      role: "member",
      status: "active",
      mustChangePassword: true,
    });
  });

  it("rejects a revoked member row with 403", async () => {
    await expect(
      requireInternalMember(
        fakeAuth("owner@example.com"),
        workspaceLookup(),
        memberLookup({
          userId: "user-1",
          email: "owner@example.com",
          workspaceId,
          role: "owner",
          status: "revoked",
          mustChangePassword: false,
        }),
        env,
      ),
    ).rejects.toMatchObject({ status: 403, code: "MEMBER_REVOKED" });
  });

  it("rejects an authenticated user without a member row unless they are allowlisted", async () => {
    await expect(
      requireInternalMember(fakeAuth("other@example.com"), workspaceLookup(), memberLookup(null), env),
    ).rejects.toMatchObject({ status: 403, code: "MEMBER_REQUIRED" });
  });

  it("returns a bootstrap owner identity for an allowlisted user without a member row", async () => {
    await expect(
      requireInternalMember(
        fakeAuth(" OWNER@EXAMPLE.COM "),
        workspaceLookup(),
        memberLookup(null),
        env,
      ),
    ).resolves.toEqual({
      userId: "user-1",
      email: "owner@example.com",
      workspaceId,
      role: "owner",
      status: "active",
      mustChangePassword: false,
    });
  });

  it("fails closed when the member lookup is unavailable", async () => {
    const unavailableMembers: MemberLookupPort = {
      getByUserId: async () => {
        throw new Error("members unavailable");
      },
    };

    await expect(
      requireInternalMember(
        fakeAuth("owner@example.com"),
        workspaceLookup(),
        unavailableMembers,
        env,
      ),
    ).rejects.toMatchObject({ status: 500, code: "MEMBERS_UNAVAILABLE" });
  });
});

describe("requireInternalMemberAdmin", () => {
  it("rejects a plain member but allows admin and bootstrap owner identities", async () => {
    await expect(
      requireInternalMemberAdmin(
        fakeAuth("member@example.com"),
        workspaceLookup(),
        memberLookup({
          userId: "user-1",
          email: "member@example.com",
          workspaceId,
          role: "member",
          status: "active",
          mustChangePassword: false,
        }),
        env,
      ),
    ).rejects.toMatchObject({ status: 403, code: "ADMIN_REQUIRED" });

    await expect(
      requireInternalMemberAdmin(
        fakeAuth("admin@example.com"),
        workspaceLookup(),
        memberLookup({
          userId: "user-1",
          email: "admin@example.com",
          workspaceId,
          role: "admin",
          status: "active",
          mustChangePassword: false,
        }),
        env,
      ),
    ).resolves.toMatchObject({ role: "admin" });

    await expect(
      requireInternalMemberAdmin(
        fakeAuth("owner@example.com"),
        workspaceLookup(),
        memberLookup(null),
        env,
      ),
    ).resolves.toMatchObject({ role: "owner", email: "owner@example.com" });
  });
});
