import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | undefined;

export function createSupabaseBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient;

  const url = process.env.NEXT_PUBLIC_SOCIAL_AGENT_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SOCIAL_AGENT_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("SOCIAL_AGENT_SUPABASE_PUBLIC_CONFIG_NOT_CONFIGURED");

  browserClient = createBrowserClient(url, anonKey);
  return browserClient;
}
