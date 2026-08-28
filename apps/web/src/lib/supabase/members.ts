import type { InternalMemberIdentity, MemberLookupPort } from "../auth";
import type { MemberRecord, MemberStore, AuthAdminPort, AuditPort } from "../members";
import { MemberService, MemberServiceError } from "../members";
import { createSupabaseServiceRoleClient } from "./server";

interface WorkspaceMemberRow {
  id: string;
  workspace_id: string;
  user_id: string;
  email: string;
  role: InternalMemberIdentity["role"];
  status: InternalMemberIdentity["status"];
  must_change_password: boolean;
  created_at: string;
  display_name: string | null;
  created_by: string | null;
  revoked_at: string | null;
}

const WORKSPACE_MEMBER_COLUMNS = "id,workspace_id,user_id,email,display_name,role,status,must_change_password,created_at,created_by,revoked_at";

export function createServerMemberLookupPort(): MemberLookupPort {
  const store = createServerMemberStore();

  return {
    async getByUserId(workspaceId, userId) {
      const row = await store.find(workspaceId, { userId });
      if (!row) return null;
      return {
        workspaceId: row.workspaceId,
        userId: row.userId,
        email: row.email,
        role: row.role,
        status: row.status,
        mustChangePassword: row.mustChangePassword,
      };
    },
  };
}

export function createServerMemberService(actor: InternalMemberIdentity): MemberService {
  const supabase = createSupabaseServiceRoleClient();

  return new MemberService({
    actor,
    store: createServerMemberStore(supabase),
    authAdmin: createServerAuthAdminPort(supabase),
    audit: createServerAuditPort(supabase),
  });
}

const AUTH_ADMIN_LIST_USERS_PER_PAGE = 1000;

export function createServerMemberStore(supabase = createSupabaseServiceRoleClient()): MemberStore {
  return {
    async list(workspaceId) {
      const { data, error } = await supabase
        .from("workspace_members")
        .select(WORKSPACE_MEMBER_COLUMNS)
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true });

      if (error) throw new MemberServiceError("MEMBERS_UNAVAILABLE");
      return (data ?? []).map((row) => mapWorkspaceMember(row as WorkspaceMemberRow));
    },

    async find(workspaceId, lookup) {
      if (!lookup.userId && !lookup.email) return null;

      let query = supabase
        .from("workspace_members")
        .select(WORKSPACE_MEMBER_COLUMNS)
        .eq("workspace_id", workspaceId);

      if (lookup.userId) query = query.eq("user_id", lookup.userId);
      if (lookup.email) query = query.eq("email", lookup.email);

      const { data, error } = await query.maybeSingle();
      if (error) throw new MemberServiceError("MEMBERS_UNAVAILABLE");
      return data ? mapWorkspaceMember(data as WorkspaceMemberRow) : null;
    },

    async insert(input) {
      const { data, error } = await supabase
        .from("workspace_members")
        .insert({
          workspace_id: input.workspaceId,
          user_id: input.userId,
          email: input.email,
          display_name: input.displayName,
          role: input.role,
          status: input.status,
          must_change_password: input.mustChangePassword,
          created_by: input.createdBy,
          revoked_at: input.revokedAt,
        })
        .select(WORKSPACE_MEMBER_COLUMNS)
        .single();

      if (error) throw new MemberServiceError("MEMBER_CREATE_FAILED");
      return mapWorkspaceMember(data as WorkspaceMemberRow);
    },

    async updateRole(workspaceId, userId, role) {
      const { data, error } = await supabase
        .from("workspace_members")
        .update({ role })
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId)
        .select(WORKSPACE_MEMBER_COLUMNS)
        .single();

      if (error) throw new MemberServiceError("MEMBER_ROLE_CHANGE_FAILED");
      return mapWorkspaceMember(data as WorkspaceMemberRow);
    },

    async updateStatus(workspaceId, userId, status) {
      const { data, error } = await supabase
        .from("workspace_members")
        .update({ status, revoked_at: status === "revoked" ? new Date().toISOString() : null })
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId)
        .select(WORKSPACE_MEMBER_COLUMNS)
        .single();

      if (error) throw new MemberServiceError("MEMBER_STATUS_CHANGE_FAILED");
      return mapWorkspaceMember(data as WorkspaceMemberRow);
    },

    async markPasswordChanged(workspaceId, userId, mustChangePassword) {
      const { data, error } = await supabase
        .from("workspace_members")
        .update({ must_change_password: mustChangePassword })
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId)
        .select(WORKSPACE_MEMBER_COLUMNS)
        .single();

      if (error) throw new MemberServiceError("MEMBER_PASSWORD_RESET_FAILED");
      return mapWorkspaceMember(data as WorkspaceMemberRow);
    },
  };
}

export function createServerAuthAdminPort(supabase = createSupabaseServiceRoleClient()): AuthAdminPort {
  const adminApi = supabase.auth.admin as {
    listUsers(params?: { page?: number; perPage?: number }): Promise<{
      data?: { users?: Array<{ id: string; email?: string | null }> };
      error?: unknown;
    }>;
    createUser(input: { email: string; password: string; email_confirm: boolean }): Promise<{
      data?: { user?: { id: string; email?: string | null } | null };
      error?: unknown;
    }>;
    updateUserById(userId: string, input: { password: string }): Promise<{ error?: unknown }>;
    deleteUser(userId: string): Promise<{ error?: unknown }>;
  };

  return {
    async findUserByEmail(email) {
      let page = 1;
      while (true) {
        const { data, error } = await adminApi.listUsers({
          page,
          perPage: AUTH_ADMIN_LIST_USERS_PER_PAGE,
        });
        if (error) throw new MemberServiceError("AUTH_ADMIN_UNAVAILABLE");

        const users = data?.users ?? [];
        const user = users.find((candidate) => candidate.email?.toLowerCase() === email);
        if (user?.email) {
          return { userId: user.id, email: user.email.toLowerCase() };
        }

        if (users.length < AUTH_ADMIN_LIST_USERS_PER_PAGE) return null;
        page += 1;
      }
    },

    async createUser(input) {
      const { data, error } = await adminApi.createUser({
        email: input.email,
        password: input.password,
        email_confirm: input.emailConfirm,
      });
      if (error || !data?.user?.id || !data.user.email) throw new MemberServiceError("MEMBER_CREATE_FAILED");
      return { userId: data.user.id, email: data.user.email.toLowerCase() };
    },

    async updatePassword(userId, password) {
      const { error } = await adminApi.updateUserById(userId, { password });
      if (error) throw new MemberServiceError("MEMBER_PASSWORD_RESET_FAILED");
    },

    async deleteUser(userId) {
      const { error } = await adminApi.deleteUser(userId);
      if (error) throw new MemberServiceError("MEMBER_CREATE_FAILED");
    },
  };
}

function createServerAuditPort(supabase = createSupabaseServiceRoleClient()): AuditPort {
  return {
    async append(event) {
      const payload = {
        actor_type: event.actorType,
        actor_id: event.actorId,
        action: event.action,
        entity_type: event.entityType,
        entity_id: event.entityId,
        request_id: event.requestId ?? null,
        payload: event.payload,
      };

      const { error } = await supabase.rpc("append_audit_event", {
        p_workspace_id: event.workspaceId,
        p_event: payload,
      });
      if (error) throw new MemberServiceError("MEMBER_AUDIT_FAILED");
    },
  };
}

function mapWorkspaceMember(row: WorkspaceMemberRow): MemberRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    mustChangePassword: row.must_change_password,
    createdAt: row.created_at,
    createdBy: row.created_by,
    revokedAt: row.revoked_at,
  };
}
