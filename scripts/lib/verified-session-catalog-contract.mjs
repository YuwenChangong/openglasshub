import { catalogDigest } from "./verified-session-db-stage.mjs";

export const CATALOG_FAMILIES = Object.freeze([
  "schemas", "objects", "tables", "columns", "constraints", "indexes",
  "functions", "policies", "rls", "readAcl", "publication",
]);

export const CATALOG_SQL = Object.freeze({
  schemas: `SELECT n.nspname, pg_get_userbyid(n.nspowner) AS owner, n.nspacl::text AS acl,
        has_schema_privilege('anon', n.oid, 'USAGE') AS anon_usage,
        has_schema_privilege('anon', n.oid, 'CREATE') AS anon_create,
        has_schema_privilege('authenticated', n.oid, 'USAGE') AS authenticated_usage,
        has_schema_privilege('authenticated', n.oid, 'CREATE') AS authenticated_create,
        has_schema_privilege('service_role', n.oid, 'USAGE') AS service_usage,
        has_schema_privilege('service_role', n.oid, 'CREATE') AS service_create
      FROM pg_namespace n WHERE n.nspname IN ('private','public','storage') ORDER BY n.nspname`,
  objects: `SELECT 'relation' AS kind, n.nspname AS schema, c.relname AS name,
        c.relkind::text AS detail, pg_get_userbyid(c.relowner) AS owner
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relname LIKE 'ogh_%' AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      UNION ALL
      SELECT 'function', n.nspname, p.proname,
        pg_get_function_identity_arguments(p.oid), pg_get_userbyid(p.proowner)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE p.proname LIKE 'ogh_%' AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      UNION ALL
      SELECT 'type', n.nspname, t.typname, t.typtype::text, pg_get_userbyid(t.typowner)
      FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE t.typname LIKE 'ogh_%' AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      ORDER BY kind, schema, name, detail`,
  tables: `SELECT c.relname, c.relkind, pg_get_userbyid(c.relowner) AS owner, c.relacl::text AS acl,
        jsonb_build_object(
          'anon_select',has_table_privilege('anon',c.oid,'SELECT'),
          'anon_insert',has_table_privilege('anon',c.oid,'INSERT'),
          'anon_update',has_table_privilege('anon',c.oid,'UPDATE'),
          'anon_delete',has_table_privilege('anon',c.oid,'DELETE'),
          'authenticated_select',has_table_privilege('authenticated',c.oid,'SELECT'),
          'authenticated_insert',has_table_privilege('authenticated',c.oid,'INSERT'),
          'authenticated_update',has_table_privilege('authenticated',c.oid,'UPDATE'),
          'authenticated_delete',has_table_privilege('authenticated',c.oid,'DELETE'),
          'service_select',has_table_privilege('service_role',c.oid,'SELECT'),
          'service_insert',has_table_privilege('service_role',c.oid,'INSERT'),
          'service_update',has_table_privilege('service_role',c.oid,'UPDATE'),
          'service_delete',has_table_privilege('service_role',c.oid,'DELETE')
        ) AS effective_acl
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='private' AND c.relname LIKE 'ogh_%' AND c.relkind <> 'i' ORDER BY c.relname`,
  columns: `SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns WHERE table_schema='private' AND table_name LIKE 'ogh_%'
      ORDER BY table_name, ordinal_position`,
  constraints: `SELECT c.relname, pg_get_constraintdef(k.oid) AS definition
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='private' AND c.relname LIKE 'ogh_%' ORDER BY c.relname, definition`,
  indexes: `SELECT tablename, indexdef FROM pg_indexes WHERE schemaname='private' AND tablename LIKE 'ogh_%'
      ORDER BY tablename, indexname`,
  functions: `SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS arguments,
        pg_get_function_result(p.oid) AS result, pg_get_userbyid(p.proowner) AS owner,
        p.prosecdef, p.provolatile, p.proparallel, p.proisstrict, p.proleakproof,
        l.lanname AS language, p.proconfig, p.prosrc, p.proacl::text AS acl,
        has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
        has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
        has_function_privilege('service_role',p.oid,'EXECUTE') AS service_execute,
        pg_get_function_arguments(p.oid) AS arguments_with_defaults, p.proargdefaults::text AS defaults
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
      WHERE n.nspname='public' AND (p.proname LIKE 'ogh_%' OR p.proname='consume_verification_email_resend_limit')
      ORDER BY p.proname, arguments`,
  policies: `SELECT schemaname, tablename, policyname, permissive, roles::text AS roles, cmd, qual, with_check
      FROM pg_policies WHERE schemaname IN ('public','storage') ORDER BY schemaname, tablename, policyname`,
  rls: `SELECT n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('private','public','storage') AND c.relkind IN ('r','p')
      ORDER BY n.nspname,c.relname`,
  readAcl: `SELECT c.relname,
        has_table_privilege('anon',c.oid,'SELECT') AS anon_select,
        has_table_privilege('authenticated',c.oid,'SELECT') AS authenticated_select
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN ('devices','posts','circles','comments','news_articles','post_media')
      ORDER BY c.relname`,
  publication: `SELECT pubname, schemaname, tablename FROM pg_publication_tables
      WHERE schemaname='public' AND tablename='forum_notifications' ORDER BY pubname`,
});

export const CATALOG_FIELDS = Object.freeze({
  schemas: ["nspname", "owner", "acl", "anon_usage", "anon_create", "authenticated_usage", "authenticated_create", "service_usage", "service_create"],
  objects: ["kind", "schema", "name", "detail", "owner"],
  tables: ["relname", "relkind", "owner", "acl", "effective_acl"],
  columns: ["table_name", "column_name", "data_type", "is_nullable", "column_default"],
  constraints: ["relname", "definition"],
  indexes: ["tablename", "indexdef"],
  functions: ["proname", "arguments", "result", "owner", "prosecdef", "provolatile", "proparallel", "proisstrict", "proleakproof", "language", "proconfig", "prosrc", "acl", "anon_execute", "authenticated_execute", "service_execute", "arguments_with_defaults", "defaults"],
  policies: ["schemaname", "tablename", "policyname", "permissive", "roles", "cmd", "qual", "with_check"],
  rls: ["nspname", "relname", "relrowsecurity", "relforcerowsecurity"],
  readAcl: ["relname", "anon_select", "authenticated_select"],
  publication: ["pubname", "schemaname", "tablename"],
});

const BOOLEAN_FIELDS = new Set(["anon_usage", "anon_create", "authenticated_usage", "authenticated_create",
  "service_usage", "service_create", "prosecdef", "proisstrict", "proleakproof", "anon_execute",
  "authenticated_execute", "service_execute", "relrowsecurity", "relforcerowsecurity", "anon_select",
  "authenticated_select"]);
const ARRAY_FIELDS = new Set(["proconfig"]);
const EFFECTIVE_ACL_FIELDS = ["anon_select", "anon_insert", "anon_update", "anon_delete",
  "authenticated_select", "authenticated_insert", "authenticated_update", "authenticated_delete",
  "service_select", "service_insert", "service_update", "service_delete"];
const fail = () => { throw new Error("AUTH_A_CATALOG_CONTRACT_INVALID"); };

export function catalogPacket() {
  return CATALOG_FAMILIES.map((family, index) =>
    `-- CATALOG_${String(index + 1).padStart(2, "0")}: ${family}\nSELECT encode(convert_to(row_to_json(q)::text, 'UTF8'), 'hex') AS payload FROM (\n${CATALOG_SQL[family]}\n) AS q;`).join("\n\n") + "\n";
}

function validateRow(family, row) {
  if (!row || Object.getPrototypeOf(row) !== Object.prototype ||
    JSON.stringify(Object.keys(row).sort()) !== JSON.stringify([...CATALOG_FIELDS[family]].sort())) fail();
  for (const [key, value] of Object.entries(row)) {
    if (key === "effective_acl") {
      if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
        JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...EFFECTIVE_ACL_FIELDS].sort()) ||
        Object.values(value).some((part) => typeof part !== "boolean")) fail();
    } else if (BOOLEAN_FIELDS.has(key)) {
      if (typeof value !== "boolean") fail();
    } else if (ARRAY_FIELDS.has(key)) {
      if (value !== null && (!Array.isArray(value) || value.some((part) => typeof part !== "string"))) fail();
    } else if (value !== null && typeof value !== "string") fail();
  }
  return row;
}

export function normalizeCatalogCapture(queryResults) {
  if (!Array.isArray(queryResults) || queryResults.length !== CATALOG_FAMILIES.length) fail();
  const snapshot = {};
  for (const [index, family] of CATALOG_FAMILIES.entries()) {
    const entry = queryResults[index];
    if (entry?.queryId !== `CATALOG_${String(index + 1).padStart(2, "0")}` || entry.completed !== true ||
      JSON.stringify(entry.fields) !== '["payload"]' || !Array.isArray(entry.rows) || entry.rowCount !== entry.rows.length) fail();
    snapshot[family] = entry.rows.map((row) => {
      if (!row || Object.keys(row).length !== 1 || typeof row.payload !== "string") fail();
      const encoded = row.payload;
      if (!/^(?:[a-f0-9]{2})+$/.test(encoded)) fail();
      const bytes = Buffer.from(encoded, "hex");
      if (bytes.toString("hex") !== encoded) fail();
      let decoded;
      try { decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
      catch { fail(); }
      return validateRow(family, decoded);
    });
  }
  if (!catalogDigest(snapshot)) fail();
  return snapshot;
}

export async function collectLocalCatalog(client) {
  const snapshot = {};
  for (const family of CATALOG_FAMILIES) {
    const result = await client.query(CATALOG_SQL[family]);
    snapshot[family] = result.rows.map((row) => validateRow(family, row));
  }
  if (!catalogDigest(snapshot)) fail();
  return snapshot;
}
