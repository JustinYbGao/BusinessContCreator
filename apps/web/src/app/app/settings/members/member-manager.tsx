"use client";

import { Fragment, useState, type FormEvent } from "react";
import type { InternalMemberIdentity, InternalMemberRole, InternalMemberStatus } from "../../../../lib/auth";
import { IconMark, StatusPill } from "../../../../components/console-ui";

export interface MemberManagerMember {
  id: string;
  userId: string;
  email: string;
  displayName: string | null;
  role: InternalMemberRole;
  status: InternalMemberStatus;
  mustChangePassword: boolean;
  createdAt: string | null;
  revokedAt: string | null;
  synthetic: boolean;
}

type MemberApiMember = Omit<MemberManagerMember, "synthetic">;

interface MemberApiResponse {
  member?: MemberApiMember;
  error?: string;
}

type FeedbackState =
  | { tone: "status"; message: string }
  | { tone: "alert"; message: string };

export function buildBootstrapOwnerRow(identity: Pick<InternalMemberIdentity, "userId" | "email">): MemberManagerMember {
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

export function deriveMemberCapabilities(actorRole: InternalMemberRole, member: MemberManagerMember) {
  const isOwner = member.role === "owner";
  const canManageMembers = !isOwner && (actorRole === "owner" || member.role === "member");

  return {
    canChangeRole: actorRole === "owner" && !isOwner,
    canChangeStatus: canManageMembers,
    canResetPassword: canManageMembers,
  };
}

export function formatMemberCreatedAt(createdAt: string | null) {
  if (!createdAt) return "待写入";

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(createdAt));
}

function roleLabel(role: InternalMemberRole) {
  if (role === "owner") return "所有者";
  if (role === "admin") return "管理员";
  return "成员";
}

function statusLabel(status: InternalMemberStatus) {
  return status === "active" ? "活跃" : "已撤销";
}

function statusTone(status: InternalMemberStatus) {
  return status === "active" ? "healthy" : "danger";
}

function passwordTone(mustChangePassword: boolean) {
  return mustChangePassword ? "attention" : "healthy";
}

function nextRoleLabel(role: InternalMemberRole) {
  return role === "admin" ? "降为成员" : "提升为管理员";
}

function nextStatusLabel(status: InternalMemberStatus) {
  return status === "active" ? "撤销" : "恢复";
}

function initialFeedback() {
  return { tone: "status", message: "请在提交前把临时密码交给成员；提交后控制台不会保存或再次显示。" } as const;
}

function replaceByUserId(current: MemberManagerMember[], next: MemberManagerMember) {
  const index = current.findIndex((member) => member.userId === next.userId);
  if (index === -1) return [next, ...current];

  const copy = current.slice();
  copy[index] = next;
  return copy;
}

function toMemberManagerMember(member: MemberApiMember): MemberManagerMember {
  return { ...member, synthetic: false };
}

export default function MemberManager({
  currentIdentity,
  initialMembers,
}: {
  currentIdentity: InternalMemberIdentity;
  initialMembers: MemberManagerMember[];
}) {
  const [members, setMembers] = useState(initialMembers);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Exclude<InternalMemberRole, "owner">>("member");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [confirmTemporaryPassword, setConfirmTemporaryPassword] = useState("");
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetTemporaryPassword, setResetTemporaryPassword] = useState("");
  const [resetConfirmTemporaryPassword, setResetConfirmTemporaryPassword] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(initialFeedback());

  function setSuccess(message: string) {
    setFeedback({ tone: "status", message });
  }

  function setError(message: string) {
    setFeedback({ tone: "alert", message });
  }

  async function submitCreateMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!temporaryPassword || temporaryPassword !== confirmTemporaryPassword) {
      setTemporaryPassword("");
      setConfirmTemporaryPassword("");
      setError("临时密码两次输入不一致，请重新填写。");
      return;
    }

    const payload = {
      email,
      displayName: displayName || undefined,
      role: currentIdentity.role === "owner" ? role : "member",
      temporaryPassword,
    };

    setBusyAction("create");
    setTemporaryPassword("");
    setConfirmTemporaryPassword("");

    try {
      const response = await fetch("/api/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json() as MemberApiResponse;
      if (!response.ok || !body.member) throw new Error(body.error ?? "MEMBER_CREATE_FAILED");

      setMembers((current) => replaceByUserId(current, toMemberManagerMember(body.member!)));
      setEmail("");
      setDisplayName("");
      setRole("member");
      setSuccess("成员已创建；临时密码提交后不会由控制台保存或再次显示。");
    } catch {
      setError("成员创建失败，请稍后重试。");
    } finally {
      setBusyAction(null);
    }
  }

  async function changeMemberRole(member: MemberManagerMember) {
    if (!deriveMemberCapabilities(currentIdentity.role, member).canChangeRole) return;
    const nextRole: Exclude<InternalMemberRole, "owner"> = member.role === "admin" ? "member" : "admin";
    setBusyAction(`role:${member.userId}`);
    try {
      const response = await fetch(`/api/members/${encodeURIComponent(member.userId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });
      const body = await response.json() as MemberApiResponse;
      if (!response.ok || !body.member) throw new Error(body.error ?? "MEMBER_ROLE_CHANGE_FAILED");

      setMembers((current) => replaceByUserId(current, toMemberManagerMember(body.member!)));
      setSuccess(`成员 ${member.email} 的角色已更新。`);
    } catch {
      setError("成员角色更新失败，请稍后重试。");
    } finally {
      setBusyAction(null);
    }
  }

  async function changeMemberStatus(member: MemberManagerMember) {
    if (!deriveMemberCapabilities(currentIdentity.role, member).canChangeStatus) return;
    const nextStatus: InternalMemberStatus = member.status === "active" ? "revoked" : "active";
    setBusyAction(`status:${member.userId}`);
    try {
      const response = await fetch(`/api/members/${encodeURIComponent(member.userId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const body = await response.json() as MemberApiResponse;
      if (!response.ok || !body.member) throw new Error(body.error ?? "MEMBER_STATUS_CHANGE_FAILED");

      setMembers((current) => replaceByUserId(current, toMemberManagerMember(body.member!)));
      setSuccess(`成员 ${member.email} 的状态已更新。`);
    } catch {
      setError("成员状态更新失败，请稍后重试。");
    } finally {
      setBusyAction(null);
    }
  }

  function openResetForm(member: MemberManagerMember) {
    if (!deriveMemberCapabilities(currentIdentity.role, member).canResetPassword) return;
    setResetUserId(member.userId);
    setResetTemporaryPassword("");
    setResetConfirmTemporaryPassword("");
    setFeedback(initialFeedback());
  }

  async function submitResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetUserId) return;
    if (!resetTemporaryPassword || resetTemporaryPassword !== resetConfirmTemporaryPassword) {
      setResetTemporaryPassword("");
      setResetConfirmTemporaryPassword("");
      setError("临时密码两次输入不一致，请重新填写。");
      return;
    }

    const member = members.find((candidate) => candidate.userId === resetUserId);
    if (!member) return;

    setBusyAction(`reset:${resetUserId}`);
    const temporaryPasswordToSend = resetTemporaryPassword;
    setResetTemporaryPassword("");
    setResetConfirmTemporaryPassword("");

    try {
      const response = await fetch(`/api/members/${encodeURIComponent(resetUserId)}/password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ temporaryPassword: temporaryPasswordToSend }),
      });
      const body = await response.json() as MemberApiResponse;
      if (!response.ok || !body.member) throw new Error(body.error ?? "MEMBER_PASSWORD_RESET_FAILED");

      setMembers((current) => replaceByUserId(current, toMemberManagerMember(body.member!)));
      setResetUserId(null);
      setSuccess(`成员 ${member.email} 的临时密码已重置。`);
    } catch {
      setError("成员密码重置失败，请稍后重试。");
    } finally {
      setBusyAction(null);
    }
  }

  function memberNote(member: MemberManagerMember) {
    if (member.synthetic) return "允许列表引导的所有者";
    return member.displayName ?? "未设置名称";
  }

  const createRoleOptions = currentIdentity.role === "owner"
    ? [{ value: "member", label: "成员" }, { value: "admin", label: "管理员" }]
    : [{ value: "member", label: "成员" }];

  return (
    <section className="member-manager member-page">
      <div className="surface-card member-form">
        <div className="section-heading">
          <div>
            <p className="eyebrow">新增成员</p>
            <h2>邀请或补录成员</h2>
            <p className="member-password-note">请在提交前把临时密码交给成员；提交后控制台不会保存或再次显示。</p>
          </div>
        </div>

        <form className="editor-form" onSubmit={submitCreateMember}>
          <div className="editor-input-grid member-form-grid">
            <label className="editor-field" htmlFor="member-email">
              <span>邮箱</span>
              <input
                autoComplete="email"
                className="editor-input"
                disabled={busyAction !== null}
                id="member-email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </label>

            <label className="editor-field" htmlFor="member-display-name">
              <span>显示名（可选）</span>
              <input
                autoComplete="name"
                className="editor-input"
                disabled={busyAction !== null}
                id="member-display-name"
                onChange={(event) => setDisplayName(event.target.value)}
                type="text"
                value={displayName}
              />
            </label>
          </div>

          <div className="editor-input-grid member-form-grid">
            <label className="editor-field" htmlFor="member-role">
              <span>角色</span>
              <select
                className="editor-input"
                disabled={busyAction !== null}
                id="member-role"
                onChange={(event) => setRole(event.target.value as Exclude<InternalMemberRole, "owner">)}
                value={role}
              >
                {createRoleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="editor-field" htmlFor="member-password">
              <span>临时密码</span>
              <input
                autoComplete="new-password"
                className="editor-input"
                disabled={busyAction !== null}
                id="member-password"
                minLength={12}
                onChange={(event) => setTemporaryPassword(event.target.value)}
                required
                type="password"
                value={temporaryPassword}
              />
            </label>
          </div>

          <label className="editor-field" htmlFor="member-password-confirm">
            <span>确认密码</span>
            <input
              autoComplete="new-password"
              className="editor-input"
              disabled={busyAction !== null}
              id="member-password-confirm"
              minLength={12}
              onChange={(event) => setConfirmTemporaryPassword(event.target.value)}
              required
              type="password"
              value={confirmTemporaryPassword}
            />
          </label>

          {currentIdentity.role !== "owner" ? (
            <p className="form-message">当前身份只能创建普通成员，不能创建管理员。</p>
          ) : null}

          <div className="page-actions">
            <button className="button button-primary" disabled={busyAction !== null} type="submit">
              {busyAction === "create" ? "创建中…" : "创建成员"}
              <IconMark name="arrow" size={16} />
            </button>
          </div>
        </form>

        {feedback.tone === "alert" ? (
          <p className="error-message member-feedback" role="alert">{feedback.message}</p>
        ) : (
          <p className="form-message member-feedback" aria-atomic="true" role="status">
            {feedback.message}
          </p>
        )}
      </div>

      <div className="surface-card surface-card--spaced">
        <div className="section-heading">
          <div>
            <p className="eyebrow">成员列表</p>
            <h2>工作区成员</h2>
            <p>邮箱、名称、角色、状态、创建时间和必须改密状态都在这里统一管理。</p>
          </div>
        </div>

        {members.length === 0 ? (
          <div className="empty-state">
            <p>当前没有成员可管理。</p>
          </div>
        ) : (
          <div className="dashboard-table-wrap member-list">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">成员</th>
                  <th scope="col">角色</th>
                  <th scope="col">状态</th>
                  <th scope="col">创建时间</th>
                  <th scope="col">必须改密</th>
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => {
                  const capabilities = deriveMemberCapabilities(currentIdentity.role, member);
                  const isResetOpen = resetUserId === member.userId;

                  return (
                    <Fragment key={member.id}>
                      <tr>
                        <td>
                          <strong className="table-content-title">{member.email}</strong>
                          <span className="table-content-subtitle member-meta">{memberNote(member)}</span>
                        </td>
                        <td>
                          <StatusPill label={roleLabel(member.role)} tone="quiet" />
                        </td>
                        <td>
                          <StatusPill label={statusLabel(member.status)} tone={statusTone(member.status)} />
                        </td>
                        <td>{formatMemberCreatedAt(member.createdAt)}</td>
                        <td>
                          <StatusPill
                            label={member.mustChangePassword ? "需要" : "已完成"}
                            tone={passwordTone(member.mustChangePassword)}
                          />
                        </td>
                        <td>
                          <div className="form-actions member-actions member-inline-actions">
                            {member.role === "owner" ? (
                              <StatusPill label="受保护" tone="quiet" />
                            ) : null}

                            {capabilities.canChangeRole ? (
                              <button
                                className="button button-secondary button-small"
                                disabled={busyAction !== null}
                                onClick={() => void changeMemberRole(member)}
                                type="button"
                              >
                                {busyAction === `role:${member.userId}` ? "处理中…" : nextRoleLabel(member.role)}
                              </button>
                            ) : null}

                            {capabilities.canChangeStatus ? (
                              <button
                                className="button button-danger button-small"
                                disabled={busyAction !== null}
                                onClick={() => void changeMemberStatus(member)}
                                type="button"
                              >
                                {busyAction === `status:${member.userId}` ? "处理中…" : nextStatusLabel(member.status)}
                              </button>
                            ) : null}

                            {capabilities.canResetPassword ? (
                              <button
                                className="button button-secondary button-small"
                                disabled={busyAction !== null}
                                onClick={() => openResetForm(member)}
                                type="button"
                              >
                                重置密码
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>

                      {isResetOpen ? (
                        <tr>
                          <td colSpan={6}>
                            <form className="card-divider editor-form" onSubmit={submitResetPassword}>
                              <div className="editor-input-grid">
                                <label className="editor-field" htmlFor={`reset-password-${member.userId}`}>
                                  <span>临时密码</span>
                                  <input
                                    autoComplete="new-password"
                                    className="editor-input"
                                    disabled={busyAction !== null}
                                    id={`reset-password-${member.userId}`}
                                    minLength={12}
                                    onChange={(event) => setResetTemporaryPassword(event.target.value)}
                                    required
                                    type="password"
                                    value={resetTemporaryPassword}
                                  />
                                </label>

                                <label className="editor-field" htmlFor={`reset-password-confirm-${member.userId}`}>
                                  <span>确认密码</span>
                                  <input
                                    autoComplete="new-password"
                                    className="editor-input"
                                    disabled={busyAction !== null}
                                    id={`reset-password-confirm-${member.userId}`}
                                    minLength={12}
                                    onChange={(event) => setResetConfirmTemporaryPassword(event.target.value)}
                                    required
                                    type="password"
                                    value={resetConfirmTemporaryPassword}
                                  />
                                </label>
                              </div>

                              <div className="page-actions">
                                <button className="button button-primary button-small" disabled={busyAction !== null} type="submit">
                                  {busyAction === `reset:${member.userId}` ? "保存中…" : "保存临时密码"}
                                  <IconMark name="arrow" size={15} />
                                </button>
                                <button
                                  className="button button-secondary button-small"
                                  disabled={busyAction !== null}
                                  onClick={() => {
                                    setResetUserId(null);
                                    setResetTemporaryPassword("");
                                    setResetConfirmTemporaryPassword("");
                                  }}
                                  type="button"
                                >
                                  取消
                                </button>
                              </div>
                            </form>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
