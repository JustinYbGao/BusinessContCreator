import { describe, expect, it } from "vitest";
import type { InternalMemberRole, InternalMemberStatus } from "../auth.js";
import { createServerMemberStore } from "./members.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";

type WorkspaceMemberRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  role: InternalMemberRole;
  status: InternalMemberStatus;
  must_change_password: boolean;
  created_by: string | null;
  revoked_at: string | null;
  created_at: string;
};

function createRow(overrides: Partial<WorkspaceMemberRow> = {}): WorkspaceMemberRow {
  return {
    id: "member-row-1",
    workspace_id: workspaceId,
    user_id: "member-user-1",
    email: "member@example.com",
    display_name: "Member Example",
    role: "member",
    status: "active",
    must_change_password: true,
    created_by: "actor-1",
    revoked_at: null,
    created_at: "2026-08-28T12:00:00.000Z",
    ...overrides,
  };
}

class FakeSupabaseQuery {
  private mode: "select" | "insert" | "update" = "select";
  private filters = new Map<string, string>();
  private insertedRow: Partial<WorkspaceMemberRow> | null = null;
  private updatedRow: Partial<WorkspaceMemberRow> | null = null;

  constructor(private readonly rows: WorkspaceMemberRow[]) {}

  select() {
    return this;
  }

  eq(column: string, value: string) {
    this.filters.set(column, value);
    return this;
  }

  order() {
    return this;
  }

  insert(row: Partial<WorkspaceMemberRow>) {
    this.mode = "insert";
    this.insertedRow = row;
    return this;
  }

  update(row: Partial<WorkspaceMemberRow>) {
    this.mode = "update";
    this.updatedRow = row;
    return this;
  }

  async maybeSingle() {
    const row = this.findFirst();
    return { data: row ?? null, error: null };
  }

  async single() {
    const row = this.applyMutation();
    if (!row) return { data: null, error: new Error("NOT_FOUND") };
    return { data: row, error: null };
  }

  then<TResult1 = { data: WorkspaceMemberRow[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: WorkspaceMemberRow[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve({ data: this.listRows(), error: null }).then(onfulfilled, onrejected);
  }

  private listRows() {
    return this.rows.filter((row) => this.matches(row));
  }

  private findFirst() {
    return this.listRows()[0] ?? null;
  }

  private matches(row: WorkspaceMemberRow) {
    for (const [column, value] of this.filters.entries()) {
      if ((row as unknown as Record<string, string | null>)[column] !== value) return false;
    }
    return true;
  }

  private applyMutation() {
    if (this.mode === "insert" && this.insertedRow) {
      const row = {
        id: `member-row-${this.rows.length + 1}`,
        created_at: "2026-08-28T12:30:00.000Z",
        display_name: null,
        revoked_at: null,
        created_by: null,
        ...this.insertedRow,
      } as WorkspaceMemberRow;
      this.rows.push(row);
      return row;
    }

    if (this.mode === "update" && this.updatedRow) {
      const row = this.findFirst();
      if (!row) return null;
      const next = { ...row, ...this.updatedRow };
      Object.assign(row, next);
      return row;
    }

    return this.findFirst();
  }
}

class FakeSupabaseClient {
  constructor(private readonly rows: WorkspaceMemberRow[]) {}

  from(table: string) {
    if (table !== "workspace_members") throw new Error(`Unexpected table: ${table}`);
    return new FakeSupabaseQuery(this.rows);
  }
}

describe("createServerMemberStore", () => {
  it("maps created_at on member reads", async () => {
    const store = createServerMemberStore(new FakeSupabaseClient([createRow()]) as never);

    await expect(store.list(workspaceId)).resolves.toEqual([{
      id: "member-row-1",
      workspaceId,
      userId: "member-user-1",
      email: "member@example.com",
      displayName: "Member Example",
      role: "member",
      status: "active",
      mustChangePassword: true,
      createdAt: "2026-08-28T12:00:00.000Z",
      createdBy: "actor-1",
      revokedAt: null,
    }]);

    await expect(store.find(workspaceId, { userId: "member-user-1" })).resolves.toMatchObject({
      createdAt: "2026-08-28T12:00:00.000Z",
    });
  });

  it("returns created_at from inserts and updates", async () => {
    const store = createServerMemberStore(new FakeSupabaseClient([]) as never);

    const inserted = await store.insert({
      workspaceId,
      userId: "member-user-2",
      email: "newmember@example.com",
      displayName: "New Member",
      role: "member",
      status: "active",
      mustChangePassword: true,
      createdBy: "actor-1",
      revokedAt: null,
    });

    expect(inserted.createdAt).toBe("2026-08-28T12:30:00.000Z");

    const promoted = await store.updateRole(workspaceId, "member-user-2", "admin");
    expect(promoted.createdAt).toBe("2026-08-28T12:30:00.000Z");

    const revoked = await store.updateStatus(workspaceId, "member-user-2", "revoked");
    expect(revoked.createdAt).toBe("2026-08-28T12:30:00.000Z");

    const passwordFlag = await store.markPasswordChanged(workspaceId, "member-user-2", false);
    expect(passwordFlag.createdAt).toBe("2026-08-28T12:30:00.000Z");
  });
});
