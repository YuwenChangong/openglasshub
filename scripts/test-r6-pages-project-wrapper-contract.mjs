import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const wrapper = process.env.R6_PROJECT_WRAPPER_PATH ?? "C:\\Users\\1\\OpenGlassHub-R6-Proof\\start-r6-detached-secure.ps1";
const source = await readFile(wrapper, "utf8");
assert.match(source, /\[switch\]\$PreparePagesProjectAuthDryRunAttestation/);
assert.match(source, /function Invoke-PreparePagesProjectAuthDryRunAttestation[\s\S]*?run-cloudflare-pages-project-metadata-preparation\.mjs/);
assert.match(source, /PREPARE_PROJECT_AUTH_DRY_RUN_ATTESTATION/);
assert.match(source, /cloudflare-pages-project-get\.mjs/);
assert.match(source, /r6-pages-project-metadata-terminal-result-v1/);
assert.match(source, /\$selected = @\(\$ValidateOnly, \$AuthCheckOnly, \$DryRunOnly, \$ExecuteApprovedPhase, \$PrepareAuthDryRunAttestation, \$PreparePagesProjectAuthDryRunAttestation/);
assert.doesNotMatch(/function Invoke-PrepareAuthDryRunAttestation[\s\S]*?\n}\r?\n\r?\nfunction/.exec(source)?.[0] ?? "", /run-cloudflare-pages-project-metadata-preparation/);
assert.doesNotMatch(/function Invoke-PreparePagesProjectAuthDryRunAttestation[\s\S]*?\n}\r?\n\r?\nfunction/.exec(source)?.[0] ?? "", /account-id-stdin|Get-HiddenCloudflareAccountId|--account-id/);
const quoted = wrapper.replace(/'/g, "''");
execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference='Stop'; [void][scriptblock]::Create((Get-Content -Raw -LiteralPath '${quoted}'))`], { stdio: "pipe" });
console.log("R6_PAGES_PROJECT_WRAPPER_MODE_CONTRACT_OK distinct Project mode, fixed absolute entrypoint, no account parameter, and PowerShell 5.1 parse contract passed without execution");
