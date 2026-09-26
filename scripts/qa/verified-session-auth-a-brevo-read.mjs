import { createAuthAReadClient } from "./verified-session-auth-a-read-client.mjs";

const fail = (code) => { throw new Error(`AUTH_A_BREVO_${code}`); };

export async function readBrevoReadiness({ mode = "LOCAL_TEST", origin = "https://api.brevo.com/",
  token, expectedSenderEmail, minimumCredits } = {}) {
  if (typeof expectedSenderEmail !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(expectedSenderEmail)
    || !Number.isInteger(minimumCredits) || minimumCredits < 0) fail("CONTRACT_INVALID");
  const client = createAuthAReadClient({ mode, origin, token, headerName: "api-key",
    allowedPaths: ["/v3/account", "/v3/senders"], maxRequests: 2 });
  const account = await client.get("/v3/account");
  if (!account || typeof account !== "object" || !Array.isArray(account.plan)) fail("ACCOUNT_UNKNOWN");
  const plans = account.plan;
  const plan = plans.length === 1 && plans[0]?.type === "free" ? "FREE"
    : plans.length === 1 && typeof plans[0]?.type === "string" ? "NOT_FREE" : "UNKNOWN";
  const credits = plans.length === 1 && Number.isSafeInteger(plans[0]?.credits)
    && plans[0].credits >= 0 ? plans[0].credits : null;
  const relayReady = account.relay?.enabled === true;
  const senders = await client.get("/v3/senders");
  if (!Array.isArray(senders?.senders)) fail("SENDERS_UNKNOWN");
  const matching = senders.senders.filter((sender) => sender?.email === expectedSenderEmail);
  const senderVerified = matching.length === 1 && matching[0].active === true && matching[0].verified === true;
  return { plan, creditsAvailable: credits,
    capacitySufficient: plan === "FREE" && relayReady && credits !== null && credits >= minimumCredits,
    senderVerified, requestCount: client.requestCount };
}
