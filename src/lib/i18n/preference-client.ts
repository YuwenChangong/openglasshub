import type { LocalePreference } from "./locale.ts";

export type PreferenceSnapshot = { locale_preference: LocalePreference; revision: number; updated_at: string | null };
export type PreferenceClient = {
  auth: { getSession(): Promise<{ data: { session: { access_token: string; user: { id: string } } | null }; error?: unknown }> };
  actor?: string;
  fetch?: typeof fetch;
};
export class PreferenceClientError extends Error {
  readonly code: "UNAVAILABLE" | "CONFLICT" | "SIGNED_OUT";
  constructor(code: "UNAVAILABLE" | "CONFLICT" | "SIGNED_OUT") { super(code); this.code = code; }
}
function validateSnapshot(value: unknown): PreferenceSnapshot {
  if (!value || typeof value !== "object") throw new PreferenceClientError("UNAVAILABLE");
  const row = value as PreferenceSnapshot;
  if (!["auto", "zh-CN", "en"].includes(row.locale_preference) || !Number.isSafeInteger(row.revision) || row.revision < 0 || row.revision > 2147483647
    || (row.revision === 0 ? row.updated_at !== null : typeof row.updated_at !== "string" || !Number.isFinite(Date.parse(row.updated_at)))) throw new PreferenceClientError("UNAVAILABLE");
  return { locale_preference: row.locale_preference, revision: row.revision, updated_at: row.updated_at };
}
async function request(client: PreferenceClient, signal: AbortSignal, payload?: { locale_preference: LocalePreference; expected_revision: number }): Promise<PreferenceSnapshot> {
  try {
    const { data, error } = await client.auth.getSession();
    signal.throwIfAborted();
    if (error || !data.session || (client.actor && data.session.user.id !== client.actor)) throw new PreferenceClientError("SIGNED_OUT");
    const response = await (client.fetch ?? fetch)("/api/users/me/preferences", {
      method: payload ? "PATCH" : "GET", cache: "no-store", credentials: "same-origin", signal,
      headers: { Authorization: `Bearer ${data.session.access_token}`, ...(payload ? { "Content-Type": "application/json" } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    if (!response.ok) {
      // Settle the body without exposing provider details or changing HTTP error semantics.
      await response.json().catch(() => {});
      if (response.status === 409) throw new PreferenceClientError("CONFLICT");
      if (response.status === 401) throw new PreferenceClientError("SIGNED_OUT");
      throw new PreferenceClientError("UNAVAILABLE");
    }
    const body = await response.json();
    if (body?.ok !== true) throw new PreferenceClientError("UNAVAILABLE");
    return validateSnapshot(body.preference);
  } catch (error) {
    throw error instanceof PreferenceClientError ? error : new PreferenceClientError("UNAVAILABLE");
  }
}
export function loadOwnPreference(client: PreferenceClient, signal: AbortSignal) { return request(client, signal); }
export function saveOwnPreference(client: PreferenceClient, preference: LocalePreference, expectedRevision: number, signal: AbortSignal) {
  return request(client, signal, { locale_preference: preference, expected_revision: expectedRevision });
}
