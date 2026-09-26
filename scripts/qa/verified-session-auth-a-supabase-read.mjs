import { createAuthAReadClient } from "./verified-session-auth-a-read-client.mjs";

const TARGET_REF = "xcbnxzjlsvtgzixurcof";
const PRODUCTION_ORIGIN = "https://api.supabase.com/";
const ORGANIZATION_PATH = /^\/v1\/organizations\/[a-z0-9][a-z0-9-]{0,62}$/;
const fail = (code) => { throw new Error(`AUTH_A_SB_${code}`); };

export async function readSupabaseInventory({ mode = "LOCAL_TEST", origin = PRODUCTION_ORIGIN,
  token } = {}) {
  if (mode === "PRODUCTION" && origin !== PRODUCTION_ORIGIN) fail("ORIGIN_DENIED");
  const client = createAuthAReadClient({ mode, origin, token, headerName: "Authorization",
    allowedPaths: ["/v1/projects", ORGANIZATION_PATH], maxRequests: 2 });
  const projects = await client.get("/v1/projects");
  if (!Array.isArray(projects)) fail("PROJECTS_UNKNOWN");
  const matches = projects.filter((entry) => entry?.ref === TARGET_REF);
  if (matches.length !== 1) fail("TARGET_AMBIGUOUS");
  const project = matches[0];
  const organizationSlug = project.organization_slug;
  if (typeof organizationSlug !== "string" || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(organizationSlug))
    fail("ORGANIZATION_UNKNOWN");
  const organization = await client.get(`/v1/organizations/${organizationSlug}`);
  if (!organization || typeof organization !== "object" || organization.slug !== organizationSlug)
    fail("ORGANIZATION_DRIFT");
  const hostMatch = project.database_host === `db.${TARGET_REF}.supabase.co`;
  return {
    projectRef: TARGET_REF,
    projectStatus: project.status === "ACTIVE_HEALTHY" ? "ACTIVE_HEALTHY" : "UNKNOWN",
    targetMatch: hostMatch,
    freePlan: organization.plan === "free",
    freeCapacityStatus: "UNKNOWN",
    capacityGate: "BLOCKED_BEFORE_AUTH_B",
    requestCount: client.requestCount,
  };
}
