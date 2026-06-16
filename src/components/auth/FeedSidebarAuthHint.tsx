import { useMemo } from "react";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { useBrowserAuthState } from "./useBrowserAuthState";

export default function FeedSidebarAuthHint() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const authState = useBrowserAuthState(supabase);

  if (authState.status !== "signed_out") {
    return null;
  }

  return (
    <section className="community-sidebar-block community-sidebar-block--strong community-sidebar-auth-hint">
      <p className="community-page-lead">登录后可发帖</p>
    </section>
  );
}
