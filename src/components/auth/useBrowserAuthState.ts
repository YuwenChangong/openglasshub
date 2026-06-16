import { useEffect, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";

export type BrowserAuthStatus = "checking" | "signed_in" | "signed_out" | "error" | "timeout";

export interface BrowserAuthState {
  status: BrowserAuthStatus;
  user: User | null;
}

interface UseBrowserAuthStateOptions {
  timeoutMs?: number;
}

export function useBrowserAuthState(
  supabase: SupabaseClient | null,
  options?: UseBrowserAuthStateOptions,
): BrowserAuthState {
  const timeoutMs = options?.timeoutMs ?? 5000;
  const [state, setState] = useState<BrowserAuthState>({
    status: "checking",
    user: null,
  });

  useEffect(() => {
    if (!supabase) {
      setState({ status: "error", user: null });
      return;
    }

    let mounted = true;
    let resolved = false;

    const applyState = (nextState: BrowserAuthState) => {
      if (!mounted) return;
      resolved = true;
      setState(nextState);
    };

    setState((current) => (current.status === "signed_in" ? current : { status: "checking", user: null }));

    const timeoutId = window.setTimeout(() => {
      if (resolved) return;
      applyState({ status: "timeout", user: null });
    }, timeoutMs);

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (resolved || !mounted) return;
        if (error) {
          console.warn("[browser-auth] getSession failed", error.message);
          applyState({ status: "error", user: null });
          return;
        }

        const user = data.session?.user ?? null;
        applyState({
          status: user ? "signed_in" : "signed_out",
          user,
        });
      })
      .catch((error) => {
        if (resolved || !mounted) return;
        console.warn("[browser-auth] getSession crashed", error);
        applyState({ status: "error", user: null });
      });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      window.clearTimeout(timeoutId);
      if (!mounted) return;
      const user = session?.user ?? null;
      applyState({
        status: user ? "signed_in" : "signed_out",
        user,
      });
    });

    return () => {
      mounted = false;
      window.clearTimeout(timeoutId);
      listener.subscription.unsubscribe();
    };
  }, [supabase, timeoutMs]);

  return state;
}
