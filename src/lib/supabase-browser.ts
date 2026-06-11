import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;
const REALTIME_AUTH_RETRY_DELAY_MS = 180;
const REALTIME_AUTH_MAX_ATTEMPTS = 4;

export function createBrowserSupabaseClient(): SupabaseClient | null {
  const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  if (!browserClient) {
    browserClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }

  return browserClient;
}

export async function syncBrowserRealtimeAuth(supabase: SupabaseClient | null): Promise<string | null> {
  if (!supabase) return null;

  let accessToken: string | null = null;

  for (let attempt = 0; attempt < REALTIME_AUTH_MAX_ATTEMPTS; attempt += 1) {
    const { data } = await supabase.auth.getSession();
    accessToken = data.session?.access_token ?? null;
    if (accessToken) break;
    if (attempt < REALTIME_AUTH_MAX_ATTEMPTS - 1) {
      await new Promise((resolve) => window.setTimeout(resolve, REALTIME_AUTH_RETRY_DELAY_MS));
    }
  }

  if (!accessToken) {
    if (import.meta.env.DEV) {
      console.debug("[realtime] auth token unavailable");
    }
    return null;
  }

  await Promise.resolve(supabase.realtime.setAuth(accessToken));
  return accessToken;
}
