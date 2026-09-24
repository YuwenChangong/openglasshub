import { LEGAL_POLICY } from "../legal-policy.ts";

export const LEGAL_CONSENT_SOURCES = [
  "registration",
  "login",
  "policy_update",
  "legacy_account_gate",
  "authenticated_callback",
] as const;

export type LegalConsentSource = (typeof LEGAL_CONSENT_SOURCES)[number];

export type ActiveLegalBundle = {
  bundleVersion: string;
  termsVersion: string;
  privacyVersion: string;
  guidelinesVersion: string;
  consentUrl: string;
};

export type LegalConsentRecord = {
  userId: string;
  bundleVersion: string;
  termsVersion: string;
  privacyVersion: string;
  guidelinesVersion: string;
};

export type LegalConsentReadRepository = {
  findByUserAndBundle(userId: string, bundleVersion: string): Promise<LegalConsentRecord | null>;
};

export type LegalConsentWriteRepository = {
  recordCurrentAcceptance(params: ActiveLegalBundle & { source: LegalConsentSource }): Promise<void>;
};

export type CurrentLegalConsentStatus = {
  current: boolean;
  activeBundle: ActiveLegalBundle;
};

export function getActiveLegalBundle(): ActiveLegalBundle {
  return {
    bundleVersion: LEGAL_POLICY.bundleVersion,
    termsVersion: LEGAL_POLICY.termsVersion,
    privacyVersion: LEGAL_POLICY.privacyVersion,
    guidelinesVersion: LEGAL_POLICY.guidelinesVersion,
    consentUrl: LEGAL_POLICY.routes.consent,
  };
}
export function isLegalConsentSource(value: unknown): value is LegalConsentSource {
  return typeof value === "string" && (LEGAL_CONSENT_SOURCES as readonly string[]).includes(value);
}

function recordMatchesActiveBundle(record: LegalConsentRecord, bundle: ActiveLegalBundle): boolean {
  return record.bundleVersion === bundle.bundleVersion
    && record.termsVersion === bundle.termsVersion
    && record.privacyVersion === bundle.privacyVersion
    && record.guidelinesVersion === bundle.guidelinesVersion;
}

export async function getCurrentConsentStatus(
  repository: LegalConsentReadRepository,
  userId: string,
): Promise<CurrentLegalConsentStatus> {
  const activeBundle = getActiveLegalBundle();
  const record = await repository.findByUserAndBundle(userId, activeBundle.bundleVersion);

  return {
    current: Boolean(record && recordMatchesActiveBundle(record, activeBundle)),
    activeBundle,
  };
}

export async function hasCurrentLegalConsent(repository: LegalConsentReadRepository, userId: string): Promise<boolean> {
  return (await getCurrentConsentStatus(repository, userId)).current;
}

export async function recordCurrentLegalConsent(
  repository: LegalConsentWriteRepository,
  source: LegalConsentSource,
): Promise<ActiveLegalBundle> {
  const activeBundle = getActiveLegalBundle();
  await repository.recordCurrentAcceptance({ ...activeBundle, source });
  return activeBundle;
}

export function buildSafeConsentResponse(status: Pick<CurrentLegalConsentStatus, "current" | "activeBundle">) {
  return {
    current: status.current,
    bundleVersion: status.activeBundle.bundleVersion,
    consentUrl: status.activeBundle.consentUrl,
  };
}

export async function requireCurrentLegalConsent(
  repository: LegalConsentReadRepository,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: "LEGAL_CONSENT_REQUIRED"; consentUrl: string }> {
  const status = await getCurrentConsentStatus(repository, userId);
  if (status.current) return { ok: true };

  return {
    ok: false,
    error: "LEGAL_CONSENT_REQUIRED",
    consentUrl: status.activeBundle.consentUrl,
  };
}
