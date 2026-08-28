import type { InternalMemberIdentity, InternalMemberRole, InternalMemberStatus } from "./auth.js";
import {
  parseMemberCreateInput,
  parseMemberPasswordResetInput,
  parseMemberRoleChangeInput,
  parseMemberStatusChangeInput,
  type MemberCreateInput,
  type MemberPasswordResetInput,
  type MemberRoleChangeInput,
  type MemberStatusChangeInput,
} from "./member-inputs.js";

type ManagedMemberRole = Exclude<InternalMemberRole, "owner">;

export interface MemberRecord {
  id: string;
  workspaceId: string;
  userId: string;
  email: string;
  displayName: string | null;
  role: InternalMemberRole;
  status: InternalMemberStatus;
  mustChangePassword: boolean;
  createdBy: string | null;
  revokedAt: string | null;
}

export interface MemberStore {
  list(workspaceId: string): Promise<MemberRecord[]>;
  find(workspaceId: string, lookup: { userId?: string; email?: string }): Promise<MemberRecord | null>;
  insert(input: Omit<MemberRecord, "id">): Promise<MemberRecord>;
  updateRole(workspaceId: string, userId: string, role: ManagedMemberRole): Promise<MemberRecord>;
  updateStatus(workspaceId: string, userId: string, status: InternalMemberStatus): Promise<MemberRecord>;
  markPasswordChanged(workspaceId: string, userId: string, mustChangePassword: boolean): Promise<MemberRecord>;
}

export interface AuthAdminPort {
  findUserByEmail(email: string): Promise<{ userId: string; email: string } | null>;
  createUser(input: { email: string; password: string; emailConfirm: boolean }): Promise<{ userId: string; email: string }>;
  updatePassword(userId: string, password: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
}

export interface MemberAuditEvent {
  workspaceId: string;
  actorId: string;
  actorType: "user";
  action: "workspace_member.created" | "workspace_member.role_changed" | "workspace_member.status_changed" | "workspace_member.password_reset";
  entityType: "workspace_member";
  entityId: string;
  requestId?: string | null;
  payload: Record<string, string | boolean | null>;
}

export interface AuditPort {
  append(event: MemberAuditEvent): Promise<void>;
}

export class MemberServiceError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "MemberServiceError";
  }
}

export interface MemberServiceDependencies {
  actor: InternalMemberIdentity;
  store: MemberStore;
  authAdmin: AuthAdminPort;
  audit: AuditPort;
}

export class MemberService {
  constructor(private readonly deps: MemberServiceDependencies) {}

  async list(): Promise<MemberRecord[]> {
    return this.deps.store.list(this.deps.actor.workspaceId);
  }

  async createMember(input: unknown): Promise<MemberRecord> {
    const parsed = parseMemberCreateInput(input);
    this.requireActorIsAdmin();
    if (parsed.role === "admin" && this.deps.actor.role !== "owner") {
      throw new MemberServiceError("OWNER_REQUIRED");
    }

    const existingAuthUser = await this.findAuthUser(parsed.email);
    const existingMember = await this.findExistingMember(parsed.email, existingAuthUser?.userId);
    if (existingMember) {
      if (existingMember.status === "revoked") throw new MemberServiceError("MEMBER_REVOKED");
      throw new MemberServiceError("MEMBER_ALREADY_EXISTS");
    }

    let authUser = existingAuthUser;
    let createdUserId: string | null = null;
    if (authUser) {
      await this.updatePassword(authUser.userId, parsed.password);
    } else {
      authUser = await this.createAuthUser(parsed);
      createdUserId = authUser.userId;
    }

    let member: MemberRecord;
    try {
      member = await this.deps.store.insert({
        workspaceId: this.deps.actor.workspaceId,
        userId: authUser.userId,
        email: parsed.email,
        displayName: parsed.displayName,
        role: parsed.role,
        status: "active",
        mustChangePassword: true,
        createdBy: this.deps.actor.userId,
        revokedAt: null,
      });
    } catch {
      if (createdUserId) {
        try {
          await this.deps.authAdmin.deleteUser(createdUserId);
        } catch {
          // Preserve the generic create failure; cleanup is best-effort.
        }
      }
      throw new MemberServiceError("MEMBER_CREATE_FAILED");
    }

    await this.appendAudit({
      action: "workspace_member.created",
      entityId: member.userId,
      payload: {
        role: member.role,
        status: member.status,
        mustChangePassword: member.mustChangePassword,
      },
    });

    return member;
  }

  async changeRole(userId: string, input: unknown): Promise<MemberRecord> {
    const parsed = parseMemberRoleChangeInput(input);
    this.requireActorIsAdmin();
    const current = await this.requireTargetMember(userId);
    this.requireTargetManageable(current, parsed.role);

    try {
      const member = await this.deps.store.updateRole(this.deps.actor.workspaceId, userId, parsed.role);
      await this.appendAudit({
        action: "workspace_member.role_changed",
        entityId: member.userId,
        payload: {
          previousRole: current.role,
          role: member.role,
        },
      });
      return member;
    } catch (error) {
      this.rethrowMemberError(error, "MEMBER_ROLE_CHANGE_FAILED");
    }
  }

  async changeStatus(userId: string, input: unknown): Promise<MemberRecord> {
    const parsed = parseMemberStatusChangeInput(input);
    this.requireActorIsAdmin();
    const current = await this.requireTargetMember(userId);
    this.requireTargetManageable(current);

    try {
      const member = await this.deps.store.updateStatus(this.deps.actor.workspaceId, userId, parsed.status);
      await this.appendAudit({
        action: "workspace_member.status_changed",
        entityId: member.userId,
        payload: {
          previousStatus: current.status,
          status: member.status,
        },
      });
      return member;
    } catch (error) {
      this.rethrowMemberError(error, "MEMBER_STATUS_CHANGE_FAILED");
    }
  }

  async resetPassword(userId: string, input: unknown): Promise<MemberRecord> {
    const parsed = parseMemberPasswordResetInput(input);
    this.requireActorIsAdmin();
    const current = await this.requireTargetMember(userId);
    this.requireTargetManageable(current);

    try {
      await this.updatePassword(userId, parsed.password);
      const member = await this.deps.store.markPasswordChanged(this.deps.actor.workspaceId, userId, true);
      await this.appendAudit({
        action: "workspace_member.password_reset",
        entityId: member.userId,
        payload: {
          mustChangePassword: member.mustChangePassword,
        },
      });
      return member;
    } catch (error) {
      this.rethrowMemberError(error, "MEMBER_PASSWORD_RESET_FAILED");
    }
  }

  private requireActorIsAdmin() {
    if (this.deps.actor.role === "member") throw new MemberServiceError("ADMIN_REQUIRED");
  }

  private async requireTargetMember(userId: string): Promise<MemberRecord> {
    const member = await this.deps.store.find(this.deps.actor.workspaceId, { userId });
    if (!member) throw new MemberServiceError("MEMBER_NOT_FOUND");
    return member;
  }

  private requireTargetManageable(target: MemberRecord, nextRole?: MemberRoleChangeInput["role"]) {
    if (target.role === "owner") throw new MemberServiceError("OWNER_PROTECTED");
    if (this.deps.actor.role === "owner") return;
    if (target.role !== "member") throw new MemberServiceError("OWNER_REQUIRED");
    if (nextRole === "admin") throw new MemberServiceError("OWNER_REQUIRED");
  }

  private async findExistingMember(email: string, userId?: string): Promise<MemberRecord | null> {
    const byEmail = await this.deps.store.find(this.deps.actor.workspaceId, { email });
    if (byEmail) return byEmail;
    if (!userId) return null;
    return this.deps.store.find(this.deps.actor.workspaceId, { userId });
  }

  private async findAuthUser(email: string): Promise<{ userId: string; email: string } | null> {
    try {
      return await this.deps.authAdmin.findUserByEmail(email);
    } catch {
      throw new MemberServiceError("AUTH_ADMIN_UNAVAILABLE");
    }
  }

  private async createAuthUser(input: MemberCreateInput): Promise<{ userId: string; email: string }> {
    try {
      return await this.deps.authAdmin.createUser({
        email: input.email,
        password: input.password,
        emailConfirm: true,
      });
    } catch {
      throw new MemberServiceError("MEMBER_CREATE_FAILED");
    }
  }

  private async updatePassword(userId: string, password: MemberCreateInput["password"] | MemberPasswordResetInput["password"]) {
    try {
      await this.deps.authAdmin.updatePassword(userId, password);
    } catch {
      throw new MemberServiceError("MEMBER_PASSWORD_RESET_FAILED");
    }
  }

  private async appendAudit(input: {
    action: MemberAuditEvent["action"];
    entityId: string;
    payload: MemberAuditEvent["payload"];
  }) {
    try {
      await this.deps.audit.append({
        workspaceId: this.deps.actor.workspaceId,
        actorId: this.deps.actor.userId,
        actorType: "user",
        action: input.action,
        entityType: "workspace_member",
        entityId: input.entityId,
        payload: input.payload,
      });
    } catch {
      throw new MemberServiceError("MEMBER_AUDIT_FAILED");
    }
  }

  private rethrowMemberError(error: unknown, fallbackCode: string): never {
    if (error instanceof MemberServiceError) throw error;
    throw new MemberServiceError(fallbackCode);
  }
}
