import type { APIRoute } from "astro";
import { createUserClient, getBearerToken, type RuntimeEnv } from "../../../lib/server/admin-auth";
import {
  handleLegalConsentGet,
  handleLegalConsentPost,
  legalConsentJson,
} from "../../../lib/server/legal-consent-api.server";
import {
  createLegalConsentReadRepository,
  createLegalConsentServiceClient,
  createLegalConsentWriteRepository,
} from "../../../lib/server/legal-consent-repository.server";

export const prerender = false;

type RuntimeLocals = { runtime?: { env?: RuntimeEnv } };

function getRuntimeEnv(locals: unknown): RuntimeEnv | null {
  return (locals as RuntimeLocals).runtime?.env ?? null;
}

async function authenticate(request: Request, env: RuntimeEnv) {
  const token = getBearerToken(request);
  if (!token) return null;

  const client = createUserClient(env, token);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;

  return {
    userId: data.user.id,
    readRepository: createLegalConsentReadRepository(client),
  };
}

function dependenciesFor(request: Request, env: RuntimeEnv) {
  return {
    authenticate: () => authenticate(request, env),
    createWriteRepository: () => createLegalConsentWriteRepository(createLegalConsentServiceClient(env)),
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
