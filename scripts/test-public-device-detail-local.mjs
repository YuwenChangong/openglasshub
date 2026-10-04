import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRepositoryInventory } from "./lib/product-detail-repository-inventory.mjs";
import { preparePreferenceRunEnvironment } from "./test-user-preferences-rls-local.mjs";
import { assertLocalReplayTarget, runCommand, runLocalDisposableReplay, withCanonicalBaselineDirectory } from "./qa/local-disposable-supabase-replay.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactRoot = path.join(root, "artifacts/qa/product-detail-task-3");
const runId = randomUUID();
const receipt = { format: "public-device-detail-local-v1", runId, status: "RED", assertions: [], productionRequests: 0 };
const quote = value => value === null || value === undefined ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
const check = (condition, name) => { assert.ok(condition, name); receipt.assertions.push(name); };

async function main() {
  const migrations = (await readdir(path.join(root, "supabase/migrations"))).filter(name => name.endsWith("_public_device_detail_v1.sql"));
  check(migrations.length === 1, "EXACTLY_ONE_PUBLIC_DETAIL_MIGRATION_REQUIRED");
  const migration = await readFile(path.join(root, "supabase/migrations", migrations[0]), "utf8");
  check(!/security\s+definer/i.test(migration), "NO_NEW_DEFINER");
  check(!/grant\s+select\s+on\s+(?:table\s+)?public\.device_/i.test(migration), "NO_BLANKET_TABLE_SELECT");
  const inventory = await buildRepositoryInventory({ root });
  const publicRow = inventory.pipeline.readerCompatibleRows.find(row => row.slug === "xreal-one");
  const entry = inventory.parameterLedger.find(item => item.slug === publicRow.slug && item.state === "KNOWN" && item.definition.valueType === "text");
  check(Boolean(entry), "SOURCE_DERIVED_LOCAL_FIXTURE");
  const allowed = ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME", "COMSPEC"];
  const environment = preparePreferenceRunEnvironment(Object.fromEntries(allowed.filter(key => process.env[key]).map(key => [key, process.env[key]])));
  let anonKey;
  const execute = async (command, args, options) => {
    const result = await runCommand(command, args, options);
    if (args.includes("status") && args.includes("json")) {
      const status = JSON.parse(result.stdout);
      assertLocalReplayTarget(status.API_URL);
      anonKey = status.ANON_KEY ?? status.PUBLISHABLE_KEY;
    }
    return result;
  };
  await withCanonicalBaselineDirectory({ root, environment }, async canonicalBaselineDirectory => runLocalDisposableReplay({
    root, environment, execute, migrationLimit: 50, canonicalBaselineDirectory,
    afterMigrationLedgerValidated: async ({ target, executeSql }) => {
      assertLocalReplayTarget(target);
      const request = async (route, token, method = "GET", body) => {
        const url = new URL(route, target);
        assert.equal(url.origin, new URL(target).origin);
        assertLocalReplayTarget(url.href);
        return fetch(url, { method, redirect: "error", signal: AbortSignal.timeout(10000), headers: {
          apikey: anonKey, authorization: `Bearer ${token ?? anonKey}`, "content-type": "application/json", Prefer: "return=representation",
        }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      };
      const actor = async label => {
        const email = `local-detail-${label}-${randomBytes(6).toString("hex")}@example.invalid`;
        const password = randomBytes(24).toString("base64url");
        const signup = await request("/auth/v1/signup", null, "POST", { email, password });
        check(signup.status === 200, `LOCAL_${label}_SIGNUP`);
        const signedUp = await signup.json();
        const id = signedUp.user?.id ?? signedUp.id;
        assert.match(id ?? "", /^[0-9a-f-]{36}$/i);
        await executeSql(`UPDATE auth.users SET email_confirmed_at=now() WHERE id=${quote(id)}::uuid;`);
        const login = await request("/auth/v1/token?grant_type=password", null, "POST", { email, password });
        check(login.status === 200, `LOCAL_${label}_LOGIN`);
        const session = await login.json();
        assert.ok(session.access_token);
        const identity = await request("/auth/v1/user", session.access_token);
        check(identity.status === 200 && (await identity.json()).id === id, `GENUINE_LOCAL_${label}`);
        return { id, token: session.access_token };
      };
      const a = await actor("A"), b = await actor("B"), admin = await actor("ADMIN");
      await executeSql(`UPDATE public.profiles SET role='admin' WHERE id=${quote(admin.id)}::uuid;`);
      const ids = Object.fromEntries(["published", "draft", "definition", "spec", "draftSpec", "internalSpec", "source", "unrelated", "evidence"].map(key => [key, randomUUID()]));
      const definition = entry.definition;
      const dataColumns = Object.keys(publicRow).filter(key => key !== "id" && key !== "publication_status");
      const values = dataColumns.map(key => quote(typeof publicRow[key] === "object" && publicRow[key] !== null ? JSON.stringify(publicRow[key]) : publicRow[key]));
      await executeSql(`
        INSERT INTO public.devices (id,${dataColumns.join(",")},publication_status,schema_type)
        VALUES (${quote(ids.published)},${values.join(",")},'published','display_ar');
        INSERT INTO public.devices (id,slug,brand_key,brand_name,name,short_description,long_description,image_alt,category,route_label,route_description,publication_status,schema_type)
        SELECT ${quote(ids.draft)},'local-private-draft',brand_key,brand_name,name,short_description,long_description,image_alt,category,route_label,route_description,'draft',schema_type FROM public.devices WHERE id=${quote(ids.published)};
        INSERT INTO public.device_spec_definitions (id,key,group_key,label,value_type,applicable_schema_types)
        VALUES (${quote(ids.definition)},${quote(definition.key)},${quote(definition.groupKey)},${quote(definition.label)},'text',ARRAY['display_ar']::public.device_schema_type[]);
        INSERT INTO public.device_specs (id,device_id,spec_definition_id,state,value_text,raw_value,note,updated_by,confidence,variant)
        VALUES (${quote(ids.spec)},${quote(ids.published)},${quote(ids.definition)},'KNOWN',${quote(entry.value)},'PRIVATE_RAW_SENTINEL','PRIVATE_NOTE_SENTINEL',${quote(admin.id)},'HIGH',''),
          (${quote(ids.draftSpec)},${quote(ids.draft)},${quote(ids.definition)},'KNOWN','PRIVATE_DRAFT_SENTINEL',null,null,null,'HIGH',''),
          (${quote(ids.internalSpec)},${quote(ids.published)},${quote(ids.definition)},'UNKNOWN_UNVERIFIED',null,'PRIVATE_RESEARCH_SENTINEL',null,null,'LOW','internal');
        INSERT INTO public.device_sources (id,publisher,title,url,source_type,accessed_at)
        VALUES (${quote(ids.source)},'Local fixture',null,'https://example.invalid/detail-source','official_spec_sheet','2026-10-04'),
          (${quote(ids.unrelated)},'PRIVATE_UNRELATED_SOURCE',null,'https://example.invalid/unrelated-source','official_spec_sheet','2026-10-04');
        INSERT INTO public.device_source_links (device_id,source_id,note) VALUES (${quote(ids.published)},${quote(ids.source)},'PRIVATE_LINK_NOTE');
        INSERT INTO public.device_spec_evidence (id,device_spec_id,source_id,claimed_value,note)
        VALUES (${quote(ids.evidence)},${quote(ids.spec)},${quote(ids.source)},${quote(entry.value)},'PRIVATE_EVIDENCE_NOTE');
        INSERT INTO public.catalog_audit_events (actor_id,entity_type,entity_id,action,changed_fields)
        VALUES (${quote(admin.id)},'device',${quote(ids.published)},'local-test','{"private":"PRIVATE_AUDIT_SENTINEL"}');
      `);
      const denied = async (route, token, name, method = "GET", body) => {
        const response = await request(route, token, method, body);
        const payload = await response.json();
        const expected = [401, 403].includes(response.status) && payload.code === "42501";
        // Existing invoker enforcement can reject a non-admin INSERT before
        // the WITH CHECK policy: its definition lookup is also RLS-filtered.
        const closedDefinition = method === "POST" && token && response.status === 400 && payload.code === "23514";
        if (!expected && !closedDefinition) receipt.failedResponse = {
          status: response.status, code: /^[A-Z0-9_]{1,32}$/.test(payload.code ?? "") ? payload.code : "UNKNOWN",
        };
        check(expected || closedDefinition, name);
        if (closedDefinition) receipt.assertions.push(`${name}_EXISTING_INVOKER_CONSTRAINT_REJECTION`);
      };
      // Preserve the original closed state as RED evidence before the additive candidate.
      await denied("/rest/v1/device_specs?select=value_text", null, "BASELINE_PUBLIC_STRUCTURED_READ_RED");
      await executeSql(`BEGIN;\n${migration}\nCOMMIT;\nNOTIFY pgrst, 'reload schema';`);
      // Reload has an explicit completion barrier, not a retry loop.
      await new Promise(resolve => setTimeout(resolve, 1000));
      const read = async (route, token, name) => {
        const response = await request(route, token);
        check(response.status === 200, name);
        return response.json();
      };
      const specs = await read(`/rest/v1/public_device_detail_specs?device_slug=eq.${publicRow.slug}`, null, "ANON_INVOKER_SPECS");
      check(specs.length === 1 && specs[0].value_text === entry.value, "PUBLIC_SOURCE_VALUE_EXACT");
      check((await read("/rest/v1/device_specs?select=id,state,value_text", null, "ANON_DIRECT_ALLOWED_COLUMNS")).length === 1, "DRAFT_AND_INTERNAL_ROWS_DENIED");
      for (const column of ["raw_value", "note", "updated_by"]) await denied(`/rest/v1/device_specs?select=${column}`, null, `ANON_${column}_DENIED`);
      for (const [table, column] of [["device_source_links", "note"], ["device_spec_evidence", "note"], ["catalog_audit_events", "actor_id"]]) await denied(`/rest/v1/${table}?select=${column}`, null, `ANON_${table}_PRIVATE_DENIED`);
      const sources = await read(`/rest/v1/public_device_detail_sources?device_slug=eq.${publicRow.slug}`, null, "ANON_INVOKER_SOURCES");
      const evidence = await read(`/rest/v1/public_device_detail_evidence?device_slug=eq.${publicRow.slug}`, null, "ANON_INVOKER_EVIDENCE");
      check(sources.length === 1 && evidence.length === 1, "PUBLIC_REACHABLE_SOURCES_ONLY");
      check((await read("/rest/v1/device_sources?select=id,publisher", null, "ANON_DIRECT_SOURCES")).length === 1, "UNRELATED_SOURCE_DENIED");
      check((await read("/rest/v1/public_device_detail_specs?device_slug=eq.local-private-draft", null, "DRAFT_PROJECTION_QUERY")).length === 0, "DRAFT_PROJECTION_EMPTY");
      check(!/PRIVATE_|raw_value|updated_by|"note"/.test(JSON.stringify([specs, sources, evidence])), "NO_PRIVATE_PROJECTION_LEAKAGE");
      for (const [label, owner] of [["A", a], ["B", b]]) {
        check((await read("/rest/v1/device_specs?select=*", owner.token, `${label}_DIRECT_TABLE_REQUEST`)).length === 0, `${label}_ADMIN_ONLY_RLS_PRESERVED`);
        await denied("/rest/v1/device_specs", owner.token, `${label}_WRITE_DENIED`, "POST", { device_id: ids.published, spec_definition_id: ids.definition, state: "NOT_DISCLOSED", confidence: "LOW", variant: label });
        const unchanged = await executeSql(`SELECT count(*) AS unauthorized_rows FROM public.device_specs WHERE variant=${quote(label)};`);
        check(/\b0\b/.test(unchanged), `${label}_NO_WRITE_EFFECT`);
        check((await read("/rest/v1/catalog_audit_events?select=*", owner.token, `${label}_AUDIT_REQUEST`)).length === 0, `${label}_AUDIT_DENIED`);
      }
      await denied("/rest/v1/device_specs", null, "ANON_WRITE_DENIED", "POST", {});
      const adminRows = await read(`/rest/v1/device_specs?select=raw_value,note,updated_by&id=eq.${ids.spec}`, admin.token, "ADMIN_INTERNAL_READ_PRESERVED");
      check(adminRows.length === 1 && adminRows[0].note === "PRIVATE_NOTE_SENTINEL", "ADMIN_PRIVATE_FIELDS_PRESERVED");
      const update = await request(`/rest/v1/device_specs?id=eq.${ids.spec}`, admin.token, "PATCH", { note: "PRIVATE_ADMIN_WRITE_SENTINEL" });
      check(update.status === 200 && (await update.json())[0].note === "PRIVATE_ADMIN_WRITE_SENTINEL", "ADMIN_WRITE_TRIGGER_PRESERVED");
      return { status: "PASS" };
    },
  }));
  receipt.status = "PASS";
  receipt.cleanup = "PASS";
  receipt.migration = migrations[0];
}

try { await main(); } catch (error) {
  receipt.firstFailure = error instanceof assert.AssertionError ? error.message : "LOCAL_REPLAY_OR_TOOLING_FAILED";
  process.exitCode = 1;
} finally {
  await mkdir(artifactRoot, { recursive: true });
  const file = path.join(artifactRoot, `${runId}.json`);
  await writeFile(file, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
  console.log(`PUBLIC_DEVICE_DETAIL_LOCAL=${receipt.status}`);
  console.log(`ASSERTIONS=${receipt.assertions.length}`);
  if (receipt.firstFailure) console.log(`FIRST_FAIL=${receipt.firstFailure}`);
  console.log(`RECEIPT=${file}`);
}
