import pg from "pg";
import { prepareCatalogConnection } from "./catalog-production-migration-postgres-adapter.mjs";
import { fail } from "./catalog-production-import.mjs";

export async function prepareImportConnection(environment) {
  const config = await prepareCatalogConnection({ environment });
  return { ...config, statement_timeout: 120000, query_timeout: 125000, application_name: "catalog-stage-c-import" };
}
export function createImportPostgresAdapter({ config, Client = pg.Client }) {
  let used = false;
  return async (timeout = 10000) => {
    if (used) fail("IMPORT_RECONNECT_FORBIDDEN"); used = true;
    const client = new Client({ ...config, connectionTimeoutMillis: Math.max(1, Math.min(config.connectionTimeoutMillis ?? 10000, timeout)) }); let connected = false, broken = false, failure;
    client.on("error", error => { broken = true; failure = { code: /^[0-9A-Z]{5}$/.test(error?.code ?? "") ? error.code : undefined }; });
    try { await client.connect(); connected = true; } catch (error) { try { await client.end(); } catch {} throw error; }
    return {
      get connected() { return connected && !broken; },
      async query(text, values = [], timeout = 35000) { if (broken) throw failure; return client.query({ text, values, query_timeout: timeout }); },
      async close() { connected = false; await client.end(); },
    };
  };
}
