import process from "node:process";
import { resolve } from "node:path";
import { analyzeMigrations } from "./local-supabase-migration-mirror.mjs";

const directory = resolve(process.argv[2] ?? "supabase/migrations");
const analysis = await analyzeMigrations(directory);
const duplicateGroups = analysis.duplicateGroups.map(({ version, files }) => ({ version, files: files.map(({ filename }) => filename) }));
console.log(JSON.stringify({ directory, files: analysis.files.length, uniqueVersions: analysis.uniqueVersionCount, duplicateGroups }, null, 2));
if (duplicateGroups.length) process.exitCode = 1;
