import pg from "pg";
import { prepareCatalogConnection } from "./catalog-production-migration-postgres-adapter.mjs";
import { fail, safeImportFailure } from "./catalog-production-import.mjs";

export async function prepareImportConnection(environment) {
  let config;
  try { config = await prepareCatalogConnection({ environment }); }
  catch (error) { fail(error?.code === "STAGE_B_CA_TRUST_INVALID" ? "IMPORT_CA_TRUST_INVALID" : "IMPORT_SESSION_POOLER_SOURCE_INVALID"); }
  return { ...config, statement_timeout: 120000, query_timeout: 125000, application_name: "catalog-stage-c-import" };
}
export function createImportPostgresAdapter({ config, Client = pg.Client }) {
  let used = false;
  return async (timeout = 10000) => {
    if (used) fail("IMPORT_RECONNECT_FORBIDDEN"); used = true;
    const client = new Client({ ...config, connectionTimeoutMillis: Math.max(1, Math.min(config.connectionTimeoutMillis ?? 10000, timeout)) }); let connected = false, broken = false, failure;
    client.on("error", error => { broken = true; failure = error; });
    try { await client.connect(); connected = true; } catch (error) { try { await client.end(); } catch {} throw error; }
    let closing;
    const close = () => { connected = false; return closing ??= client.end(); };
    return {
      get connected() { return connected && !broken; },
      async query(text, values = [], timeout = 35000) {
        if (broken) throw failure;
        try { return await client.query({ text, values, query_timeout: timeout }); }
        catch (error) {
          if (safeImportFailure(error, "SCHEMA", 0, connected).failureClass === "CLIENT_QUERY_TIMEOUT") {
            // pg's read timer rejects without cancelling an active server query.
            // End this session before a rollback can queue behind that query.
            broken = true; failure = error;
            try { await close(); } catch { /* The final close reports cleanup failure. */ }
          }
          throw error;
        }
      },
      close,
    };
  };
}
