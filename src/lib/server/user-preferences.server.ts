import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { LocalePreference } from "../i18n/locale.ts";

type RuntimeEnv = Record<string, string | undefined>;
type Dependencies = { createClient?: typeof createClient };
type PreferenceSnapshot = { locale_preference: LocalePreference; revision: number; updated_at: string | null };
const projection = "locale_preference,revision,updated_at";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function failure(code: string, status: number): Response { return json({ ok: false, code }, status); }
function isPreference(value: unknown): value is LocalePreference { return value === "auto" || value === "zh-CN" || value === "en"; }

function snapshot(value: unknown): PreferenceSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!isPreference(row.locale_preference) || !Number.isSafeInteger(row.revision) || (row.revision as number) < 1
    || typeof row.updated_at !== "string" || !Number.isFinite(Date.parse(row.updated_at))) return null;
  return { locale_preference: row.locale_preference, revision: row.revision as number, updated_at: row.updated_at };
}

async function readBoundedJson(request: Request): Promise<{ value?: unknown; tooLarge?: boolean }> {
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024) { await reader.cancel(); return { tooLarge: true }; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch { return {}; }
  finally { reader.releaseLock(); }
}

function createUserClient(env: RuntimeEnv, token: string, factory: typeof createClient): SupabaseClient {
  return factory(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function handlePreferenceRequest(request: Request, env: RuntimeEnv, dependencies: Dependencies = {}): Promise<Response> {
  const token = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!token) return failure("UNAUTHORIZED", 401);
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return failure("PREFERENCES_UNAVAILABLE", 503);
  if (request.method !== "GET" && request.method !== "PATCH") return failure("PREFERENCES_INVALID_INPUT", 405);
  try {
    const client = createUserClient(env, token, dependencies.createClient ?? createClient);
    const { data: auth, error: authError } = await client.auth.getUser(token);
    if (authError || !auth.user?.id) return failure("UNAUTHORIZED", 401);
    const userId = auth.user.id;
    if (request.method === "GET") {
      const { data, error } = await client.from("user_preferences").select(projection).eq("user_id", userId).maybeSingle();
      if (error) return failure("PREFERENCES_UNAVAILABLE", 503);
      if (data === null) return json({ ok: true, preference: { locale_preference: "auto", revision: 0, updated_at: null } });
      const preference = snapshot(data);
      return preference ? json({ ok: true, preference }) : failure("PREFERENCES_UNAVAILABLE", 503);
    }
    const origin = request.headers.get("origin");
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site"
      || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return failure("PREFERENCES_INVALID_INPUT", 400);
    const body = await readBoundedJson(request);
    if (body.tooLarge) return failure("PREFERENCES_TOO_LARGE", 413);
    if (!body.value || typeof body.value !== "object" || Array.isArray(body.value)) return failure("PREFERENCES_INVALID_INPUT", 400);
    const payload = body.value as Record<string, unknown>;
    if (Object.keys(payload).length !== 2 || !Object.hasOwn(payload, "locale_preference") || !Object.hasOwn(payload, "expected_revision")
      || !isPreference(payload.locale_preference) || !Number.isSafeInteger(payload.expected_revision)
      || (payload.expected_revision as number) < 0 || (payload.expected_revision as number) > 2147483647) return failure("PREFERENCES_INVALID_INPUT", 400);
    const result = payload.expected_revision === 0
      ? await client.from("user_preferences").insert({ user_id: userId, locale_preference: payload.locale_preference }).select(projection).single()
      : await client.from("user_preferences").update({ locale_preference: payload.locale_preference }).eq("user_id", userId).eq("revision", payload.expected_revision).select(projection).maybeSingle();
    if (result.error) return failure(result.error.code === "23505" ? "PREFERENCES_CONFLICT" : "PREFERENCES_UNAVAILABLE", result.error.code === "23505" ? 409 : 503);
    if (!result.data) return failure("PREFERENCES_CONFLICT", 409);
    const preference = snapshot(result.data);
    return preference ? json({ ok: true, preference }) : failure("PREFERENCES_UNAVAILABLE", 503);
  } catch { return failure("PREFERENCES_UNAVAILABLE", 503); }
}
