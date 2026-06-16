import { useMemo } from "react";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { useBrowserAuthState } from "./useBrowserAuthState";

export default function SignedOutHeroNote() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const authState = useBrowserAuthState(supabase);

  if (authState.status !== "signed_out") {
    return null;
  }

  return <strong>公开浏览，登录后互动</strong>;
}
