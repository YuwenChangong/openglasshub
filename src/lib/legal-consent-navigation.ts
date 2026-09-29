import { getSafeNext } from "./auth-redirect.ts";

export function getSafeConsentNext(input: unknown): string {
  const safeNext = getSafeNext(typeof input === "string" ? input : null, "/feed/");
  // Decode only for route classification; return the existing sanitizer's destination.
  let pathname = new URL(safeNext, "https://consent.invalid").pathname;
  for (let pass = 0; pass < 3; pass += 1) pathname = decodeURIComponent(pathname);
  pathname = new URL(pathname, "https://consent.invalid").pathname.toLowerCase();
  return /^\/(?:auth|login|register|legal-consent)(?:\/|$)/.test(pathname) ? "/feed/" : safeNext;
}
