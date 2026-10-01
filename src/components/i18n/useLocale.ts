import { useMemo, useSyncExternalStore } from "react";
import type { LocaleContext } from "../../lib/i18n/locale";
import { getBrowserLocaleStore } from "../../lib/i18n/locale-store";
import { getUiMessages } from "../../lib/i18n/catalog";

export function useLocale(initial: LocaleContext) {
  const store = useMemo(() => getBrowserLocaleStore(initial), []);
  const context = useSyncExternalStore(store.subscribe, store.getSnapshot, () => initial);
  return { context, messages: getUiMessages(context.locale) };
}
