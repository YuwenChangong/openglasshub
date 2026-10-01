import React, { useEffect, useState } from "react";
import { hydrateRoot } from "react-dom/client";
import { useLocale } from "../../../src/components/i18n/useLocale";
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
    <output data-locale={context.locale}>{messages.shell.home}</output>
    <button onClick={() => choose("zh-CN")}>ZH</button><button onClick={() => choose("en")}>EN</button>
  </div>;
}

if (typeof window !== "undefined") {
  const initial = JSON.parse(document.getElementById("locale-snapshot")!.textContent!) as LocaleContext;
  for (const id of ["first", "second"]) hydrateRoot(document.getElementById(id)!, <LocaleFixture initial={initial} />);
}
