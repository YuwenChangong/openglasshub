export const negativePrivilegedClientFixtures = [
  { name: "exported raw client return", source: "const key = SUPABASE_SERVICE_ROLE_KEY; export function createServiceRoleClient(): SupabaseClient { return client; }", finding: "exported-raw-client-return" },
  { name: "exported generic factory", source: "export function createServiceClient() { return client; }", finding: "exported-generic-client-factory" },
  { name: "raw client callback", source: "export function withServiceRoleClient(callback: (client: SupabaseClient) => void) { callback(client); }", finding: "exported-raw-client-callback" },
  { name: "arbitrary table wrapper", source: "function read(tableName: string) { return client.from(tableName); }", finding: "arbitrary-table-name" },
  { name: "arbitrary RPC wrapper", source: "function call(rpcName: string) { return client.rpc(rpcName); }", finding: "arbitrary-rpc-name" },
  { name: "privileged re-export", source: "export { createServiceRoleClient } from './privileged-client';", finding: "privileged-client-re-export" },
  { name: "auth admin surface", source: "function users() { return client.auth.admin.listUsers(); }", finding: "generic-auth-admin-exposure" },
  { name: "storage surface", source: "function objects() { return client.storage.listBuckets(); }", finding: "generic-storage-exposure" },
  { name: "exported service key", source: "export const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;", finding: "exported-service-role-environment" },
];
