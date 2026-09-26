import { createAuthAReadClient } from "./verified-session-auth-a-read-client.mjs";

const PRODUCTION_ORIGIN = "https://api.brevo.com/";
const fail = (code) => { throw new Error(`AUTH_A_BREVO_${code}`); };

export async function readBrevoReadiness({ mode = "LOCAL_TEST", origin = PRODUCTION_ORIGIN,
  token, expectedSenderEmail, minimumCredits } = {}) {
  if (mode === "PRODUCTION" && origin !== PRODUCTION_ORIGIN) fail("ORIGIN_DENIED");
  if (typeof expectedSenderEmail !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(expectedSenderEmail)
    || !Number.isInteger(minimumCredits) || minimumCredits < 0) fail("CONTRACT_INVALID");
  const client = createAuthAReadClient({ mode, origin, token, headerName: "api-key",
    allowedPaths: ["/v3/account", "/v3/senders"], maxRequests: 2 });
  const account = await client.get("/v3/account");
  if (!account || typeof account !== "object" || !Array.isArray(account.plan)) fail("ACCOUNT_UNKNOWN");
  const plans = account.plan;
  const freeEmailPlans = plans.filter((entry) => entry?.type === "free" && entry.creditsType === "sendLimit");
  const plan = freeEmailPlans.length === 1 ? "FREE" : freeEmailPlans.length > 1 ? "UNKNOWN" : "NOT_FREE";
  const credits = freeEmailPlans.length === 1 && Number.isSafeInteger(freeEmailPlans[0].credits)
    && freeEmailPlans[0].credits >= 0 ? freeEmailPlans[0].credits : null;
  const relayReady = account.relay?.enabled === true;
  const senders = await client.get("/v3/senders");
  if (!Array.isArray(senders?.senders)) fail("SENDERS_UNKNOWN");
  const matching = senders.senders.filter((sender) => sender?.email === expectedSenderEmail);
  const senderReady = matching.length === 1 && matching[0].active === true;
  return { plan, creditsAvailable: credits,
    capacitySufficient: plan === "FREE" && relayReady && credits !== null && credits >= minimumCredits,
    senderReady, requestCount: client.requestCount };
}
