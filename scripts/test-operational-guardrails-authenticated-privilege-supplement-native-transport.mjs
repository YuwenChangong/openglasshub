import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const script = await readFile("scripts/run-operational-guardrails-authenticated-privilege-supplement-native.ps1", "utf8");
assert.match(script, /Resolve-DnsName -Name \$directHost -Type AAAA -DnsOnly/);
assert.match(script, /Get-Command psql\.exe -CommandType Application/);
assert.match(script, /Get-NativePsqlPath -Commands \$psqlCommands/);
assert.match(script, /Test-NetConnection -ComputerName \$directHost -Port/);
assert.match(script, /& \$psqlPath -X -W -q --csv -v ON_ERROR_STOP=1/);
assert.match(script, /sslmode=require/);
assert.match(script, /\$validatorOutput = @\(& node \$validator \$temporaryCsv\)/);
assert.match(script, /New-ExclusiveTemporaryOutputFile/);
assert.match(script, /Move-ValidatedTemporaryOutput/);
assert.match(script, /Quarantine-OrDeleteTemporaryOutput/);
assert.match(script, /pooler\|supavisor/);
assert.doesNotMatch(script, /-W\s+[^\r\n]*password|password\s*=|ConvertFrom-SecureString/i);
assert.doesNotMatch(script, /docker run|PGPASSWORD=|PGPASSFILE=|postgresql:\/\/|SecureString/i);
console.log("operational-guardrails authenticated privilege native transport static contract: PASS");
