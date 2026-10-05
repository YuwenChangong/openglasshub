import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function preferenceMigration(root = process.cwd()) {
  const directory = path.join(root, "supabase/migrations");
  const names = (await readdir(directory)).filter(name => /^\d{14}_user_preferences\.sql$/.test(name));
  assert.ok(names.length <= 1, "Exactly one additive preference migration is allowed");
  if (!names.length) return undefined;
  return { path: path.join(directory, names[0]), version: names[0].slice(0,14), sql: await readFile(path.join(directory,names[0]), "utf8") };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const migration = await preferenceMigration();
  assert.ok(migration, "Missing additive user_preferences schema");
  for (const pattern of [
    /create table public\.user_preferences/i,
    /references auth\.users\(id\) on delete cascade/i,
    /locale_preference text not null default 'auto'/i,
    /check \(locale_preference in \('auto', 'zh-CN', 'en'\)\)/i,
    /revision integer not null default 1 check \(revision > 0\)/i,
    /enable row level security/i,
    /revoke all on table public\.user_preferences from public, anon, authenticated/i,
    /grant insert \(user_id, locale_preference\)/i,
    /grant update \(locale_preference\)/i,
    /for update to authenticated\s+using \(\(select auth\.uid\(\)\) = user_id\)\s+with check \(\(select auth\.uid\(\)\) = user_id\)/i,
    /security invoker/i,
    /set search_path = ''/i,
  ]) assert.match(migration.sql, pattern);
  assert.doesNotMatch(migration.sql, /security definer|grant[^;]*delete|country|theme|jsonb/i);
  console.log("USER_PREFERENCES_SCHEMA=PASS");
}
