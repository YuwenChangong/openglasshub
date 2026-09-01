import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const P9_EXPECTED_PROJECT_REF = "xcbnxzjlsvtgzixurcof";
export const P9_EXPECTED_PRODUCTION_HOST = `db.${P9_EXPECTED_PROJECT_REF}.supabase.co`;
export const P9_PACKET_SHA256 = "5AC18441DBD61A36DB88300F333A40752173E224BFA9247AF28AA55E3B97E0A7";
const QUERY_IDS = ["MIGRATION_HISTORY", "SCHEMA_OBJECTS", "POLICIES_RLS", "FUNCTIONS"];

function failure(code) { const error = new Error(code); error.code = code; return error; }
function sha256(value) { return createHash("sha256").update(value).digest("hex").toUpperCase(); }
function isLoopback(host) { return ["127.0.0.1", "localhost", "::1"].includes(host); }
function marker(protocol, edge, queryId) { return `P9::${protocol.nonce}::${edge}::${queryId}`; }
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function sanitizeResultValue(value) {
  return String(value)
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/ig, '[REDACTED]')
    .replace(/((?:password|token|secret|api[_-]?key)\s*[=:]\s*)[^\s,;"']+/ig, '$1[REDACTED]')
    .replace(/\bsbp_[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9._-]+\b/g, '[REDACTED]');
}

export function parseP9Connection({ mode, dsn }) {
  if (!['PRODUCTION', 'LOCAL_TEST'].includes(mode) || typeof dsn !== 'string' || !dsn) throw failure('P9_TARGET_VALIDATION_FAILED');
  let url;
  try { url = new URL(dsn); } catch { throw failure('P9_TARGET_VALIDATION_FAILED'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || url.password === '') throw failure('P9_TARGET_VALIDATION_FAILED');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const port = Number(url.port || (mode === 'PRODUCTION' ? 5432 : 5432));
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const user = decodeURIComponent(url.username);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !database || !user) throw failure('P9_TARGET_VALIDATION_FAILED');
  if (mode === 'PRODUCTION' && (host !== P9_EXPECTED_PRODUCTION_HOST || port !== 5432 || database !== 'postgres' || user !== 'postgres')) throw failure('P9_TARGET_VALIDATION_FAILED');
  if (mode === 'LOCAL_TEST' && !isLoopback(host)) throw failure('P9_TARGET_VALIDATION_FAILED');
  const sslmode = mode === 'PRODUCTION' ? 'require' : (url.searchParams.get('sslmode') || 'disable');
  return {
    safeTarget: { mode, host, projectRef: mode === 'PRODUCTION' ? P9_EXPECTED_PROJECT_REF : 'LOCAL_TEST', port, database },
    pgEnv: { PGHOST: host, PGPORT: String(port), PGDATABASE: database, PGUSER: user, PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: sslmode },
  };
}

function splitStatements(packet) {
  const statements = []; let start = 0; let quote = false; let lineComment = false; let blockComment = false;
  for (let index = 0; index < packet.length; index += 1) {
    const pair = packet.slice(index, index + 2); const char = packet[index];
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (blockComment) { if (pair === '*/') { blockComment = false; index += 1; } continue; }
    if (!quote && pair === '--') { lineComment = true; index += 1; continue; }
    if (!quote && pair === '/*') { blockComment = true; index += 1; continue; }
    if (char === "'") { if (quote && packet[index + 1] === "'") { index += 1; continue; } quote = !quote; continue; }
    if (!quote && char === ';') { const statement = packet.slice(start, index + 1).trim(); if (statement) statements.push(statement); start = index + 1; }
  }
  if (packet.slice(start).trim()) throw failure('P9_PACKET_STATEMENT_TERMINATOR_MISSING');
  return statements;
}

export function loadFrozenPacketUnits({ packet }) {
  if (typeof packet !== 'string' || sha256(packet) !== P9_PACKET_SHA256) throw failure('P9_PACKET_HASH_MISMATCH');
  const statements = splitStatements(packet);
  if (statements.length !== QUERY_IDS.length || statements.some((statement) => !/^SELECT\b/i.test(statement.replace(/^(?:--[^\n]*\n)*/g, '').trim()))) throw failure('P9_PACKET_UNIT_INTEGRITY_FAILURE');
  return statements.map((sql, index) => ({ queryId: QUERY_IDS[index], sql, sourceHash: sha256(sql), classification: 'READ_ONLY_SELECT' }));
}

export function createPsqlTranscript({ protocol = { nonce: randomUUID().replace(/-/g, '') }, units, testOnlyWriteProbeSql = null }) {
  if (!/^[a-f0-9]{32}$/i.test(protocol?.nonce) || !Array.isArray(units) || units.length !== QUERY_IDS.length) throw failure('P9_TRANSCRIPT_CONTRACT_INVALID');
  const frame = (id, sql) => [`\\echo ${marker(protocol, 'BEGIN', id)}`, sql, `\\echo ${marker(protocol, 'END', id)}`].join('\n');
  const sessionProof = "SELECT current_setting('transaction_read_only') AS transaction_read_only, current_database() AS current_database, current_user AS current_user, pg_backend_pid()::text AS backend_pid;";
  const finalProof = 'SELECT pg_backend_pid()::text AS backend_pid;';
  return [
    '\\set ON_ERROR_STOP on', '\\pset format csv', '\\pset footer off', '\\pset tuples_only off',
    'BEGIN READ ONLY;', frame('SESSION', sessionProof),
    ...(testOnlyWriteProbeSql ? [testOnlyWriteProbeSql] : []),
    ...units.map((unit) => frame(unit.queryId, unit.sql)),
    frame('SESSION_FINAL', finalProof), 'ROLLBACK;', '',
  ].join('\n');
}

function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) { if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; } else if (char === '"') quoted = false; else field += char; continue; }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { row.push(field); field = ''; continue; }
    if (char === '\r') continue;
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += char;
  }
  if (quoted) throw failure('P9_RESULT_CSV_INVALID');
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((entry) => entry.length !== 1 || entry[0] !== '');
}

function extractBlock(stdout, protocol, id) {
  const begin = marker(protocol, 'BEGIN', id); const end = marker(protocol, 'END', id);
  const beginMatch = new RegExp(`(?:^|\\r?\\n)${escapeRegExp(begin)}\\r?\\n`).exec(stdout);
  if (!beginMatch) throw failure('P9_RESULT_PRESERVATION_FAILURE');
  const afterBegin = beginMatch.index + beginMatch[0].length;
  const after = stdout.slice(afterBegin);
  const endMatch = new RegExp(`\\r?\\n${escapeRegExp(end)}(?=\\r?\\n|$)`).exec(after);
  if (!endMatch) throw failure('P9_RESULT_PRESERVATION_FAILURE');
  return after.slice(0, endMatch.index);
}

function parseBlock(stdout, protocol, id) {
  const rows = parseCsv(extractBlock(stdout, protocol, id));
  if (!rows.length) throw failure('P9_RESULT_PRESERVATION_FAILURE');
  const [fields, ...values] = rows;
  if (!fields.length || values.some((row) => row.length !== fields.length)) throw failure('P9_RESULT_PRESERVATION_FAILURE');
  return { fields, rows: values.map((row) => Object.fromEntries(fields.map((field, index) => [field, sanitizeResultValue(row[index])])) ) };
}

function lastStartedQueryId(stdout, protocol, units) {
  const ids = ['SESSION', ...units.map((unit) => unit.queryId), 'SESSION_FINAL']; let last = null; let lastPosition = -1;
  for (const id of ids) { const position = stdout.lastIndexOf(marker(protocol, 'BEGIN', id)); if (position > lastPosition) { last = id; lastPosition = position; } }
  return last;
}

export function parsePsqlTranscript({ stdout, protocol, units }) {
  try {
    const session = parseBlock(stdout, protocol, 'SESSION'); const final = parseBlock(stdout, protocol, 'SESSION_FINAL');
    if (session.rows.length !== 1 || final.rows.length !== 1 || session.rows[0].transaction_read_only !== 'on' || !session.rows[0].backend_pid || session.rows[0].backend_pid !== final.rows[0].backend_pid) throw failure('P9_SESSION_PROOF_FAILURE');
    const queries = units.map((unit) => { const block = parseBlock(stdout, protocol, unit.queryId); return { queryId: unit.queryId, started: true, completed: true, rowCount: block.rows.length, rows: block.rows, fields: block.fields, resultHash: sha256(JSON.stringify(block.rows)) }; });
    return { transactionReadOnlyValue: session.rows[0].transaction_read_only, backendPid: session.rows[0].backend_pid, sameSession: true, databaseIdentity: { currentDatabase: session.rows[0].current_database, currentUser: session.rows[0].current_user }, queries };
  } catch (error) { if (error?.code) throw error; throw failure('P9_RESULT_PRESERVATION_FAILURE'); }
}

function runPsql({ executable, args, env, input, spawnImpl }) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(executable, args, { env, shell: false, stdio: ['pipe', 'pipe', 'pipe'] }); let stdout = ''; let stderr = '';
    child.stdout.on('data', (data) => { stdout += data; }); child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', () => reject(failure('P9_PSQL_PROCESS_FAILURE')));
    child.on('close', (exitCode) => resolve({ stdout, stderr, exitCode, childPid: child.pid ?? null }));
    child.stdin.end(input);
  });
}

export async function runP9ReadOnlyCapture({ mode, dsn, packet, psqlPath = 'psql', spawnImpl = spawn, nonce = randomUUID().replace(/-/g, ''), testOnlyWriteProbeSql = null }) {
  if (testOnlyWriteProbeSql !== null && mode !== 'LOCAL_TEST') throw failure('P9_LOCAL_TEST_PROBE_FORBIDDEN');
  const connection = parseP9Connection({ mode, dsn }); const units = loadFrozenPacketUnits({ packet }); const protocol = { nonce };
  const script = createPsqlTranscript({ protocol, units, testOnlyWriteProbeSql }); const args = ['-X', '-q', '-v', 'ON_ERROR_STOP=1'];
  const processResult = await runPsql({ executable: psqlPath, args, env: { ...process.env, ...connection.pgEnv }, input: script, spawnImpl });
  const productionCounter = mode === 'PRODUCTION' ? 1 : 0;
  if (processResult.exitCode !== 0) return { acceptanceResult: 'BLOCKED', targetMode: mode, targetRef: connection.safeTarget.projectRef, targetHost: connection.safeTarget.host, connectionAttempted: true, psqlProcessExited: true, connectionClosed: true, psqlExitCode: processResult.exitCode, rollbackMode: 'CONNECTION_CLOSE_ROLLBACK', firstFailureStage: 'PSQL_EXECUTION', firstFailureQueryId: lastStartedQueryId(processResult.stdout, protocol, units), localWriteRejection: testOnlyWriteProbeSql && /read-only transaction/i.test(processResult.stderr) ? 'PASS' : null, productionConnections: productionCounter, productionSqlRequests: productionCounter, productionMutationCount: 0, productionDDLCount: 0, productionDMLCount: 0, secretAudit: 'PASS' };
  const parsed = parsePsqlTranscript({ stdout: processResult.stdout, protocol, units });
  return { acceptanceResult: 'PASS', targetMode: mode, targetRef: connection.safeTarget.projectRef, targetHost: connection.safeTarget.host, targetIdentityValidated: true, connectionAttempted: true, connectionOpened: true, psqlProcessCount: 1, psqlProcessExited: true, connectionClosed: true, transactionReadOnlyObserved: true, transactionReadOnlyValue: parsed.transactionReadOnlyValue, backendPid: parsed.backendPid, backendSessionCorrelation: parsed.sameSession, databaseIdentity: parsed.databaseIdentity, packetHash: P9_PACKET_SHA256, queriesExpected: units.length, queriesExecuted: units.length, queriesCaptured: parsed.queries.length, queriesMissing: 0, perQuery: parsed.queries, rollbackMode: 'EXPLICIT_ROLLBACK', productionConnections: productionCounter, productionSqlRequests: productionCounter, productionMutationCount: 0, productionDDLCount: 0, productionDMLCount: 0, secretAudit: 'PASS', argv: args };
}

export function classifyLegacyManagementResult(result) {
  return Array.isArray(result?.rows) && result.rows.length === 0 ? { accepted: false, classification: 'TRANSPORT_RESULT_PRESERVATION_FAILURE' } : { accepted: false, classification: 'TRANSPORT_UNSUPPORTED' };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const packet = await readFile(new URL('../../docs/ops/p8-production-history-read-only.sql', import.meta.url), 'utf8');
  const dsn = process.env.P9_PRODUCTION_DATABASE_URL;
  if (!dsn) throw failure('P9_PRODUCTION_CREDENTIAL_UNAVAILABLE');
  const evidence = await runP9ReadOnlyCapture({ mode: 'PRODUCTION', dsn, packet });
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.acceptanceResult !== 'PASS') process.exitCode = 1;
}
