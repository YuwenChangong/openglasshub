import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Create a Supabase client for SSR pages using Cloudflare runtime env vars.
 * Uses anon key only — relies on RLS for access control.
 * Does NOT use service role key for public browsing.
 */
export function createSSRClient(env: {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/** Shape of Cloudflare runtime env bindings. */
export interface CloudflareEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}
