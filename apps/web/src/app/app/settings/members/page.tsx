import Link from "next/link";
import { type InternalMemberIdentity } from "../../../../lib/auth";
import type { MemberRecord } from "../../../../lib/members";
import { createServerMemberService } from "../../../../lib/supabase/members";
import { requireServerMemberAdmin } from "../../../../lib/supabase/server";
import MemberManager, { type MemberManagerMember } from "./member-manager";

export const dynamic = "force-dynamic";

function buildBootstrapOwnerRow(identity: Pick<InternalMemberIdentity, "userId" | "email">): MemberManagerMember {
  return {
    id: "bootstrap-owner",
    userId: identity.userId,
    email: identity.email,
    displayName: null,
    role: "owner",
    status: "active",
    mustChangePassword: false,
    createdAt: null,
    revokedAt: null,
    synthetic: true,
  };
}

function toDisplayMember(member: MemberRecord): MemberManagerMember {
  return {
    id: member.id,
    userId: member.userId,
    email: member.email,
    displayName: member.displayName,
    role: member.role,
    status: member.status,
    mustChangePassword: member.mustChangePassword,
    createdAt: member.createdAt,
    revokedAt: member.revokedAt,
    synthetic: false,
  };
}

export default async function MembersSettingsPage() {
  const identity = await requireServerMemberAdmin();
  const service = createServerMemberService(identity);
  const members = await service.list();
  const hasOwner = members.some((member) => member.role === "owner");
  const displayMembers: MemberManagerMember[] = hasOwner
    ? members.map(toDisplayMember)
    : [buildBootstrapOwnerRow(identity), ...members.map(toDisplayMember)];

  return (
    <main className="member-page">
      <div className="page-heading page-heading--compact">
        <div>
          <p className="eyebrow">成员管理</p>
          <h1>工作区成员</h1>
          <p>这里管理 allowlist 引导的工作区成员。创建成员前请把临时密码交给成员，提交后控制台不会保存或再次显示。</p>
        </div>
        <div className="page-heading-action">
          <Link className="text-link" href="/app">返回工作台</Link>
        </div>
      </div>

      <section className="surface surface-padded">
        <MemberManager currentIdentity={identity} initialMembers={displayMembers} />
      </section>
    </main>
  );
}
