import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type EnvLike = {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
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

export function createUserClient(env: EnvLike, bearerToken: string): SupabaseClient {
  return createClient(getEnvValue(env, "SUPABASE_URL"), getEnvValue(env, "SUPABASE_ANON_KEY"), {
    global: {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
