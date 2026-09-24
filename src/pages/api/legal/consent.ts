import type { APIRoute } from "astro";
import { env as runtimeEnv } from "cloudflare:workers";
import { createUserClient, getBearerToken, type RuntimeEnv } from "../../../lib/server/admin-auth";
import { getLiveProviderSessionUser, getTrustedSessionClaims } from "../../../lib/server/verified-session.server";
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

async function authenticate(request: Request, env: RuntimeEnv) {
  const token = getBearerToken(request);
  if (!token) return null;

  let claims;
  try {
    claims = await getTrustedSessionClaims(token, env);
    await getLiveProviderSessionUser(token, env, claims);
  } catch (error) {
    if (error instanceof Response && error.status === 401) return null;
    throw error;
  }

  const client = createUserClient(env, token);
  return {
    userId: claims.userId,
    readRepository: createLegalConsentReadRepository(client),
  };
}

function dependenciesFor(request: Request, env: RuntimeEnv) {
  return {
    authenticate: () => authenticate(request, env),
    createWriteRepository: (verifiedUserId) => createLegalConsentWriteRepository(env, verifiedUserId),
  };
}

export const GET: APIRoute = async ({ request }) => {
  const env = runtimeEnv as RuntimeEnv;
  if (!env) return legalConsentJson({ error: "LEGAL_CONSENT_UNAVAILABLE" }, 500);
  try {
    return await handleLegalConsentGet(request, dependenciesFor(request, env));
  } catch {
    return legalConsentJson({ error: "LEGAL_CONSENT_UNAVAILABLE" }, 503);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const env = runtimeEnv as RuntimeEnv;
  if (!env) return legalConsentJson({ error: "LEGAL_CONSENT_UNAVAILABLE" }, 500);
  try {
    return await handleLegalConsentPost(request, dependenciesFor(request, env));
  } catch {
    return legalConsentJson({ error: "LEGAL_CONSENT_UNAVAILABLE" }, 503);
  }
};

export const ALL: APIRoute = () => legalConsentJson({ error: "METHOD_NOT_ALLOWED" }, 405);
