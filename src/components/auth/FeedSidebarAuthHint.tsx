import { useMemo } from "react";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { useBrowserAuthState } from "./useBrowserAuthState";
import { resolveLocale, type LocaleContext } from "../../lib/i18n/locale";
import { useLocale } from "../i18n/useLocale";

export default function FeedSidebarAuthHint({ localeContext = resolveLocale({ acceptLanguage: "zh-CN" }) }: { localeContext?: LocaleContext }) {
  const { messages } = useLocale(localeContext);
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const authState = useBrowserAuthState(supabase);

  if (authState.status !== "signed_out") {
    return null;
  }

  return (
    <section className="community-sidebar-block community-sidebar-block--strong community-sidebar-auth-hint">
      <p className="community-page-lead">{messages.account.loginToPost}</p>
    </section>
  );
}
