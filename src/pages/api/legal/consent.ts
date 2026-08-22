import type { APIRoute } from "astro";
import { createUserClient, getBearerToken, type RuntimeEnv } from "../../../lib/server/admin-auth";
import { requireVerifiedApplicationSession } from "../../../lib/server/application-session.ts";
import {
  handleLegalConsentGet,
  handleLegalConsentPost,
  legalConsentJson,
} from "../../../lib/server/legal-consent-api.server";
import {
  createLegalConsentReadRepository,
  createLegalConsentWriteRepository,
} from "../../../lib/server/legal-consent-repository.server";

export const prerender = false;

type RuntimeLocals = { runtime?: { env?: RuntimeEnv } };

function getRuntimeEnv(locals: unknown): RuntimeEnv | null {
  return (locals as RuntimeLocals).runtime?.env ?? null;
}

async function authenticate(request: Request, env: RuntimeEnv) {
  try {
    const session = await requireVerifiedApplicationSession(request, env);
    const client = session.client;

    return { userId: session.user.id, readRepository: createLegalConsentReadRepository(client) };
  } catch { return null; }
}

function dependenciesFor(request: Request, env: RuntimeEnv) {
  return {
    authenticate: () => authenticate(request, env),
    createWriteRepository: (verifiedUserId) => createLegalConsentWriteRepository(env, verifiedUserId),
  };
}

export const GET: APIRoute = async ({ request, locals }) => {
  const env = getRuntimeEnv(locals);
  if (!env) return legalConsentJson({ error: "LEGAL_CONSENT_UNAVAILABLE" }, 500);
  return handleLegalConsentGet(request, dependenciesFor(request, env));
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = getRuntimeEnv(locals);
  if (!env) return legalConsentJson({ error: "LEGAL_CONSENT_UNAVAILABLE" }, 500);
  return handleLegalConsentPost(request, dependenciesFor(request, env));
};

export const ALL: APIRoute = () => legalConsentJson({ error: "METHOD_NOT_ALLOWED" }, 405);
