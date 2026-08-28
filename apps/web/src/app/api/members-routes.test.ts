import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError, type InternalMemberIdentity } from "../../lib/auth";
import type { MemberRecord } from "../../lib/members";

const MEMBER_ID = "00000000-0000-4000-8000-000000000011";
const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";

function createIdentity(overrides: Partial<InternalMemberIdentity> = {}): InternalMemberIdentity {
  return {
    userId: "00000000-0000-4000-8000-000000000099",
    email: "owner@example.com",
    workspaceId: WORKSPACE_ID,
    role: "owner",
    status: "active",
    mustChangePassword: false,
    ...overrides,
  };
}

function createMember(overrides: Partial<MemberRecord> = {}): MemberRecord {
  return {
    id: MEMBER_ID,
    workspaceId: WORKSPACE_ID,
    userId: "00000000-0000-4000-8000-000000000012",
    email: "member@example.com",
    displayName: "Member Example",
    role: "member",
    status: "active",
    mustChangePassword: true,
    createdBy: "00000000-0000-4000-8000-000000000099",
    revokedAt: null,
    ...overrides,
  };
}

async function loadRoutes() {
  return {
    members: await import("./members/route"),
    member: await import("./members/[memberId]/route"),
    memberPassword: await import("./members/[memberId]/password/route"),
  };
}

describe("Task 4 member route boundaries", () => {
  const identity = createIdentity();
  const service = {
    list: vi.fn(),
    createMember: vi.fn(),
    changeRole: vi.fn(),
    changeStatus: vi.fn(),
    resetPassword: vi.fn(),
  };
  const createMemberService = vi.fn();
  const requireIdentity = vi.fn();

  beforeEach(() => {
    requireIdentity.mockReset();
    requireIdentity.mockResolvedValue(identity);
    createMemberService.mockReset();
    createMemberService.mockImplementation((actor: InternalMemberIdentity) => {
      expect(actor).toEqual(identity);
      return service;
    });
    for (const mock of Object.values(service)) mock.mockReset();
    service.list.mockResolvedValue([createMember()]);
    service.createMember.mockResolvedValue(createMember());
    service.changeRole.mockResolvedValue(createMember({ role: "admin" }));
    service.changeStatus.mockResolvedValue(createMember({ status: "revoked", revokedAt: "2026-08-28T12:00:00.000Z" }));
    service.resetPassword.mockResolvedValue(createMember({ mustChangePassword: true }));
  });

  it("lists only safe member fields with no-store caching", async () => {
    const { members } = await loadRoutes();

    const response = await members.handleMembersGet(new Request(`http://localhost/api/members?workspaceId=${encodeURIComponent("00000000-0000-4000-8000-999999999999")}`), {
      requireIdentity,
      createMemberService,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      members: [{
        id: MEMBER_ID,
        userId: "00000000-0000-4000-8000-000000000012",
        email: "member@example.com",
        displayName: "Member Example",
        role: "member",
        status: "active",
        mustChangePassword: true,
        revokedAt: null,
      }],
    });
    expect(service.list).toHaveBeenCalledTimes(1);
  });

  it("creates a member from the authenticated actor context and never echoes the temporary password", async () => {
    const { members } = await loadRoutes();

    const response = await members.handleMembersPost(new Request("http://localhost/api/members", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: " NewMember@example.com ",
        displayName: "  New Member ",
        role: "member",
        temporaryPassword: "temporary-pass",
      }),
    }), {
      requireIdentity,
      createMemberService,
    });

    expect(service.createMember).toHaveBeenCalledWith({
      email: " NewMember@example.com ",
      displayName: "  New Member ",
      role: "member",
      password: "temporary-pass",
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({
      member: {
        id: MEMBER_ID,
        userId: "00000000-0000-4000-8000-000000000012",
        email: "member@example.com",
        displayName: "Member Example",
        role: "member",
        status: "active",
        mustChangePassword: true,
        revokedAt: null,
      },
    });
    expect(JSON.stringify(body)).not.toContain("temporary-pass");
  });

  it("rejects request-selected actor or workspace fields instead of trusting them", async () => {
    const { members } = await loadRoutes();

    const response = await members.handleMembersPost(new Request("http://localhost/api/members", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "member@example.com",
        role: "member",
        temporaryPassword: "temporary-pass",
        workspaceId: "00000000-0000-4000-8000-999999999999",
        actorEmail: "attacker@example.com",
        actorRole: "owner",
      }),
    }), {
      requireIdentity,
      createMemberService,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "INVALID_MEMBER_CREATE_INPUT" });
    expect(service.createMember).not.toHaveBeenCalled();
  });

  it("maps duplicate and unavailable member-create failures to stable errors", async () => {
    const { members } = await loadRoutes();
    service.createMember.mockRejectedValueOnce({ code: "MEMBER_ALREADY_EXISTS", message: "duplicate key value" });
    service.createMember.mockRejectedValueOnce({ code: "AUTH_ADMIN_UNAVAILABLE", message: "provider details should not leak" });

    const duplicate = await members.handleMembersPost(new Request("http://localhost/api/members", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "member@example.com",
        role: "member",
        temporaryPassword: "temporary-pass",
      }),
    }), {
      requireIdentity,
      createMemberService,
    });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ ok: false, error: "MEMBER_ALREADY_EXISTS" });

    const unavailable = await members.handleMembersPost(new Request("http://localhost/api/members", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "member@example.com",
        role: "member",
        temporaryPassword: "temporary-pass",
      }),
    }), {
      requireIdentity,
      createMemberService,
    });
    expect(unavailable.status).toBe(502);
    expect(await unavailable.json()).toEqual({ ok: false, error: "AUTH_ADMIN_UNAVAILABLE" });
  });

  it("routes exactly one mutable field through the scoped member id", async () => {
    const { member } = await loadRoutes();

    const roleResponse = await member.handleMemberPatch(new Request("http://localhost/api/members/member-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    }), { memberId: "00000000-0000-4000-8000-000000000055" }, {
      requireIdentity,
      createMemberService,
    });

    expect(service.changeRole).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000055", { role: "admin" });
    expect(service.changeStatus).not.toHaveBeenCalled();
    expect(roleResponse.status).toBe(200);
    expect(await roleResponse.json()).toEqual({
      member: {
        id: MEMBER_ID,
        userId: "00000000-0000-4000-8000-000000000012",
        email: "member@example.com",
        displayName: "Member Example",
        role: "admin",
        status: "active",
        mustChangePassword: true,
        revokedAt: null,
      },
    });

    const statusResponse = await member.handleMemberPatch(new Request("http://localhost/api/members/member-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "revoked" }),
    }), { memberId: "00000000-0000-4000-8000-000000000055" }, {
      requireIdentity,
      createMemberService,
    });

    expect(service.changeStatus).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000055", { status: "revoked" });
    expect(statusResponse.status).toBe(200);
    expect(await statusResponse.json()).toEqual({
      member: {
        id: MEMBER_ID,
        userId: "00000000-0000-4000-8000-000000000012",
        email: "member@example.com",
        displayName: "Member Example",
        role: "member",
        status: "revoked",
        mustChangePassword: true,
        revokedAt: "2026-08-28T12:00:00.000Z",
      },
    });
  });

  it("rejects mixed patch payloads and unknown owner role requests before calling the service", async () => {
    const { member } = await loadRoutes();

    const mixed = await member.handleMemberPatch(new Request("http://localhost/api/members/member-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "admin", status: "revoked" }),
    }), { memberId: "00000000-0000-4000-8000-000000000055" }, {
      requireIdentity,
      createMemberService,
    });
    expect(mixed.status).toBe(400);
    expect(await mixed.json()).toEqual({ ok: false, error: "INVALID_MEMBER_PATCH_INPUT" });

    const owner = await member.handleMemberPatch(new Request("http://localhost/api/members/member-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "owner" }),
    }), { memberId: "00000000-0000-4000-8000-000000000055" }, {
      requireIdentity,
      createMemberService,
    });
    expect(owner.status).toBe(400);
    expect(await owner.json()).toEqual({ ok: false, error: "INVALID_MEMBER_PATCH_INPUT" });
    expect(service.changeRole).not.toHaveBeenCalledWith("00000000-0000-4000-8000-000000000055", { role: "owner" });
  });

  it("maps member patch permission and not-found failures", async () => {
    const { member } = await loadRoutes();
    service.changeRole.mockRejectedValueOnce({ code: "OWNER_REQUIRED", message: "no leak" });
    service.changeStatus.mockRejectedValueOnce({ code: "MEMBER_NOT_FOUND", message: "scoped miss" });

    const permission = await member.handleMemberPatch(new Request("http://localhost/api/members/member-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    }), { memberId: "00000000-0000-4000-8000-000000000055" }, {
      requireIdentity,
      createMemberService,
    });
    expect(permission.status).toBe(403);
    expect(await permission.json()).toEqual({ ok: false, error: "OWNER_REQUIRED" });

    const missing = await member.handleMemberPatch(new Request("http://localhost/api/members/member-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    }), { memberId: "00000000-0000-4000-8000-000000000055" }, {
      requireIdentity,
      createMemberService,
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ ok: false, error: "MEMBER_NOT_FOUND" });
  });

  it("resets a member password without echoing it and preserves must-change-password", async () => {
    const { memberPassword } = await loadRoutes();

    const response = await memberPassword.handleMemberPasswordPost(new Request("http://localhost/api/members/member-1/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ temporaryPassword: "reset-password" }),
    }), { memberId: "00000000-0000-4000-8000-000000000055" }, {
      requireIdentity,
      createMemberService,
    });

    expect(service.resetPassword).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000055", { password: "reset-password" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      member: {
        id: MEMBER_ID,
        userId: "00000000-0000-4000-8000-000000000012",
        email: "member@example.com",
        displayName: "Member Example",
        role: "member",
        status: "active",
        mustChangePassword: true,
        revokedAt: null,
      },
    });
    expect(JSON.stringify(body)).not.toContain("reset-password");
  });

  it("fails closed on auth before any member-route service call", async () => {
    const { members } = await loadRoutes();
    requireIdentity.mockRejectedValueOnce(new HttpError(403, "ADMIN_REQUIRED"));

    const response = await members.handleMembersGet(new Request("http://localhost/api/members"), {
      requireIdentity,
      createMemberService,
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: "ADMIN_REQUIRED" });
    expect(createMemberService).not.toHaveBeenCalled();
  });
});
