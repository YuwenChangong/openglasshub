import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

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

  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token ?? null;
  if (!accessToken) return null;

  await Promise.resolve(supabase.realtime.setAuth(accessToken));
  return accessToken;
}
