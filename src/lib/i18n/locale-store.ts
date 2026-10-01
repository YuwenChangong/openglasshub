import type { BrowserPreferenceRecord, LocaleContext, LocalePreference, PreferenceProvenance } from "./locale.ts";
import { normalizePreference } from "./locale.ts";
import { isBrowserPreferenceRecord, readBrowserPreference, writeBrowserPreference } from "./preference-cookie.ts";

export type LocaleStoreDependencies = {
  writePreference(record: BrowserPreferenceRecord): boolean;
  readPreference?(): BrowserPreferenceRecord | undefined;
  navigate(): void;
  publish?(record: BrowserPreferenceRecord): void;
  subscribeExternal?(listener: (record: unknown) => void): () => void;
  canNavigate?(): boolean;
};

export function createLocaleStore(initial: LocaleContext, dependencies: LocaleStoreDependencies) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  let unsubscribeExternal: (() => void) | undefined;
  const canNavigate = () => dependencies.canNavigate?.() ?? true;
  const notify = () => { for (const listener of listeners) listener(); };
  const apply = (record: BrowserPreferenceRecord) => {
    snapshot = {
      ...snapshot,
      locale: record.preference === "auto" ? snapshot.autoLocale : record.preference,
      preference: record.preference,
      generation: record.generation,
      provenance: record.provenance,
      source: record.provenance === "device_explicit" ? "current" : "saved",
    };
    notify();
  };
  const nextGeneration = () => {
    const cookie = dependencies.readPreference?.();
    const previous = Math.max(snapshot.generation, cookie?.generation ?? 0);
    return previous === Number.MAX_SAFE_INTEGER ? 0 : previous + 1;
  };
  const commit = (preference: LocalePreference, provenance: PreferenceProvenance, navigate = true): boolean => {
    const record: BrowserPreferenceRecord = { version: 1, preference, generation: nextGeneration(), provenance };
    let persisted = false;
    try { persisted = dependencies.writePreference(record); } catch { /* Retain the in-memory choice. */ }
    apply(record);
    if (persisted) {
      dependencies.publish?.(record);
      if (navigate && canNavigate()) dependencies.navigate();
    }
    return persisted;
  };
  const receive = (record: unknown) => {
    if (!canNavigate() || !isBrowserPreferenceRecord(record)) return;
    const overflowReset = snapshot.generation === Number.MAX_SAFE_INTEGER && record.generation === 0;
    if (record.generation <= snapshot.generation && !overflowReset) return;
    const cookie = dependencies.readPreference?.();
    if (cookie && (cookie.generation !== record.generation || cookie.preference !== record.preference || cookie.provenance !== record.provenance)) return;
    apply(record);
    dependencies.navigate();
  };

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initial,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) unsubscribeExternal = dependencies.subscribeExternal?.(receive);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) { unsubscribeExternal?.(); unsubscribeExternal = undefined; }
      };
    },
    select(preference: LocalePreference, options?: { navigate?: boolean }): boolean {
      return commit(normalizePreference(preference), "device_explicit", options?.navigate ?? true);
    },
    adoptAccount(account: { locale_preference: LocalePreference; revision: number; updated_at: string | null }, expectedGeneration: number): boolean {
      if (!canNavigate() || snapshot.generation !== expectedGeneration || snapshot.provenance === "device_explicit") return false;
      const preference = normalizePreference(account.locale_preference);
      if (preference !== account.locale_preference || !Number.isSafeInteger(account.revision) || account.revision < 0) return false;
      if (account.revision === 0 ? account.updated_at !== null : typeof account.updated_at !== "string" || !Number.isFinite(Date.parse(account.updated_at))) return false;
      if (snapshot.provenance === "account_adopted" && snapshot.preference === preference) return false;
      return commit(preference, "account_adopted");
    },
    clearAccount(): void {
      if (snapshot.provenance === "account_adopted") commit("auto", "account_adopted");
    },
  };
}
export type LocaleStore = ReturnType<typeof createLocaleStore>;

let browserStore: LocaleStore | undefined;

export function getBrowserLocaleStore(initial: LocaleContext): LocaleStore {
  if (typeof window === "undefined") {
    return createLocaleStore(initial, { writePreference: () => false, navigate() {} });
  }
  if (browserStore) return browserStore;
  let channel: BroadcastChannel | undefined;
  const eventName = "ogh:locale-preference";
  browserStore = createLocaleStore(initial, {
    writePreference: writeBrowserPreference,
    readPreference: readBrowserPreference,
    navigate: () => window.location.reload(),
    canNavigate: () => !/^\/(?:login|register|auth\/callback|auth\/reset-password)(?:\/|$)/.test(window.location.pathname),
    publish(record) {
      window.dispatchEvent(new CustomEvent(eventName, { detail: record }));
      try { channel?.postMessage(record); } catch { /* Cookie remains authoritative. */ }
    },
    subscribeExternal(listener) {
      try {
        channel = new BroadcastChannel(eventName);
        channel.onmessage = event => listener(event.data);
      } catch { /* Cross-tab messaging is optional. */ }
      return () => { channel?.close(); channel = undefined; };
    },
  });
  return browserStore;
}
