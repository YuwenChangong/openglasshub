import { useMemo, useState, useSyncExternalStore } from "react";
import type { LocaleContext, LocalePreference } from "../../lib/i18n/locale";
import { useLocale } from "../i18n/useLocale";
import { getBrowserLocaleStore } from "../../lib/i18n/locale-store";
import { getBrowserPreferenceSync } from "../i18n/LocalePreferenceSync";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { useBrowserAuthState } from "../auth/useBrowserAuthState";
import type { createPreferenceSync } from "../../lib/i18n/preference-sync";

export type SettingsAdapter = {
  signedIn: boolean;
  sync: ReturnType<typeof createPreferenceSync>;
  signOut(): Promise<{ error?: unknown }>;
  reload?(): void;
};
export function confirmSettingsNavigation(pathname: string, hasUnsavedInput: boolean, confirm: (message: string) => boolean, message: string): boolean {
  return !/^\/(?:login|register|auth\/reset-password)(?:\/|$)/.test(pathname) || !hasUnsavedInput || confirm(message);
}
const css = `.locale-settings{max-width:760px;margin:0 auto;padding:28px 20px;color:var(--text,#f5f5f5)}.locale-settings h1{font-size:28px;margin:0 0 24px}.locale-settings section{padding:24px 0;border-top:1px solid var(--border,#333)}.locale-settings h2{font-size:18px;margin:0 0 18px}.locale-settings label{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap}.locale-settings select{min-width:180px;max-width:100%;padding:10px;border:1px solid var(--border-strong,#555);border-radius:6px;background:var(--page-bg-soft,#141414);color:inherit;font:inherit}.locale-settings ul{list-style:none;margin:0;padding:0}.locale-settings li{padding:10px 0}.locale-settings a{color:var(--accent,#63adff);text-decoration:none;overflow-wrap:anywhere}.locale-settings button{font:inherit;padding:8px 12px;border-radius:6px;border:1px solid var(--border-strong,#555);background:var(--control-bg,#222);color:inherit;cursor:pointer}.locale-settings [role=status]{color:var(--text-muted,#aaa);line-height:1.6;overflow-wrap:anywhere}.locale-settings select:focus-visible,.locale-settings button:focus-visible,.locale-settings a:focus-visible{outline:2px solid var(--accent,#63adff);outline-offset:3px}`;
export default function SettingsPage({ localeContext, adapter }: { localeContext: LocaleContext; adapter?: SettingsAdapter }) {
  const { context, messages } = useLocale(localeContext), text = messages.settings;
  const client = useMemo(() => adapter ? null : createBrowserSupabaseClient(), [adapter]);
  const auth = useBrowserAuthState(client);
  const sync = useMemo(() => adapter?.sync ?? getBrowserPreferenceSync(localeContext, client), [adapter, client]);
  const serverSnapshot = useMemo(() => sync.getSnapshot(), [sync]);
  const state = useSyncExternalStore(sync.subscribe, sync.getSnapshot, () => serverSnapshot);
  const signedIn = adapter?.signedIn ?? auth.status === "signed_in";
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const [logoutError, setLogoutError] = useState(false), [loggingOut, setLoggingOut] = useState(false);
  const reload = () => adapter?.reload ? adapter.reload() : window.location.reload();
  const choose = async (preference: LocalePreference) => {
    if (!signedIn) { setPersistent(getBrowserLocaleStore(localeContext).select(preference)); return; }
    await sync.save(preference);
    if (sync.getSnapshot().status === "saved" && sync.getSnapshot().devicePersistent) reload();
  };
  const logout = async () => {
    if (loggingOut) return; setLoggingOut(true); setLogoutError(false);
    try {
      const result = adapter ? await adapter.signOut() : await client!.auth.signOut();
      if (result.error) throw new Error("UNAVAILABLE");
      await sync.setActor(null); reload();
    } catch { setLogoutError(true); }
    finally { setLoggingOut(false); }
  };
  const status = persistent === false || state.devicePersistent === false ? text.nonpersistent
    : state.status === "saving" ? text.saving : state.status === "saved" ? text.saved
    : state.status === "unavailable" ? text.unavailable : state.status === "conflict" ? text.conflict : state.status === "local" ? text.local : "";
  return <main className="locale-settings" lang={context.locale}>
    <style>{css}</style><h1>{text.title}</h1>
    <section aria-labelledby="settings-general"><h2 id="settings-general">{text.general}</h2>
      <label>{text.language}<select value={context.preference} onChange={event => void choose(event.target.value as LocalePreference)} disabled={state.status === "saving"}>
        <option value="auto">{text.auto}</option><option value="zh-CN">简体中文</option><option value="en">English</option>
      </select></label>
      <p role="status" aria-live="polite">{status}</p>
      {state.status === "conflict" && state.account ? <p>{text.latest}: {state.account.locale_preference === "auto" ? text.auto : state.account.locale_preference === "en" ? "English" : "简体中文"}</p> : null}
      {signedIn && (state.status === "unavailable" || state.status === "conflict") ? <button onClick={() => void choose(context.preference)}>{text.retry}</button> : null}
      {state.devicePersistent && (state.status === "unavailable" || state.status === "conflict") ? <button onClick={reload}>{text.refresh}</button> : null}
    </section>
    <section aria-labelledby="settings-account"><h2 id="settings-account">{text.account}</h2>
      {signedIn ? <ul><li><a href="/me/">{text.profile}</a></li><li><a href="/me/edit/">{text.editProfile}</a></li>
        <li><a href="/login/?mode=forgot&next=%2Fsettings%2F">{text.security}</a></li><li><button disabled={loggingOut} onClick={() => void logout()}>{text.logout}</button></li>
        <li><a href="/account-deletion/">{text.deletion}</a></li></ul> : <a href="/login/?next=%2Fsettings%2F">{text.signIn}</a>}
      {logoutError ? <p role="alert">{text.logoutFailed}</p> : null}
    </section>
    <section aria-labelledby="settings-notifications"><h2 id="settings-notifications">{text.notifications}</h2><a href="/notifications/">{text.notifications}</a></section>
    <section aria-labelledby="settings-privacy"><h2 id="settings-privacy">{text.privacySafety}</h2><ul>
      <li><a href="/privacy/">{text.privacy}</a></li><li><a href="/terms/">{text.terms}</a></li><li><a href="/community-guidelines/">{text.guidelines}</a></li>
      <li><a href="/safety/">{text.safety}</a></li><li><a href="/account-deletion/">{text.deletion}</a></li>
    </ul></section>
  </main>;
}
