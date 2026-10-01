import React, { useEffect, useState } from "react";
import { hydrateRoot, createRoot } from "react-dom/client";
import SettingsPage, { confirmSettingsNavigation } from "../../../src/components/settings/SettingsPage";
import { createPreferenceSync } from "../../../src/lib/i18n/preference-sync";
import { PreferenceClientError } from "../../../src/lib/i18n/preference-client";
import { useLocale } from "../../../src/components/i18n/useLocale";
import LocalePreferenceSync from "../../../src/components/i18n/LocalePreferenceSync";
import * as localeStores from "../../../src/lib/i18n/locale-store";
import type { LocaleContext, LocalePreference } from "../../../src/lib/i18n/locale";

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
