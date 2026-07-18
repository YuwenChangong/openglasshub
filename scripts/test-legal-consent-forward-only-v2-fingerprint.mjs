import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
const record=JSON.parse(await readFile('docs/ops/reconciliation/legal-consent-forward-only-fingerprint-v2.json','utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
for(const [file,expected] of Object.entries(record.artifacts)){const bytes=await readFile(file);assert.equal(hash(bytes),expected,`${file}: hash mismatch`);assert.equal(bytes.includes(13),false,`${file}: CRLF forbidden`);assert.equal(bytes.subarray(0,3).equals(Buffer.from([0xef,0xbb,0xbf])),false,`${file}: BOM forbidden`);assert.equal(bytes.at(-1),10,`${file}: final LF required`);for(const changed of [Buffer.concat([bytes,Buffer.from(' ')]),bytes.subarray(0,-1),Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),bytes]),Buffer.from(bytes.toString().replace(/\n/g,'\r\n'))])assert.notEqual(hash(changed),expected,`${file}: mutation accepted`)}
console.log(JSON.stringify({status:'PASS',artifacts:Object.keys(record.artifacts).length,rawByteChecks:true}));
