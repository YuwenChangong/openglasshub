import type { LegalConsentSource } from "./server/legal-consent.server";
import type { LegalConsentStatus } from "./legal-consent-client";
import { getSafeNext } from "./auth-redirect";

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

export interface LegalConsentGateAdapter extends LegalConsentAuthAdapter {
  subscribe?(listener: () => void): () => void;
}

export type AuthPanelAdapter = LegalConsentAuthAdapter & {
  viewState: AuthViewState;
  userPresent?: boolean;
};

export function browserNavigationAdapter(): LegalConsentNavigationAdapter {
  return {
    navigate: (url) => window.location.assign(getSafeNext(url)),
    replace: (url) => window.location.replace(getSafeNext(url)),
    getCurrentUrl: () => `${window.location.pathname}${window.location.search}${window.location.hash}`,
  };
}
