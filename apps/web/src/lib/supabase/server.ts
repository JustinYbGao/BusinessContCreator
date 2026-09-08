import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  requireInternalWorkspace,
  type WorkspaceLookupPort,
} from "../workspace-context";

function requiredServerEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_NOT_CONFIGURED`);
  return value;
}

export function createSupabaseServiceRoleClient(): SupabaseClient {
  return createClient(
    requiredServerEnv("SOCIAL_AGENT_SUPABASE_URL"),
    requiredServerEnv("SOCIAL_AGENT_SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export function createWorkspaceLookupPort(): WorkspaceLookupPort {
  const supabase = createSupabaseServiceRoleClient();

  return {
    async exists(workspaceId) {
      const { data, error } = await supabase
        .from("workspaces")
        .select("id")
        .eq("id", workspaceId)
        .maybeSingle();
      return !error && Boolean(data);
    },
  };
}

export function requireServerInternalWorkspace() {
  return requireInternalWorkspace(createWorkspaceLookupPort());
}
