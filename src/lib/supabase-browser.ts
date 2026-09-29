import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createRecoveryEventBuffer } from "./recovery-event-buffer";

let browserClient: SupabaseClient | null = null;
const recoveryEvents = createRecoveryEventBuffer();
const REALTIME_AUTH_RETRY_DELAY_MS = 180;
const REALTIME_AUTH_MAX_ATTEMPTS = 4;
const REALTIME_AUTH_WAIT_TIMEOUT_MS = 3500;

export function createBrowserSupabaseClient(): SupabaseClient | null {
  const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  if (!browserClient) {
    const callbackUrl = typeof window === "undefined" ? null : new URL(window.location.href);
    const ownsCodeExchange = callbackUrl !== null
      && /^\/auth\/(?:callback|reset-password)\/?$/.test(callbackUrl.pathname)
      && callbackUrl.searchParams.has("code");
    browserClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // These components capture/scrub PKCE codes and perform the single exchange.
        detectSessionInUrl: !ownsCodeExchange,
      },
    });
    browserClient.auth.onAuthStateChange((event, session) => {
      if (typeof window === "undefined") return;
      recoveryEvents.observe(event, !!session, window.location.pathname);
    });
  }

  return browserClient;
}

export function consumeBrowserRecoveryEvent(): boolean {
  return recoveryEvents.consume(window.location.pathname);
}

export function invalidateBrowserRecoveryEvent(): void {
  recoveryEvents.invalidate();
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
    accessToken = await new Promise<string | null>((resolve) => {
      let timeoutId = 0;
      const authSubscription = supabase.auth.onAuthStateChange((_event, session) => {
        const token = session?.access_token ?? null;
        if (!token) return;
        window.clearTimeout(timeoutId);
        authSubscription.data.subscription.unsubscribe();
        resolve(token);
      });

      timeoutId = window.setTimeout(() => {
        authSubscription.data.subscription.unsubscribe();
        resolve(null);
      }, REALTIME_AUTH_WAIT_TIMEOUT_MS);
    });
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
