import { useEffect, useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { useBrowserAuthState } from "../auth/useBrowserAuthState";
import type { LocaleContext } from "../../lib/i18n/locale";
import { getBrowserLocaleStore } from "../../lib/i18n/locale-store";
import { createPreferenceSync, canAdoptOnRoute } from "../../lib/i18n/preference-sync";
import { loadOwnPreference, saveOwnPreference } from "../../lib/i18n/preference-client";

let browserSync: ReturnType<typeof createPreferenceSync> | undefined;
export function getBrowserPreferenceSync(initial: LocaleContext, client: SupabaseClient | null) {
  if (typeof window !== "undefined" && browserSync) return browserSync;
  const unavailable = () => { throw new Error("UNAVAILABLE"); };
  const sync = createPreferenceSync(getBrowserLocaleStore(initial), {
    load: (actor, signal) => client ? loadOwnPreference({ auth: client.auth, actor }, signal) : unavailable(),
    save: (actor, preference, revision, signal) => client ? saveOwnPreference({ auth: client.auth, actor }, preference, revision, signal) : unavailable(),
    canAdopt: () => typeof window !== "undefined" && canAdoptOnRoute(window.location.pathname),
  });
  if (typeof window !== "undefined") browserSync = sync;
  return sync;
}

export default function LocalePreferenceSync({ initial, clientAdapter }: { initial: LocaleContext; clientAdapter?: SupabaseClient | null }) {
  const client = useMemo(() => clientAdapter === undefined ? createBrowserSupabaseClient() : clientAdapter, [clientAdapter]);
  const auth = useBrowserAuthState(client);
  const sync = useMemo(() => getBrowserPreferenceSync(initial, client), [client]);
  useEffect(() => {
    if (auth.status === "signed_in") void sync.setActor(auth.user!.id);
    else if (auth.status === "signed_out") void sync.setActor(null);
  }, [sync, auth.status, auth.user?.id]);
  return <></>;
}
