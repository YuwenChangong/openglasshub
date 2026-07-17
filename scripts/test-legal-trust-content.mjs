import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const legalPages = [
  ["terms", "src/pages/terms/index.astro"],
  ["privacy", "src/pages/privacy/index.astro"],
  ["guidelines", "src/pages/community-guidelines/index.astro"],
  ["safety", "src/pages/safety/index.astro"],
  ["accountDeletion", "src/pages/account-deletion/index.astro"],
  ["contact", "src/pages/contact/index.astro"],
  ["consent", "src/pages/legal-consent/index.astro"],
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

function runStripTypes(code) {
  return execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "--eval", code], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

function gitLines(args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
  })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function main() {
  const legalPolicySource = await read("src/lib/legal-policy.ts");
  const legalPageComponent = await read("src/components/legal/LegalPage.astro");
  const communityLayout = await read("src/layouts/CommunityLayout.astro");
  const loginPage = await read("src/pages/login/index.astro");
  const registerPage = await read("src/pages/register/index.astro");
  const sitemap = await read("src/pages/sitemap.xml.ts");
  const docs = await read("docs/ops/legal-trust-policy-management.md");

  const configPayload = JSON.parse(
    runStripTypes(`
      const mod = await import("./src/lib/legal-policy.ts");
      process.stdout.write(
        JSON.stringify({
          platformName: mod.LEGAL_POLICY.platformName,
          minimumAge: mod.LEGAL_POLICY.minimumAge,
          bundleVersion: mod.LEGAL_POLICY.bundleVersion,
          termsVersion: mod.LEGAL_POLICY.termsVersion,
          privacyVersion: mod.LEGAL_POLICY.privacyVersion,
          guidelinesVersion: mod.LEGAL_POLICY.guidelinesVersion,
          effectiveDate: mod.LEGAL_POLICY.effectiveDate,
          languages: mod.LEGAL_POLICY.languages,
          routes: mod.LEGAL_POLICY.routes,
          missingContacts: mod.getMissingPublicLegalContactKeys(),
          contactsReady: mod.hasConfiguredPublicLegalContacts(),
        }),
      );
    `),
  );

  assert(configPayload.platformName === "OpenGlass Hub", "Platform name must remain OpenGlass Hub.");
  assert(configPayload.minimumAge === 16, "Minimum age must stay exactly 16.");
  assert(Boolean(configPayload.bundleVersion), "Bundle version must be non-empty.");
  assert(Boolean(configPayload.termsVersion), "Terms version must be non-empty.");
  assert(Boolean(configPayload.privacyVersion), "Privacy version must be non-empty.");
  assert(Boolean(configPayload.guidelinesVersion), "Guidelines version must be non-empty.");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(configPayload.effectiveDate), "Effective date must be explicit YYYY-MM-DD.");
  assert(configPayload.languages.includes("zh-CN"), "Chinese support must be declared.");
  assert(configPayload.languages.includes("en"), "English support must be declared.");

  for (const routeKey of ["terms", "privacy", "guidelines", "safety", "accountDeletion", "contact", "consent"]) {
    assert(Boolean(configPayload.routes[routeKey]), `Missing route definition for ${routeKey}.`);
  }

  assert(Array.isArray(configPayload.missingContacts), "Missing public contact configuration must be detectable.");
  assert(legalPolicySource.includes("PUBLIC_LEGAL_CONTACT_ENV"), "Public legal contact configuration should stay separate from secrets.");
  assert(!legalPolicySource.includes("@example.com"), "Legal policy config must not hardcode fake email fallbacks.");

  assert((legalPageComponent.match(/<h1\b/g) ?? []).length === 1, "Legal page layout must render exactly one H1.");
  assert(legalPageComponent.includes('aria-label="Language navigation"'), "Legal page layout must expose language navigation.");
  assert(communityLayout.includes('aria-label="Footer legal links"'), "Shared footer should expose restrained legal links.");
  assert(loginPage.includes("auth-page__legal-copy"), "Login page should include informational legal links.");
  assert(
    loginPage.includes('modeParam === "register" || modeParam === "signup" ? "signup" : "login"'),
    "Login page should map register mode to signup.",
  );
  assert(registerPage.includes('redirectUrl.searchParams.set("next", safeNext);'), "Register redirect should preserve a sanitized next parameter.");

  for (const [routeKey, relativePath] of legalPages) {
    const source = await read(relativePath);
    if (routeKey === "consent") continue;
    assert(source.includes("headingZh="), `${routeKey} page must define a Chinese heading.`);
    assert(source.includes("headingEn="), `${routeKey} page must define an English heading.`);
    assert(source.includes("routeKey="), `${routeKey} page must bind its legal route key.`);
    assert(source.includes("version={getLegalPolicyVersion("), `${routeKey} page must use the central version helper.`);
    assert(!source.includes("<h1"), `${routeKey} page should rely on the shared legal layout for its H1.`);
    assert(!/24\/7|guarantee/i.test(source), `${routeKey} page must avoid unsupported monitoring or guarantee claims.`);
    assert(!/@example\.(com|test)/i.test(source), `${routeKey} page must not render placeholder contact email.`);
    assert(!/jurisdiction|司法管辖|本公司|LLC|Ltd\./i.test(source), `${routeKey} page must not invent a jurisdiction or legal entity.`);
  }

  const termsPage = await read("src/pages/terms/index.astro");
  const privacyPage = await read("src/pages/privacy/index.astro");
  const accountDeletionPage = await read("src/pages/account-deletion/index.astro");
  const safetyPage = await read("src/pages/safety/index.astro");
  const legalConsentPage = await read("src/pages/legal-consent/index.astro");

  assert(termsPage.includes("用户保留其提交内容的权利"), "Terms must preserve user ownership in Chinese.");
  assert(termsPage.includes("You retain rights in content you submit"), "Terms must preserve user ownership in English.");
  assert(termsPage.includes("LEGAL_POLICY.minimumAge"), "Terms must use the central minimum-age value.");

  for (const productName of ["Supabase", "Cloudflare Pages/R2", "OpenAI moderation when enabled"]) {
    assert(privacyPage.includes(productName), `Privacy policy must identify evidenced services including ${productName}.`);
  }
  assert(!accountDeletionPage.includes("承诺自动即时删除"), "Account deletion page must not promise automatic immediate deletion.");
  assert(!safetyPage.includes("24/7"), "Safety page must not claim 24/7 monitoring.");
  assert(safetyPage.includes("not an emergency service"), "Safety page must retain the emergency-service limitation.");

  for (const contactLabel of ["支持", "滥用与安全", "隐私请求", "知识产权投诉", "Support", "Abuse and safety", "Privacy requests", "Intellectual property complaints"]) {
    assert(legalPageComponent.includes(contactLabel), `Shared legal contact surface must include ${contactLabel}.`);
  }

  assert(legalConsentPage.includes("LegalConsentPage"), "Legal consent page must mount the authenticated consent surface.");
  assert(legalConsentPage.includes('title="政策确认"'), "Legal consent page must keep a Chinese page title.");
  assert(legalConsentPage.includes("noindex={true}"), "Legal consent page should be noindex in Phase 1.");

  for (const route of [
    'absoluteUrl(LEGAL_POLICY.routes.terms)',
    'absoluteUrl(LEGAL_POLICY.routes.privacy)',
    'absoluteUrl(LEGAL_POLICY.routes.guidelines)',
    'absoluteUrl(LEGAL_POLICY.routes.safety)',
    'absoluteUrl(LEGAL_POLICY.routes.accountDeletion)',
    'absoluteUrl(LEGAL_POLICY.routes.contact)',
  ]) {
    assert(sitemap.includes(route), `Sitemap must include ${route}.`);
  }
  assert(!sitemap.includes('absoluteUrl(LEGAL_POLICY.routes.consent)'), "Sitemap must exclude the noindex legal-consent utility page.");

  assert(docs.includes("Phase 1"), "Legal ops doc must describe Phase 1 scope.");
  assert(docs.includes("qualified lawyer"), "Legal ops doc must require qualified legal review.");
  assert(docs.includes("Phase 2"), "Legal ops doc must describe deferred Phase 2 work.");
  assert(docs.includes("Phase 3"), "Legal ops doc must describe deferred Phase 3 work.");
  assert(docs.includes("Phase 4"), "Legal ops doc must describe deferred Phase 4 work.");

  const diffFiles = new Set([
    ...gitLines(["diff", "--name-only", "HEAD"]),
    ...gitLines(["ls-files", "--others", "--exclude-standard"]),
  ]);

  for (const forbiddenPath of [
    "src/pages/api/consent",
    "src/lib/consent",
  ]) {
    assert(
      !Array.from(diffFiles).some((file) => file.startsWith(forbiddenPath)),
      `Phase 1 diff must not introduce ${forbiddenPath}.`,
    );
  }

  const unexpectedLegalMigrations = Array.from(diffFiles).filter(
    (file) => file.startsWith("supabase/migrations/") && file !== "supabase/migrations/20260712_legal_policy_acceptances.sql",
  );
  assert(
    unexpectedLegalMigrations.length === 0,
    `Legal foundation diff must not introduce unrelated migrations: ${unexpectedLegalMigrations.join(", ")}`,
  );

  const changedLockfiles = Array.from(diffFiles).filter((file) => /package-lock|pnpm-lock|yarn.lock/.test(file));
  assert(
    changedLockfiles.every((file) => file === "package-lock.json"),
    `Legal-content validation permits only the repository npm lockfile for reviewed development-tooling additions: ${changedLockfiles.join(", ")}`,
  );
  assert(
    !Array.from(diffFiles).some((file) => /staging-destructive-qa-recovery-manifest-v3/i.test(file)),
    "Phase 1 must not touch parked v3 recovery work.",
  );
  assert(!loginPage.includes("checkbox"), "Login page must not claim a consent checkbox is implemented.");
  assert(!communityLayout.includes("consent checkbox"), "Shared layout must not mention a consent checkbox.");

  console.log(
    `LEGAL_TRUST_CONTENT_OK contactsReady=${configPayload.contactsReady} missing=${configPayload.missingContacts.length} files=${diffFiles.size}`,
  );
}

main().catch((error) => {
  console.error(`LEGAL_TRUST_CONTENT_FAIL ${error.message}`);
  process.exitCode = 1;
});
