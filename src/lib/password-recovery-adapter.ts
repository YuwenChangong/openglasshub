import type { SupabaseClient } from "@supabase/supabase-js";
import { consumeBrowserRecoveryEvent } from "./supabase-browser";

export interface PasswordRecoveryAdapter {
  exchangeCode(code: string, flowId?: string): Promise<{ error: Error | null; redirectType: string | null }>;
  hasSession(): Promise<boolean>;
  onRecoverySession(callback: () => void): () => void;
  updatePassword(password: string): Promise<{ error: Error | null }>;
}

export function createPasswordRecoveryAdapter(client: SupabaseClient, consumeRecoveryEvent = consumeBrowserRecoveryEvent): PasswordRecoveryAdapter {
  return {
    exchangeCode: async (code, flowId) => {
      const { data, error } = await client.auth.exchangeCodeForSession(code, flowId === undefined ? undefined : { flowId });
      const redirectType = (data as { redirectType?: unknown } | null)?.redirectType;
      return { error, redirectType: typeof redirectType === "string" ? redirectType : null };
    },
    hasSession: async () => {
      const { data, error } = await client.auth.getSession();
      return !error && !!data.session;
    },
    onRecoverySession: (callback) => {
      let active = true;
      const { data } = client.auth.onAuthStateChange((event, session) => {
        if (event === "PASSWORD_RECOVERY" && session && active) {
          consumeRecoveryEvent();
          callback();
        }
      });
      if (consumeRecoveryEvent()) queueMicrotask(() => { if (active) callback(); });
      return () => { active = false; data.subscription.unsubscribe(); };
    },
    updatePassword: async (password) => {
      const { error } = await client.auth.updateUser({ password });
      return { error };
    },
  };
}
