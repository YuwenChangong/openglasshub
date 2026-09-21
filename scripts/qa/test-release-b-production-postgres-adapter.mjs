import assert from "node:assert/strict";

import { createReleaseBProductionPostgresAdapter } from "./lib/release-b-production-postgres-adapter.mjs";

const SESSION_DSN = "postgresql://postgres.xcbnxzjlsvtgzixurcof:test-only@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require";
const DIRECT_DSN = "postgresql://postgres:test-only@db.xcbnxzjlsvtgzixurcof.supabase.co:5432/postgres?sslmode=require";
const TRANSACTION_DSN = "postgresql://postgres.xcbnxzjlsvtgzixurcof:test-only@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require";

let clientConstructed = 0;
let connectCalls = 0;

class ConstructionOnlyClient {
  constructor() {
    clientConstructed += 1;
  }

  async connect() {
    connectCalls += 1;
  }
}

assert.equal(typeof createReleaseBProductionPostgresAdapter, "function");

const adapter = createReleaseBProductionPostgresAdapter({
  environment: {},
  Client: ConstructionOnlyClient,
});

assert.equal(clientConstructed, 0, "adapter construction must not construct Client");
assert.equal(connectCalls, 0, "adapter construction must not connect");
assert.equal(typeof adapter.createSession, "function");
assert.equal(typeof adapter.readPostcheck, "function");
assert(Object.isFrozen(adapter));

function createCountingClientClass({ failOnConnect = false, failOnQuery = false, failOnEnd = false } = {}) {
  const state = {
    constructed: 0,
    connectCalls: 0,
    queryCalls: 0,
    endCalls: 0,
    configs: [],
    queries: [],
  };

  class CountingClient {
    constructor(config) {
      state.constructed += 1;
      state.configs.push(config);
    }

    async connect() {
      state.connectCalls += 1;
      if (failOnConnect) throw Object.assign(new Error("synthetic connect failure"), { code: "SYNTHETIC_CONNECT" });
    }

    async query(sql, params) {
      state.queryCalls += 1;
      state.queries.push({ sql, params });
      if (failOnQuery) throw Object.assign(new Error("synthetic query failure"), { code: "SYNTHETIC_QUERY" });
      return { rows: [{ value: 7 }], rowCount: 1 };
    }

    async end() {
      state.endCalls += 1;
      if (failOnEnd) throw Object.assign(new Error("synthetic end failure"), { code: "SYNTHETIC_END" });
    }
  }

  return { Client: CountingClient, state };
}

async function assertRejectsWithoutClientConstruction({ dsn, pattern }) {
  const { Client, state } = createCountingClientClass();
  const candidate = createReleaseBProductionPostgresAdapter({
    environment: dsn ? { P9_PRODUCTION_DATABASE_URL: dsn } : {},
    Client,
  });

  await assert.rejects(() => candidate.createSession(), pattern);
  assert.equal(state.constructed, 0, "fail-closed validation must happen before Client construction");
  assert.equal(state.connectCalls, 0, "fail-closed validation must happen before connect");
}

await assertRejectsWithoutClientConstruction({
  dsn: null,
  pattern: /PRODUCTION_CONNECTION_SOURCE_UNAVAILABLE/,
});
await assertRejectsWithoutClientConstruction({
  dsn: TRANSACTION_DSN,
  pattern: /PRODUCTION_CONNECTION_SOURCE_UNAVAILABLE/,
});
await assertRejectsWithoutClientConstruction({
  dsn: DIRECT_DSN,
  pattern: /RELEASE_B_POSTGRES_ADAPTER_SESSION_POOLER_REQUIRED/,
});

const happyClient = createCountingClientClass();
const happyAdapter = createReleaseBProductionPostgresAdapter({
  environment: { P9_PRODUCTION_DATABASE_URL: SESSION_DSN },
  Client: happyClient.Client,
});

const session = await happyAdapter.createSession();
assert.equal(happyClient.state.constructed, 1, "SESSION_DSN constructs one Client inside createSession");
assert.equal(happyClient.state.connectCalls, 1, "SESSION_DSN connects once inside createSession");
assert.deepEqual(session.targetIdentity, {
  mode: "PRODUCTION",
  host: "aws-1-ap-northeast-1.pooler.supabase.com",
  projectRef: "xcbnxzjlsvtgzixurcof",
  port: 5432,
  database: "postgres",
  endpointClass: "SUPAVISOR_SESSION",
});
assert.deepEqual(await session.query("SELECT $1::int AS value", [7]), { rows: [{ value: 7 }], rowCount: 1 });
assert.deepEqual(happyClient.state.queries, [{ sql: "SELECT $1::int AS value", params: [7] }]);
await session.close();
await session.close();
assert.equal(happyClient.state.endCalls, 1, "close must end the client once");
assert.equal(happyClient.state.connectCalls, 1, "second close must not reconnect");

const failingConnect = createCountingClientClass({ failOnConnect: true });
const failingConnectAdapter = createReleaseBProductionPostgresAdapter({
  environment: { P9_PRODUCTION_DATABASE_URL: SESSION_DSN },
  Client: failingConnect.Client,
});
await assert.rejects(() => failingConnectAdapter.createSession(), /synthetic connect failure/);
assert.equal(failingConnect.state.constructed, 1);
assert.equal(failingConnect.state.connectCalls, 1);

const failingQuery = createCountingClientClass({ failOnQuery: true });
const failingQuerySession = await createReleaseBProductionPostgresAdapter({
  environment: { P9_PRODUCTION_DATABASE_URL: SESSION_DSN },
  Client: failingQuery.Client,
}).createSession();
await assert.rejects(() => failingQuerySession.query("SELECT 1", []), /synthetic query failure/);
assert.equal(failingQuery.state.queryCalls, 1);
await failingQuerySession.close();
assert.equal(failingQuery.state.endCalls, 1);

const failingEnd = createCountingClientClass({ failOnEnd: true });
const failingEndSession = await createReleaseBProductionPostgresAdapter({
  environment: { P9_PRODUCTION_DATABASE_URL: SESSION_DSN },
  Client: failingEnd.Client,
}).createSession();
await assert.rejects(() => failingEndSession.close(), /synthetic end failure/);
await assert.rejects(() => failingEndSession.close(), /synthetic end failure/);
assert.equal(failingEnd.state.endCalls, 1, "close failure must not trigger retry");
assert.equal(failingEnd.state.connectCalls, 1, "close failure must not reconnect");

// TLS evidence verified 2026-09-21:
// - node-postgres SSL config passes the ssl object to Node's TLSSocket and warns that connection-string sslmode can overwrite ssl config.
// - Supabase docs say sslmode=require prevents plaintext fallback, while verification needs verify-full/root-cert-equivalent driver configuration.
const tlsClient = createCountingClientClass();
await createReleaseBProductionPostgresAdapter({
  environment: { P9_PRODUCTION_DATABASE_URL: SESSION_DSN },
  Client: tlsClient.Client,
}).createSession();
const tlsConfig = tlsClient.state.configs[0];
assert.equal(tlsConfig.ssl?.rejectUnauthorized, true);
assert.equal(tlsConfig.ssl?.servername, "aws-1-ap-northeast-1.pooler.supabase.com");
assert.notEqual(tlsConfig.ssl?.rejectUnauthorized, false);

await assert.rejects(
  () => createReleaseBProductionPostgresAdapter({
    Client: tlsClient.Client,
  }).createSession({
    pgEnv: {
      PGHOST: "aws-1-ap-northeast-1.pooler.supabase.com",
      PGPORT: "5432",
      PGDATABASE: "postgres",
      PGUSER: "postgres.xcbnxzjlsvtgzixurcof",
      PGPASSWORD: "test-only",
      PGSSLMODE: "no-verify",
    },
    safeTarget: {
      mode: "PRODUCTION",
      host: "aws-1-ap-northeast-1.pooler.supabase.com",
      projectRef: "xcbnxzjlsvtgzixurcof",
      port: 5432,
      database: "postgres",
      endpointClass: "SUPAVISOR_SESSION",
    },
  }),
  /RELEASE_B_POSTGRES_ADAPTER_TLS_DOWNGRADE_FORBIDDEN/,
  "adapter TLS config fails closed on unsupported downgrade",
);

const observedPostcheckRow = {
  devices: 24,
  device_spec_definitions: 92,
  device_specs: 1488,
  device_sources: 39,
  device_source_links: 46,
  device_spec_evidence: 15,
  catalog_audit_events: 0,
  unique_slugs: 24,
  published_devices: 24,
  constraint_failures: 0,
  trigger_failures: 0,
  duplicate_failures: 0,
  conflict_evidence_failures: 0,
  unknown_unverified_known_data: 0,
  ray_ban_identity: "ray-ban-meta",
  unexpected_deletes: 0,
};

const postcheckSqlCalls = [];
const observedPostcheck = await adapter.readPostcheck({
  async queryReadOnly(sql, params) {
    postcheckSqlCalls.push({ sql, params });
    return {
      rows: [{
        ...observedPostcheckRow,
        devices: 23,
      }],
    };
  },
});

assert.equal(postcheckSqlCalls.length, 1, "readPostcheck must issue one fixed read-only verification query");
assert.match(postcheckSqlCalls[0].sql, /^\s*(?:WITH|SELECT)\b/i, "postcheck query must be read-only SQL");
assert.deepEqual(postcheckSqlCalls[0].params, [], "postcheck query must not depend on caller-supplied parameters");
assert.deepEqual(postcheckSqlCalls[0].sql.match(/\$[0-9]+/g), null, "postcheck query must not have unbound parameters");
assert.deepEqual(postcheckSqlCalls[0].sql.match(/\bexpected\b/gi), null, "adapter postcheck must not encode Release B expected-count policy");
assert.deepEqual(postcheckSqlCalls[0].sql.match(/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE)\b|\bsupabase_migrations\b/gi), null, "postcheck query must not contain mutation or migration-history SQL");
assert.deepEqual(observedPostcheck, {
  counts: {
    devices: 23,
    deviceSpecDefinitions: 92,
    deviceSpecs: 1488,
    deviceSources: 39,
    deviceSourceLinks: 46,
    deviceSpecEvidence: 15,
    catalogAuditEvents: 0,
  },
  uniqueSlugs: 24,
  publishedDevices: 24,
  conflictInvariants: "PASS",
  rayBanIdentity: "ray-ban-meta",
  unexpectedDeletes: 0,
});

const mutationGuardSqlCalls = [];
await adapter.readPostcheck({
  async queryReadOnly(sql, params) {
    mutationGuardSqlCalls.push({ sql, params });
    assert.match(sql, /^\s*(?:WITH|SELECT)\b/i, "postcheck must use SELECT/WITH only");
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE)\b|\bsupabase_migrations\b/i, "postcheck query must stay read-only and avoid migration history");
    return { rows: [observedPostcheckRow] };
  },
});
assert.equal(mutationGuardSqlCalls.length, 1, "mutation guard must observe the fixed postcheck query");

console.log("RELEASE_B_PRODUCTION_POSTGRES_ADAPTER_UNIT_OK");
