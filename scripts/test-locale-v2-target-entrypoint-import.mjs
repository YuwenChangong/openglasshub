import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = fileURLToPath(new URL('..', import.meta.url));
const modules = [
  './test-user-preferences-schema.mjs',
  './test-user-preferences-rls-local.mjs',
  './lib/catalog-canonical-import.mjs',
  './qa/local-disposable-supabase-replay.mjs',
  './test-global-locale-v2-acceptance-local.mjs',
].map(name => new URL(name, import.meta.url).href);
const allowed = ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOME', 'COMSPEC'];
const env = Object.fromEntries(allowed.filter(key => process.env[key]).map(key => [key, process.env[key]]));

if (process.argv.includes('--old-red')) {
  test('real schema owner must import with no Node eval entrypoint', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(modules[0])});`],
      { cwd: root, env, encoding: 'utf8', timeout: 20000, windowsHide: true });
    assert.match(result.stderr, /ERR_INVALID_ARG_TYPE/);
    assert.match(result.stderr, /pathToFileURL/);
    assert.match(result.stderr, /test-user-preferences-schema\.mjs:14/);
    assert.equal(result.status, 0, 'PATH_TO_FILE_URL_UNDEFINED');
  });
} else {
  for (const [name, cwd] of [['repository', root], ['alternate', tmpdir()]]) {
    test(`fresh eval import of the real target dependency graph is side-effect-free from ${name} cwd`, () => {
      const probe = `
        import assert from 'node:assert/strict';
        import http from 'node:http'; import https from 'node:https';
        import net from 'node:net'; import tls from 'node:tls'; import dgram from 'node:dgram';
        import dns from 'node:dns'; import cp from 'node:child_process';
        import fs from 'node:fs'; import fsp from 'node:fs/promises';
        import { fileURLToPath } from 'node:url';
        import { syncBuiltinESMExports } from 'node:module';
        assert.equal(process.argv[1], undefined);
        let network = 0, subprocess = 0, writes = 0;
        const denyNetwork = () => { network++; throw Error('IMPORT_NETWORK_FORBIDDEN'); };
        const denyProcess = () => { subprocess++; throw Error('IMPORT_PROCESS_FORBIDDEN'); };
        const denyWrite = () => { writes++; throw Error('IMPORT_WRITE_FORBIDDEN'); };
        globalThis.fetch = globalThis.WebSocket = denyNetwork;
        for (const module of [http, https]) for (const key of ['request', 'get']) module[key] = denyNetwork;
        net.connect = net.createConnection = tls.connect = dgram.createSocket = denyNetwork;
        net.Socket.prototype.connect = net.Server.prototype.listen = denyNetwork;
        for (const key of ['lookup', 'resolve']) { dns[key] = dns.promises[key] = denyNetwork; }
        for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[key] = denyProcess;
        for (const key of ['writeFile', 'appendFile', 'mkdir', 'mkdtemp', 'rm', 'unlink', 'rename', 'copyFile']) fs[key] = fs[key + 'Sync'] = fsp[key] = denyWrite;
        fs.createWriteStream = denyWrite;
        syncBuiltinESMExports();
        void process.stdin; void process.stdout; void process.stderr;
        const before = JSON.stringify(process.env), handles = process._getActiveHandles().length;
        const urls = ${JSON.stringify(modules)}, loaded = [];
        for (const url of urls) {
          assert.equal(typeof fileURLToPath(url), 'string');
          await fsp.access(fileURLToPath(url));
          loaded.push(await import(url));
        }
        assert.equal(typeof loaded[0].preferenceMigration, 'function');
        assert.equal(typeof loaded[1].preparePreferenceRunEnvironment, 'function');
        assert.equal(typeof loaded[4].runLocaleV2Acceptance, 'function');
        assert.equal(JSON.stringify(process.env), before);
        assert.equal(process._getActiveHandles().length, handles);
        assert.equal(network, 0); assert.equal(subprocess, 0); assert.equal(writes, 0);
        console.log('TARGET_ENTRYPOINT_IMPORT=PASS;SIDE_EFFECT_FREE=true;DEPENDENCY_PATHS_EXIST=true');
      `;
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe],
        { cwd, env, encoding: 'utf8', timeout: 20000, windowsHide: true });
      assert.equal(result.status, 0, result.stderr || result.error?.message);
      assert.equal(result.stdout.trim(), 'TARGET_ENTRYPOINT_IMPORT=PASS;SIDE_EFFECT_FREE=true;DEPENDENCY_PATHS_EXIST=true');
    });
  }
  test('schema CLI still executes directly and does not manufacture a missing entrypoint', () => {
    const result = spawnSync(process.execPath, ['scripts/test-user-preferences-schema.mjs'],
      { cwd: root, env, encoding: 'utf8', timeout: 20000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.equal(result.stdout.trim(), 'USER_PREFERENCES_SCHEMA=PASS');
  });
}
