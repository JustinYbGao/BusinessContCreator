import type { InternalMemberIdentity, MemberLookupPort } from "../auth";
import { createSupabaseServiceRoleClient } from "./server";

interface WorkspaceMemberRow {
  workspace_id: string;
  user_id: string;
  email: string;
  role: InternalMemberIdentity["role"];
  status: InternalMemberIdentity["status"];
  must_change_password: boolean;
}

export function createServerMemberLookupPort(): MemberLookupPort {
  const supabase = createSupabaseServiceRoleClient();

  return {
    async getByUserId(workspaceId, userId) {
      const { data, error } = await supabase
        .from("workspace_members")
        .select("workspace_id,user_id,email,role,status,must_change_password")
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        throw error;
      }
      if (!data) {
        return null;
      }

      const row = data as WorkspaceMemberRow;
      return {
        workspaceId: row.workspace_id,
        userId: row.user_id,
        email: row.email,
        role: row.role,
        status: row.status,
        mustChangePassword: row.must_change_password,
      };
    },
  };
}
