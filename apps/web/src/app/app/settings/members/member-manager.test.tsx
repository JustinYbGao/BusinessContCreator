import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import MemberManager, {
  buildBootstrapOwnerRow,
  deriveMemberCapabilities,
  formatMemberCreatedAt,
  type MemberManagerMember,
} from "./member-manager.js";

vi.mock("../../../../components/console-ui", () => ({
  IconMark: () => null,
  StatusPill: ({ label }: { label: string }) => createElement("span", null, label),
}));

const workspaceId = "00000000-0000-4000-8000-000000000001";

function createIdentity(overrides = {}) {
  return {
    userId: "00000000-0000-4000-8000-000000000099",
    email: "owner@example.com",
    workspaceId,
    role: "owner" as const,
    status: "active" as const,
    mustChangePassword: false,
    ...overrides,
  };
}

function createMember(overrides: Partial<MemberManagerMember> = {}): MemberManagerMember {
  return {
    id: "member-row-1",
    userId: "member-user-1",
    email: "member@example.com",
    displayName: "Member Example",
    role: "member",
    status: "active",
    mustChangePassword: true,
    createdAt: "2026-08-28T12:00:00.000Z",
    revokedAt: null,
    synthetic: false,
    ...overrides,
  };
}

describe("member manager helpers", () => {
  it("builds a synthetic owner row when bootstrap has no persisted row", () => {
    expect(buildBootstrapOwnerRow(createIdentity())).toEqual({
      id: "bootstrap-owner",
      userId: "00000000-0000-4000-8000-000000000099",
      email: "owner@example.com",
      displayName: null,
      role: "owner",
      status: "active",
      mustChangePassword: false,
      createdAt: null,
      revokedAt: null,
      synthetic: true,
    });
  });

  it("locks down admin capability controls for admin actors", () => {
    expect(deriveMemberCapabilities("owner", createMember({ role: "admin" }))).toEqual({
      canChangeRole: true,
      canChangeStatus: true,
      canResetPassword: true,
    });

    expect(deriveMemberCapabilities("admin", createMember({ role: "admin" }))).toEqual({
      canChangeRole: false,
      canChangeStatus: false,
      canResetPassword: false,
    });

    expect(deriveMemberCapabilities("admin", createMember())).toEqual({
      canChangeRole: false,
      canChangeStatus: true,
      canResetPassword: true,
    });
  });

  it("formats created time in the console timezone", () => {
    expect(formatMemberCreatedAt("2026-08-28T12:00:00.000Z")).toContain("2026");
  });
});

describe("MemberManager", () => {
  it("renders accessible labels and one-time password guidance", () => {
    const markup = renderToStaticMarkup(
      createElement(MemberManager, {
        currentIdentity: createIdentity(),
        initialMembers: [createMember()],
      }),
    );

    expect(markup).toContain("邮箱");
    expect(markup).toContain("显示名");
    expect(markup).toContain("角色");
    expect(markup).toContain("临时密码");
    expect(markup).toContain("确认密码");
    expect(markup).toContain('role="status"');
    expect(markup).toContain("提交后控制台不会保存或再次显示");
    expect(markup).toContain("创建时间");
    expect(markup).toContain("重置密码");
  });

  it("hides admin-only role creation controls for admin actors", () => {
    const markup = renderToStaticMarkup(
      createElement(MemberManager, {
        currentIdentity: createIdentity({ role: "admin" }),
        initialMembers: [
          createMember(),
          createMember({ id: "member-row-2", userId: "admin-user", email: "admin@example.com", role: "admin" }),
        ],
      }),
    );

    expect(markup).toContain('value="member"');
    expect(markup).not.toContain('value="admin"');
    expect(markup).not.toContain("提升为管理员");
    expect(markup).not.toContain("降为成员");
  });
});
