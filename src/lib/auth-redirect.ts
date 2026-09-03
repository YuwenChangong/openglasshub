import { LEGACY_PAGES_ORIGIN } from "./site-origin.ts";

const FALLBACK_PATH = "/";
const TRUSTED_APPLICATION_ORIGIN = LEGACY_PAGES_ORIGIN;
const LEGACY_PAGES_HOSTNAME = new URL(LEGACY_PAGES_ORIGIN).hostname;
const SAFE_ORIGIN_HOSTS = new Set([LEGACY_PAGES_HOSTNAME, "localhost", "127.0.0.1"]);
const CONTROL_OR_BACKSLASH = /[\u0000-\u001f\u007f\\]/u;
const BOUNDARY_WHITESPACE = /^[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]|[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]$/u;

function hasUnsafeDestinationSyntax(value: string): boolean {
  return CONTROL_OR_BACKSLASH.test(value) || BOUNDARY_WHITESPACE.test(value) || value.startsWith("//");
}

function hasUnsafeEncodedSyntax(value: string): boolean {
  let decoded = value;

  for (let pass = 0; pass < 3; pass += 1) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      return true;
    }

    if (hasUnsafeDestinationSyntax(decoded)) return true;
  }

  return false;
}

function toInternalDestination(input: unknown): string | null {
  if (typeof input !== "string" || !input || hasUnsafeDestinationSyntax(input) || hasUnsafeEncodedSyntax(input)) {
    return null;
  }

  if (!input.startsWith("/")) return null;

  try {
    const resolved = new URL(input, TRUSTED_APPLICATION_ORIGIN);
    if (
      resolved.origin !== TRUSTED_APPLICATION_ORIGIN ||
      resolved.username ||
      resolved.password
    ) {
      return null;
    }

    const destination = `${resolved.pathname}${resolved.search}${resolved.hash}`;
    if (!destination.startsWith("/") || hasUnsafeDestinationSyntax(destination) || hasUnsafeEncodedSyntax(destination)) {
      return null;
    }

    return destination;
  } catch {
    return null;
  }
}

function getSafeFallback(fallback: string): string {
  return toInternalDestination(fallback) ?? FALLBACK_PATH;
}

function getTrustedApplicationOrigin(origin: string | undefined): URL | null {
  if (!origin) return null;

  try {
    const originUrl = new URL(origin);
    const isSafeHost =
      SAFE_ORIGIN_HOSTS.has(originUrl.hostname) || originUrl.hostname.endsWith(`.${LEGACY_PAGES_HOSTNAME}`);

    if (!["http:", "https:"].includes(originUrl.protocol) || !isSafeHost || originUrl.username || originUrl.password) {
      return null;
    }

    return originUrl;
  } catch {
    return null;
  }
}

export function getSafeNext(input: string | null | undefined, fallback = FALLBACK_PATH): string {
  return toInternalDestination(input) ?? getSafeFallback(fallback);
}

export function buildLoginHref(next: string): string {
  return `/login/?next=${encodeURIComponent(getSafeNext(next))}`;
}

export function buildAuthCallbackRedirect(origin: string | undefined, next: string): string | undefined {
  const originUrl = getTrustedApplicationOrigin(origin);
  if (!originUrl) return undefined;

  const callbackUrl = new URL("/auth/callback/", originUrl);
  callbackUrl.searchParams.set("next", getSafeNext(next));
  return callbackUrl.toString();
}

export function buildResetPasswordRedirect(origin: string | undefined): string | undefined {
  const originUrl = getTrustedApplicationOrigin(origin);
  return originUrl ? new URL("/auth/reset-password/", originUrl).toString() : undefined;
}
