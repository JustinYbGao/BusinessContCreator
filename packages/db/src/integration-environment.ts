export type IntegrationEnvironment = {
  url: string;
  serviceRoleKey: string;
  anonKey: string;
};

export function requireIntegrationEnvironment(env: NodeJS.ProcessEnv): IntegrationEnvironment {
  const url = requireValue(env, "SOCIAL_AGENT_SUPABASE_URL");
  const serviceRoleKey = requireValue(env, "SOCIAL_AGENT_SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = requireValue(env, "SOCIAL_AGENT_SUPABASE_ANON_KEY");

  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".supabase.co")) {
    throw new Error("SOCIAL_AGENT_SUPABASE_URL must be an HTTPS Supabase Cloud URL");
  }

  return { url, serviceRoleKey, anonKey };
}

function requireValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
