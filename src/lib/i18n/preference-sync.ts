import type { LocaleStore } from "./locale-store.ts";
import type { LocalePreference } from "./locale.ts";
import type { PreferenceSnapshot } from "./preference-client.ts";
import { PreferenceClientError } from "./preference-client.ts";

export type PreferenceSyncDependencies = {
  load(actor: string, signal: AbortSignal): Promise<PreferenceSnapshot>;
  save(actor: string, preference: LocalePreference, revision: number, signal: AbortSignal): Promise<PreferenceSnapshot>;
  canAdopt?(): boolean;
};
export type PreferenceSyncState = {
  status: "idle" | "loading" | "ready" | "saving" | "saved" | "local" | "unavailable" | "conflict";
  account: PreferenceSnapshot | null;
  devicePersistent: boolean | null;
};
export function canAdoptOnRoute(pathname: string): boolean {
  return !/^\/(?:login|register|auth\/callback|auth\/reset-password)(?:\/|$)/.test(pathname);
}
export function createPreferenceSync(store: LocaleStore, dependencies: PreferenceSyncDependencies) {
  let actor: string | null = null;
  let epoch = 0;
  let controller: AbortController | undefined;
  let disposed = false;
  let state: PreferenceSyncState = { status: "idle", account: null, devicePersistent: null };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<PreferenceSyncState>) => {
    state = { ...state, ...patch }; for (const listener of listeners) listener();
  };
  const cancel = () => { epoch++; controller?.abort(); controller = undefined; };
  const bounded = async <T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const own = new AbortController(); controller = own;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: () => void = () => {};
    const interrupted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new PreferenceClientError("UNAVAILABLE"));
      own.signal.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => own.abort(), 3000);
    });
    try { return await Promise.race([operation(own.signal), interrupted]); }
    finally { clearTimeout(timer); own.signal.removeEventListener("abort", onAbort); if (controller === own) controller = undefined; }
  };
  return {
    async setActor(next: string | null) {
      if (disposed || actor === next) return;
      cancel();
      if (actor !== null || next === null) store.clearAccount();
      actor = next; update({ status: next ? "loading" : "idle", account: null });
      if (!next) return;
      const started = epoch, generation = store.getSnapshot().generation;
      try {
        const account = await bounded(signal => dependencies.load(next, signal));
        if (disposed || epoch !== started || actor !== next) return;
        update({ status: "ready", account });
        if (dependencies.canAdopt?.() ?? true) store.adoptAccount(account, generation);
      } catch {
        if (!disposed && epoch === started && actor === next) update({ status: "unavailable", account: null });
      }
    },
    async save(preference: LocalePreference) {
      if (disposed) return;
      cancel();
      const devicePersistent = store.select(preference, { navigate: false });
      if (!actor) { update({ status: "local", devicePersistent }); return; }
      const current = actor, started = epoch, generation = store.getSnapshot().generation;
      update({ status: "saving", devicePersistent });
      try {
        const account = await bounded(async signal => {
          const previous = state.account ?? await dependencies.load(current, signal);
          return dependencies.save(current, preference, previous.revision, signal);
        });
        if (!disposed && epoch === started && actor === current && store.getSnapshot().generation === generation) update({ status: "saved", account });
      } catch (error) {
        if (disposed || epoch !== started || actor !== current || store.getSnapshot().generation !== generation) return;
        if (error instanceof PreferenceClientError && error.code === "CONFLICT") {
          update({ status: "conflict" });
          try {
            const account = await bounded(signal => dependencies.load(current, signal));
            if (!disposed && epoch === started && actor === current) update({ account });
          } catch { /* Conflict stays visible; never overwrite browser choice. */ }
        } else update({ status: "unavailable" });
      }
    },
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { disposed = true; cancel(); actor = null; state = { status: "idle", account: null, devicePersistent: null }; listeners.clear(); },
  };
}
