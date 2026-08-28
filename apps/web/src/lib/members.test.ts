import { describe, expect, it } from "vitest";
import type { InternalMemberIdentity } from "./auth.js";
import type {
  AuditPort,
  AuthAdminPort,
  MemberAuditEvent,
  MemberRecord,
  MemberStore,
} from "./members.js";
import { MemberService } from "./members.js";
import { createServerAuthAdminPort } from "./supabase/members.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";

function createIdentity(overrides: Partial<InternalMemberIdentity> = {}): InternalMemberIdentity {
  return {
    userId: "actor-1",
    email: "owner@example.com",
    workspaceId,
    role: "owner",
    status: "active",
    mustChangePassword: false,
    ...overrides,
  };
}

function createMemberRecord(overrides: Partial<MemberRecord> = {}): MemberRecord {
  return {
    id: "member-row-1",
    workspaceId,
    userId: "member-user-1",
    email: "member@example.com",
    displayName: "Member Example",
    role: "member",
    status: "active",
    mustChangePassword: true,
    createdBy: "actor-1",
    revokedAt: null,
    ...overrides,
  };
}

class FakeMemberStore implements MemberStore {
  readonly rows = new Map<string, MemberRecord>();
  inserted: Array<Omit<MemberRecord, "id">> = [];
  updatedRoles: Array<{ userId: string; role: MemberRecord["role"] }> = [];
  updatedStatuses: Array<{ userId: string; status: MemberRecord["status"] }> = [];
  passwordFlags: Array<{ userId: string; mustChangePassword: boolean }> = [];
  failInsert = false;

  constructor(rows: MemberRecord[] = []) {
    for (const row of rows) this.rows.set(row.userId, row);
  }

  async list(currentWorkspaceId: string): Promise<MemberRecord[]> {
    return Array.from(this.rows.values()).filter((row) => row.workspaceId === currentWorkspaceId);
  }

  async find(
    currentWorkspaceId: string,
    lookup: { userId?: string; email?: string },
  ): Promise<MemberRecord | null> {
    for (const row of this.rows.values()) {
      if (row.workspaceId !== currentWorkspaceId) continue;
      if (lookup.userId && row.userId === lookup.userId) return row;
      if (lookup.email && row.email === lookup.email) return row;
    }
    return null;
  }

  async insert(input: Omit<MemberRecord, "id">): Promise<MemberRecord> {
    this.inserted.push(input);
    if (this.failInsert) throw new Error("duplicate key value violates unique constraint");
    const row = { ...input, id: `member-row-${this.rows.size + 1}` };
    this.rows.set(row.userId, row);
    return row;
  }

  async updateRole(
    currentWorkspaceId: string,
    userId: string,
    role: MemberRecord["role"],
  ): Promise<MemberRecord> {
    const row = await this.requireRow(currentWorkspaceId, userId);
    const next = { ...row, role };
    this.rows.set(userId, next);
    this.updatedRoles.push({ userId, role });
    return next;
  }

  async updateStatus(
    currentWorkspaceId: string,
    userId: string,
    status: MemberRecord["status"],
  ): Promise<MemberRecord> {
    const row = await this.requireRow(currentWorkspaceId, userId);
    const next = {
      ...row,
      status,
      revokedAt: status === "revoked" ? "2026-08-28T00:00:00.000Z" : null,
    };
    this.rows.set(userId, next);
    this.updatedStatuses.push({ userId, status });
    return next;
  }

  async markPasswordChanged(
    currentWorkspaceId: string,
    userId: string,
    mustChangePassword: boolean,
  ): Promise<MemberRecord> {
    const row = await this.requireRow(currentWorkspaceId, userId);
    const next = { ...row, mustChangePassword };
    this.rows.set(userId, next);
    this.passwordFlags.push({ userId, mustChangePassword });
    return next;
  }

  private async requireRow(currentWorkspaceId: string, userId: string): Promise<MemberRecord> {
    const row = this.rows.get(userId);
    if (!row || row.workspaceId !== currentWorkspaceId) throw new Error("MEMBER_NOT_FOUND");
    return row;
  }
}

class FakeAuthAdminPort implements AuthAdminPort {
  usersByEmail = new Map<string, { userId: string; email: string }>();
  createdUsers: Array<{ email: string; password: string; emailConfirm: boolean }> = [];
  updatedPasswords: Array<{ userId: string; password: string }> = [];
  deletedUsers: string[] = [];

  async findUserByEmail(email: string) {
    return this.usersByEmail.get(email) ?? null;
  }

  async createUser(input: { email: string; password: string; emailConfirm: boolean }) {
    this.createdUsers.push(input);
    const user = { userId: `auth-${this.createdUsers.length}`, email: input.email };
    this.usersByEmail.set(input.email, user);
    return user;
  }

  async updatePassword(userId: string, password: string) {
    this.updatedPasswords.push({ userId, password });
  }

  async deleteUser(userId: string) {
    this.deletedUsers.push(userId);
  }
}

class FakeAuditPort implements AuditPort {
  events: MemberAuditEvent[] = [];
  failAppend = false;

  async append(event: MemberAuditEvent) {
    if (this.failAppend) throw new Error("audit unavailable");
    this.events.push(event);
  }
}

function createService(args: {
  actor?: InternalMemberIdentity;
  store?: FakeMemberStore;
  auth?: FakeAuthAdminPort;
  audit?: FakeAuditPort;
}) {
  return new MemberService({
    actor: args.actor ?? createIdentity(),
    store: args.store ?? new FakeMemberStore(),
    authAdmin: args.auth ?? new FakeAuthAdminPort(),
    audit: args.audit ?? new FakeAuditPort(),
  });
}

describe("MemberService", () => {
  it("creates a new auth user with confirmed email and inserts membership with must-change-password", async () => {
    const store = new FakeMemberStore();
    const auth = new FakeAuthAdminPort();
    const audit = new FakeAuditPort();

    const member = await createService({ store, auth, audit }).createMember({
      email: " NewMember@example.com ",
      displayName: "  New Member ",
      role: "member",
      password: "temporary-pass",
    });

    expect(auth.createdUsers).toEqual([{
      email: "newmember@example.com",
      password: "temporary-pass",
      emailConfirm: true,
    }]);
    expect(member).toMatchObject({
      email: "newmember@example.com",
      displayName: "New Member",
      role: "member",
      status: "active",
      mustChangePassword: true,
      createdBy: "actor-1",
    });
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({
      action: "workspace_member.created",
      payload: { role: "member", status: "active", mustChangePassword: true },
    });
    expect(JSON.stringify(audit.events[0])).not.toContain("temporary-pass");
  });

  it("reuses an existing auth user and resets the supplied initial password without persisting it", async () => {
    const store = new FakeMemberStore();
    const auth = new FakeAuthAdminPort();
    auth.usersByEmail.set("member@example.com", { userId: "auth-existing", email: "member@example.com" });
    const audit = new FakeAuditPort();

    const member = await createService({ store, auth, audit }).createMember({
      email: "member@example.com",
      displayName: "Existing User",
      role: "member",
      password: "reset-password",
    });

    expect(auth.createdUsers).toEqual([]);
    expect(auth.updatedPasswords).toEqual([{ userId: "auth-existing", password: "reset-password" }]);
    expect(member.userId).toBe("auth-existing");
    expect(JSON.stringify(store.inserted[0])).not.toContain("reset-password");
    expect(JSON.stringify(audit.events[0])).not.toContain("reset-password");
  });

  it("rejects duplicate active memberships and refuses create over revoked memberships", async () => {
    const activeRow = createMemberRecord();
    await expect(createService({
      store: new FakeMemberStore([activeRow]),
      auth: new FakeAuthAdminPort(),
      audit: new FakeAuditPort(),
    }).createMember({
      email: activeRow.email,
      role: "member",
      password: "temporary-pass",
    })).rejects.toMatchObject({ code: "MEMBER_ALREADY_EXISTS" });

    await expect(createService({
      store: new FakeMemberStore([createMemberRecord({ userId: "revoked-user", email: "revoked@example.com", status: "revoked", revokedAt: "2026-08-28T00:00:00.000Z" })]),
      auth: new FakeAuthAdminPort(),
      audit: new FakeAuditPort(),
    }).createMember({
      email: "revoked@example.com",
      role: "member",
      password: "temporary-pass",
    })).rejects.toMatchObject({ code: "MEMBER_REVOKED" });
  });

  it("cleans up a newly created auth user when membership insertion fails and returns a generic error", async () => {
    const store = new FakeMemberStore();
    store.failInsert = true;
    const auth = new FakeAuthAdminPort();

    const password = "temporary-pass";
    await expect(createService({
      store,
      auth,
      audit: new FakeAuditPort(),
    }).createMember({
      email: "member@example.com",
      role: "member",
      password,
    })).rejects.toMatchObject({ code: "MEMBER_CREATE_FAILED" });

    expect(auth.deletedUsers).toEqual(["auth-1"]);
    await createService({
      store,
      auth,
      audit: new FakeAuditPort(),
    }).createMember({
      email: "member@example.com",
      role: "member",
      password,
    }).catch((error) => {
      expect(String(error)).not.toContain(password);
    });
  });

  it("does not delete a newly created auth user when audit append fails after membership insertion", async () => {
    const store = new FakeMemberStore();
    const auth = new FakeAuthAdminPort();
    const audit = new FakeAuditPort();
    audit.failAppend = true;

    await expect(createService({
      store,
      auth,
      audit,
    }).createMember({
      email: "member@example.com",
      role: "member",
      password: "temporary-pass",
    })).rejects.toMatchObject({ code: "MEMBER_AUDIT_FAILED" });

    expect(auth.deletedUsers).toEqual([]);
    expect(store.rows.get("auth-1")).toMatchObject({
      email: "member@example.com",
      role: "member",
      status: "active",
      mustChangePassword: true,
    });
  });

  it("enforces owner and admin boundaries for creating admins, changing roles, revoking, restoring, and protecting the owner", async () => {
    const adminActor = createIdentity({ userId: "admin-1", email: "admin@example.com", role: "admin" });
    const memberActor = createIdentity({ userId: "member-actor", email: "plain@example.com", role: "member" });
    const adminRow = createMemberRecord({ userId: "admin-target", email: "admin-target@example.com", role: "admin" });
    const memberRow = createMemberRecord({ userId: "member-target", email: "member-target@example.com", role: "member" });
    const ownerRow = createMemberRecord({ userId: "owner-target", email: "owner@example.com", role: "owner", mustChangePassword: false });
    const store = new FakeMemberStore([adminRow, memberRow, ownerRow]);

    await expect(createService({ actor: memberActor, store }).createMember({
      email: "new@example.com",
      role: "member",
      password: "temporary-pass",
    })).rejects.toMatchObject({ code: "ADMIN_REQUIRED" });

    await expect(createService({ actor: adminActor, store }).createMember({
      email: "new-admin@example.com",
      role: "admin",
      password: "temporary-pass",
    })).rejects.toMatchObject({ code: "OWNER_REQUIRED" });

    await expect(createService({ actor: adminActor, store }).changeRole("member-target", { role: "admin" }))
      .rejects.toMatchObject({ code: "OWNER_REQUIRED" });
    await expect(createService({ actor: adminActor, store }).changeStatus("admin-target", { status: "revoked" }))
      .rejects.toMatchObject({ code: "OWNER_REQUIRED" });
    await expect(createService({ store }).changeRole("owner-target", { role: "member" }))
      .rejects.toMatchObject({ code: "OWNER_PROTECTED" });
    await expect(createService({ store }).changeStatus("owner-target", { status: "revoked" }))
      .rejects.toMatchObject({ code: "OWNER_PROTECTED" });

    await expect(createService({ store }).changeRole("admin-target", { role: "member" }))
      .resolves.toMatchObject({ role: "member" });
    await expect(createService({ store }).changeStatus("admin-target", { status: "revoked" }))
      .resolves.toMatchObject({ status: "revoked" });
    await expect(createService({ store }).changeStatus("admin-target", { status: "active" }))
      .resolves.toMatchObject({ status: "active" });
  });

  it("resets a password by forcing must-change-password and emits a safe audit event", async () => {
    const store = new FakeMemberStore([createMemberRecord({ mustChangePassword: false })]);
    const auth = new FakeAuthAdminPort();
    const audit = new FakeAuditPort();

    const member = await createService({ store, auth, audit }).resetPassword("member-user-1", {
      password: "reset-password",
    });

    expect(auth.updatedPasswords).toEqual([{ userId: "member-user-1", password: "reset-password" }]);
    expect(store.passwordFlags).toEqual([{ userId: "member-user-1", mustChangePassword: true }]);
    expect(member.mustChangePassword).toBe(true);
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({
      action: "workspace_member.password_reset",
      payload: { mustChangePassword: true },
    });
    expect(JSON.stringify(audit.events[0])).not.toContain("reset-password");
    expect("password" in audit.events[0].payload).toBe(false);
  });

  it("emits only safe audit metadata for role and status changes", async () => {
    const store = new FakeMemberStore([createMemberRecord()]);
    const audit = new FakeAuditPort();
    const service = createService({ store, audit });

    await service.changeRole("member-user-1", { role: "admin" });
    await service.changeStatus("member-user-1", { status: "revoked" });

    expect(audit.events).toEqual([
      expect.objectContaining({
        action: "workspace_member.role_changed",
        payload: { previousRole: "member", role: "admin" },
      }),
      expect.objectContaining({
        action: "workspace_member.status_changed",
        payload: { previousStatus: "active", status: "revoked" },
      }),
    ]);
    expect(JSON.stringify(audit.events)).not.toContain("password");
  });
});

describe("createServerAuthAdminPort", () => {
  it("finds a user on later auth admin pages and stops once found", async () => {
    const pages = [
      Array.from({ length: 1000 }, (_, index) => ({
        id: `page-1-user-${index + 1}`,
        email: `user${index + 1}@example.com`,
      })),
      [
        { id: "target-user", email: "Target@Example.com" },
        { id: "page-2-user-2", email: "page2@example.com" },
      ],
    ];
    const calls: Array<{ page?: number; perPage?: number }> = [];
    const authAdmin = createServerAuthAdminPort({
      auth: {
        admin: {
          async listUsers(params?: { page?: number; perPage?: number }) {
            calls.push(params ?? {});
            return { data: { users: pages[(params?.page ?? 1) - 1] ?? [] } };
          },
          async createUser() {
            throw new Error("not used");
          },
          async updateUserById() {
            throw new Error("not used");
          },
          async deleteUser() {
            throw new Error("not used");
          },
        },
      },
    } as never);

    await expect(authAdmin.findUserByEmail("target@example.com")).resolves.toEqual({
      userId: "target-user",
      email: "target@example.com",
    });
    expect(calls).toEqual([
      { page: 1, perPage: 1000 },
      { page: 2, perPage: 1000 },
    ]);
  });

  it("returns null after the first short auth admin page without a match", async () => {
    const calls: Array<{ page?: number; perPage?: number }> = [];
    const authAdmin = createServerAuthAdminPort({
      auth: {
        admin: {
          async listUsers(params?: { page?: number; perPage?: number }) {
            calls.push(params ?? {});
            const page = params?.page ?? 1;
            return {
              data: {
                users: page <= 100
                  ? Array.from({ length: 1000 }, (_, index) => ({
                      id: `page-${page}-user-${index + 1}`,
                      email: `page-${page}-user-${index + 1}@example.com`,
                    }))
                  : [{ id: "final-user", email: "final@example.com" }],
              },
            };
          },
          async createUser() {
            throw new Error("not used");
          },
          async updateUserById() {
            throw new Error("not used");
          },
          async deleteUser() {
            throw new Error("not used");
          },
        },
      },
    } as never);

    await expect(authAdmin.findUserByEmail("missing@example.com")).resolves.toBeNull();
    expect(calls).toHaveLength(101);
    expect(calls.at(-1)).toEqual({ page: 101, perPage: 1000 });
  });
});
