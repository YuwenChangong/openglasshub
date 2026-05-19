import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type EnvLike = {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

export function getEnvValue(env: EnvLike, key: keyof EnvLike): string {
  const value = env[key] ?? "";
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

export function createAnonClient(env: EnvLike): SupabaseClient {
  return createClient(getEnvValue(env, "SUPABASE_URL"), getEnvValue(env, "SUPABASE_ANON_KEY"));
}

export function createServiceClient(env: EnvLike): SupabaseClient {
  return createClient(
    getEnvValue(env, "SUPABASE_URL"),
    getEnvValue(env, "SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
