import type { SupabaseClient } from "@supabase/supabase-js";

export interface PasswordRecoveryAdapter {
  exchangeCode(code: string): Promise<{ error: Error | null }>;
  hasSession(): Promise<boolean>;
  onRecoverySession(callback: () => void): () => void;
  updatePassword(password: string): Promise<{ error: Error | null }>;
}

export function createPasswordRecoveryAdapter(client: SupabaseClient): PasswordRecoveryAdapter {
  return {
    exchangeCode: async (code) => {
      const { error } = await client.auth.exchangeCodeForSession(code);
      return { error };
    },
    hasSession: async () => {
      const { data, error } = await client.auth.getSession();
      return !error && !!data.session;
    },
    onRecoverySession: (callback) => {
      const { data } = client.auth.onAuthStateChange((event, session) => {
        if (event === "PASSWORD_RECOVERY" && session) callback();
      });
      return () => data.subscription.unsubscribe();
    },
    updatePassword: async (password) => {
      const { error } = await client.auth.updateUser({ password });
      return { error };
    },
  };
}
