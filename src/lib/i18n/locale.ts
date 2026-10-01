export type LocalePreference = "auto" | "zh-CN" | "en";
export type ResolvedLocale = "zh-CN" | "en";
export type PreferenceProvenance = "device_explicit" | "account_adopted";
export type BrowserPreferenceRecord = {
  version: 1;
  preference: LocalePreference;
  generation: number;
  provenance: PreferenceProvenance;
};
export type LocaleContext = {
  locale: ResolvedLocale;
  preference: LocalePreference;
  source: "current" | "saved" | "country" | "accept_language" | "fallback";
  autoLocale: ResolvedLocale;
  generation: number;
  provenance: PreferenceProvenance | null;
};
export type LocaleInputs = {
  current?: LocalePreference;
  saved?: BrowserPreferenceRecord;
  trustedCountry?: string;
  acceptLanguage?: string;
};

export function normalizePreference(value: unknown): LocalePreference {
  return value === "zh-CN" || value === "en" ? value : "auto";
}

export function resolveLocale(inputs: LocaleInputs): LocaleContext {
  const current = inputs.current !== undefined;
  const preference = normalizePreference(current ? inputs.current : inputs.saved?.preference);
  const autoLocale = inputs.trustedCountry === "CN" ? "zh-CN" : "en";
  const manual = preference !== "auto";
  return {
    locale: manual ? preference : autoLocale,
    preference,
    source: manual ? (current ? "current" : "saved") : inputs.trustedCountry ? "country" : "fallback",
    autoLocale,
    generation: inputs.saved?.generation ?? 0,
    provenance: current ? "device_explicit" : inputs.saved?.provenance ?? null,
  };
}
