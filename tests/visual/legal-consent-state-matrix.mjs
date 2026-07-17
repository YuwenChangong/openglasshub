export const REQUIRED_VIEWPORTS = [
  { label: "1440x900", width: 1440, height: 900 },
  { label: "430x932", width: 430, height: 932 },
  { label: "390x844", width: 390, height: 844 },
];

const ids = [
  "consent-signed-out", "consent-session-loading", "consent-missing-unchecked", "consent-missing-checked", "consent-submit-pending", "consent-submit-success", "consent-post-failure", "consent-status-failure", "consent-session-expired-401", "consent-rate-limited-429", "consent-already-current",
  "login-unchecked", "login-checked", "login-auth-pending", "login-auth-success-consent-pending", "login-auth-success-consent-success", "login-auth-success-consent-failure", "register-unchecked", "register-checked", "register-session-consent-pending", "register-session-consent-success", "register-session-consent-failure", "register-email-confirmation-no-session", "register-route-mode",
  "callback-loading", "callback-current-consent", "callback-missing-consent", "callback-outdated-consent", "callback-status-failure", "callback-external-next-rejected",
];

export const LEGAL_CONSENT_STATE_MATRIX = ids.map((id, index) => ({
  id, category: index < 11 ? "consent" : index < 24 ? "auth" : "callback",
  screenshotRequired: index < 25,
  requiredViewports: REQUIRED_VIEWPORTS.map(({ label }) => label),
  expectedNavigation: index >= 25 ? "replace" : "none",
}));
