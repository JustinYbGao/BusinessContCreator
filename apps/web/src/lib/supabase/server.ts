import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import {
  requireInternalAdmin,
  type AuthPort,
  type WorkspaceLookupPort,
} from "../auth";

function requiredServerEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_NOT_CONFIGURED`);
  return value;
}

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    requiredServerEnv("SOCIAL_AGENT_SUPABASE_URL"),
    requiredServerEnv("SOCIAL_AGENT_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server Components cannot write cookies; the proxy refreshes them.
          }
        },
      },
    },
  );
}

export function createSupabaseServiceRoleClient(): SupabaseClient {
  return createClient(
    requiredServerEnv("SOCIAL_AGENT_SUPABASE_URL"),
    requiredServerEnv("SOCIAL_AGENT_SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function createServerAuthPort(): Promise<AuthPort> {
  const supabase = await createSupabaseServerClient();

  return {
    async getUser() {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) return null;
      return { id: data.user.id, email: data.user.email ?? null };
    },
  };
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

export async function requireServerInternalAdmin() {
  return requireInternalAdmin(
    await createServerAuthPort(),
    createWorkspaceLookupPort(),
  );
}
