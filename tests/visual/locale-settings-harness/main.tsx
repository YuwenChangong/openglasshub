import React, { useEffect, useState } from "react";
import { hydrateRoot, createRoot } from "react-dom/client";
import SettingsPage, { confirmSettingsNavigation } from "../../../src/components/settings/SettingsPage";
import { createPreferenceSync } from "../../../src/lib/i18n/preference-sync";
import { PreferenceClientError } from "../../../src/lib/i18n/preference-client";
import { useLocale } from "../../../src/components/i18n/useLocale";
import LocalePreferenceSync from "../../../src/components/i18n/LocalePreferenceSync";
import * as localeStores from "../../../src/lib/i18n/locale-store";
import type { LocaleContext, LocalePreference } from "../../../src/lib/i18n/locale";
import { loadOwnPreference, saveOwnPreference } from "../../../src/lib/i18n/preference-client";
import { getSafeNext } from "../../../src/lib/auth-redirect";
import { createBrowserSupabaseClient } from "../../../src/lib/supabase-browser";

function createTask19Auth() {
  if (typeof window === "undefined") return null;
  const configuration = (window as any).__task19PublicConfig;
  if (!configuration || new URL(configuration.url).hostname !== "127.0.0.1") throw new Error("TASK19_LOCAL_AUTH_CONFIG_REQUIRED");
  return createBrowserSupabaseClient();
}

export function Task19Fixture({ initial, actor: initialActor }: { initial: LocaleContext; actor: string | null }) {
  const [actor, setActor] = useState(initialActor);
  const [client] = useState(createTask19Auth);
  const [authReady, setAuthReady] = useState(() => typeof window === "undefined" || !(window as any).__task19SessionPreflight);
  const [store] = useState(() => localeStores.getBrowserLocaleStore(initial));
  const [sync] = useState(() => createPreferenceSync(store, {
    load: (owner, signal) => loadOwnPreference({ actor: (window as any).__task19ActorIds[owner], auth: client!.auth }, signal),
    save: (owner, preference, revision, signal) => saveOwnPreference({ actor: (window as any).__task19ActorIds[owner], auth: client!.auth }, preference, revision, signal),
  }));
  useEffect(() => { if (authReady) void sync.setActor(actor); }, [actor, authReady, sync]);
  useEffect(() => {
    if (!client) throw new Error("TASK19_PRODUCT_BROWSER_CLIENT_NULL");
    let observedIdentity = "ANONYMOUS";
    const lifecycleObservers = new Set<() => void>();
    const classifyActor = (id?: string) => {
      const ids = (window as any).__task19ActorIds;
      return !id ? "ANONYMOUS" : id === ids.A ? "ACCOUNT_A" : id === ids.B ? "ACCOUNT_B" : "UNKNOWN";
    };
    const getSessionState = async () => {
      const { data, error } = await client.auth.getSession();
      return { ok: !error, sessionPresent: !error && data.session !== null, accessTokenPresent: Boolean(data.session?.access_token),
        actor: classifyActor(data.session?.user.id) };
    };
    const signOut = async () => {
      const { error } = await client.auth.signOut();
      if (error) return { ok: false, boundary: "UNKNOWN" };
      const state = await getSessionState();
      return { ...state, ok: state.ok && !state.sessionPresent };
    };
    const subscription = client.auth.onAuthStateChange((_event, session) => {
      const identity = classifyActor(session?.user.id);
      observedIdentity = identity;
      if ((window as any).__task19LocaleDiagnostic && _event === "SIGNED_IN" && identity === "ACCOUNT_A"
        && sessionStorage.getItem("task19-locale-pre-adoption") === null) {
        const value = store.getSnapshot();
        sessionStorage.setItem("task19-locale-pre-adoption", JSON.stringify({ locale: value.locale, preference: value.preference,
          provenance: value.provenance, source: value.source, generationClass: value.generation === 0 ? "ZERO" : "POSITIVE" }));
      }
      const label = identity === "ACCOUNT_A" ? "A" : identity === "ACCOUNT_B" ? "B" : null;
      if (label !== null || document.cookie.includes("task19_actor=")) document.cookie = `task19_actor=${label ?? ""}; Path=/; Secure; SameSite=Lax`;
      setActor(label);
    });
    (window as any).__task19AuthHarness = {
      async signIn(email: string, password: string) {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) return { ok: false, boundary: typeof error.status === "number" && error.status > 0
          ? "BROWSER_SIGNIN_HTTP_REJECTED" : "BROWSER_SIGNIN_NETWORK_FAILED",
          status: typeof error.status === "number" ? error.status : "UNKNOWN" };
        if (!data.session) return { ok: false, boundary: "BROWSER_SIGNIN_SESSION_NOT_PERSISTED" };
        const state = await getSessionState();
        if (!state.sessionPresent) return { ok: false, boundary: "BROWSER_SIGNIN_SESSION_NOT_PERSISTED" };
        if (classifyActor(data.session.user.id) !== state.actor) return { ok: false, boundary: "BROWSER_SIGNIN_GETSESSION_MISMATCH" };
        if (!(window as any).__task19TransportDiagnostic) setAuthReady(true);
        return { ...state, ok: state.ok };
      },
      signOut, getSessionState,
    };
    (window as any).__task19 = {
      authState: getSessionState,
      observePreferenceLifecycle() {
        const samples: { actor: string; status: string; revision: number | null; preference: string | null; locale: string }[] = [];
        const capture = () => {
          const state = sync.getSnapshot();
          samples.push({ actor: observedIdentity, status: state.status, revision: state.account?.revision ?? null,
            preference: state.account?.locale_preference ?? null, locale: store.getSnapshot().locale });
        };
        const removeSync = sync.subscribe(capture), removeStore = store.subscribe(capture);
        const stop = () => { removeSync(); removeStore(); lifecycleObservers.delete(stop); };
        lifecycleObservers.add(stop); capture();
        return { snapshot: () => [...samples], stop };
      },
      async privatePreferenceAccess() {
        try { await loadOwnPreference({ auth: client.auth }, new AbortController().signal); return true; }
        catch (error) {
          if (error instanceof PreferenceClientError && error.code === "SIGNED_OUT") return false;
          throw new Error("TASK19_PRIVATE_PREFERENCE_CHECK_FAILED");
        }
      },
      state: () => sync.getSnapshot(), locale: () => store.getSnapshot(), safeNext: getSafeNext,
      publish(record: unknown) { const channel = new BroadcastChannel("ogh:locale-preference"); channel.postMessage(record); channel.close(); },
    };
    if ((window as any).__task19ObserveLoadingLifecycle) {
      (window as any).__task19LoadingLifecycle = (window as any).__task19.observePreferenceLifecycle();
    }
    return () => {
      for (const stop of lifecycleObservers) stop();
      if ((window as any).__task19ObserveLoadingLifecycle) delete (window as any).__task19LoadingLifecycle;
      subscription.data.subscription.unsubscribe(); delete (window as any).__task19; delete (window as any).__task19AuthHarness;
    };
  }, [client, store, sync]);
  return <SettingsPage localeContext={initial} adapter={{ signedIn: actor !== null, sync,
    signOut: async () => {
      const result = await (window as any).__task19AuthHarness.signOut();
      return result.ok ? {} : { error: new Error("TASK19_LOCAL_BROWSER_SIGNOUT_FAILED") };
    } }} />;
}

export function LocaleFixture({ initial }: { initial: LocaleContext }) {
  const { context, messages } = useLocale(initial);
  const [hydrated, setHydrated] = useState(false);
  const [persistent, setPersistent] = useState<boolean | null>(null);
  useEffect(() => { setHydrated(true); }, []);
  const choose = (preference: LocalePreference) => {
    setPersistent(localeStores.getBrowserLocaleStore(initial).select(preference));
  };
  return <div data-hydrated={hydrated} data-persistent={persistent === null ? "unknown" : String(persistent)}>
    <LocalePreferenceSync initial={initial} clientAdapter={null} />
    <output data-locale={context.locale}>{messages.shell.home}</output>
    <button onClick={() => choose("zh-CN")}>ZH</button><button onClick={() => choose("en")}>EN</button>
  </div>;
}

if (typeof window !== "undefined") {
  const initial = JSON.parse(document.getElementById("locale-snapshot")!.textContent!) as LocaleContext;
  if (new URL(location.href).searchParams.get("fixture") === "task19") {
    const actor = document.cookie.split(";").map(part => part.trim()).find(part => part.startsWith("task19_actor="))?.slice("task19_actor=".length) || null;
    hydrateRoot(document.getElementById("task19-fixture")!, <Task19Fixture initial={initial} actor={actor} />);
  } else {
  for (const id of ["first", "second"]) hydrateRoot(document.getElementById(id)!, <LocaleFixture initial={initial} />);
  if (new URL(location.href).searchParams.get("fixture") === "settings") {
    const container = document.createElement("div"); container.id = "settings-fixture"; document.body.append(container);
    const parameters = new URL(location.href).searchParams;
    const evidence = { signOuts: 0, saves: [] as unknown[], reloads: 0 };
    (window as any).__settingsFixture = evidence;
    (window as any).__confirmSettingsNavigation = confirmSettingsNavigation;
    const sync = createPreferenceSync(localeStores.getBrowserLocaleStore(initial), {
      load: async () => ({ locale_preference: "en", revision: 3, updated_at: "2026-10-01T00:00:00Z" }),
      save: async (_actor, preference, revision) => {
        evidence.saves.push({ preference, revision });
        if (parameters.has("failure")) throw new PreferenceClientError(parameters.get("failure") === "conflict" ? "CONFLICT" : "UNAVAILABLE");
        return { locale_preference: preference, revision: revision + 1, updated_at: "2026-10-01T00:00:01Z" };
      }, canAdopt: () => false,
    });
    const signedIn = parameters.get("actor") === "ready";
    if (signedIn) void sync.setActor("local-fixture-actor");
    createRoot(container).render(<SettingsPage localeContext={initial} adapter={{ signedIn, sync, signOut: async () => { evidence.signOuts++; return {}; }, reload: () => { evidence.reloads++; } }} />);
  }
  }
}
