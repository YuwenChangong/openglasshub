import type { LegalConsentSource } from "./server/legal-consent.server";
import type { LegalConsentStatus } from "./legal-consent-client";

export type ConsentSession = { accessToken: string; userId?: string };
export type AdapterResult<T> = { data: T; error: Error | null };
export type AuthViewState = "checking" | "signed_in" | "signed_out" | "error" | "timeout";

export interface LegalConsentAuthAdapter {
  getSession(): Promise<ConsentSession | null>;
  signInWithPassword?(input: { email: string; password: string }): Promise<AdapterResult<ConsentSession | null>>;
  signUp?(input: { email: string; password: string; emailRedirectTo?: string }): Promise<AdapterResult<ConsentSession | null>>;
  signOut?(): Promise<Error | null>;
}

export interface LegalConsentAdapter {
  getCurrentConsent(accessToken: string): Promise<LegalConsentStatus>;
  recordCurrentConsent(input: { accessToken: string; source: LegalConsentSource }): Promise<LegalConsentStatus>;
}

export interface LegalConsentNavigationAdapter {
  navigate(url: string): void;
  replace(url: string): void;
  getCurrentUrl(): string;
}

export type AuthPanelAdapter = LegalConsentAuthAdapter & {
  viewState: AuthViewState;
  userPresent?: boolean;
};

export function browserNavigationAdapter(): LegalConsentNavigationAdapter {
  return {
    navigate: (url) => window.location.assign(url),
    replace: (url) => window.location.replace(url),
    getCurrentUrl: () => window.location.href,
  };
}
