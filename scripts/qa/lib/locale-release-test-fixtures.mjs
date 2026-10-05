import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { manifest } from '../manifest.mjs';

export function legacyLocaleEvidence(commitSha) {
  return { ...structuredClone(manifest.areas['locale-settings'].checks[0].acceptedEvidence), commitSha };
}

export function createLegacyLocaleContractFixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'ogh-locale-release-fixture-'));
  const files = new Set();
  const write = (path, value) => {
    const file = join(cwd, path); mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, value); files.add(path);
  };
  const coverage = JSON.parse(readFileSync(new URL('../../../tests/fixtures/locale-ui-coverage.json', import.meta.url)));
  for (const entry of coverage.files) {
    write(entry.path, 'fixture source\n');
    for (const file of entry.evidence) write(file, 'fixture evidence\n');
  }
  write('tests/fixtures/locale-ui-coverage.json', JSON.stringify(coverage));
  write('package.json', JSON.stringify({ scripts: {
    'test:global-locale-contract': 'node scripts/test-global-locale-settings-contract.mjs',
    'test:global-locale-browser': 'node scripts/test-global-locale-browser.mjs',
    'test:global-locale-persistence-local': 'node scripts/test-global-locale-persistence-local.mjs',
  } }));
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  git(['init', '-q']); git(['add', '--', ...files]);
  git(['-c', 'user.name=Local QA', '-c', 'user.email=qa@example.invalid', 'commit', '-qm', 'owned historical fixture']);
  const qaManifest = structuredClone(manifest);
  qaManifest.areas['locale-settings'].checks[0].acceptedEvidence = legacyLocaleEvidence(git(['rev-parse', 'HEAD']));
  return { cwd, qaManifest };
}

export function createLocaleV2SourceFixture(root) {
  const cwd = mkdtempSync(join(tmpdir(), 'ogh-locale-v2-selector-fixture-'));
  const contractPath = 'scripts/qa/contracts/global-locale-settings-v2-owned-source.json';
  const contract = JSON.parse(readFileSync(join(root, contractPath)));
  const files = [contractPath, ...contract.ownedFiles, ...contract.excludedFiles.map(row => row.path)];
  for (const path of files) {
    const destination = join(cwd, path); mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, readFileSync(join(root, path)));
  }
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  git(['init', '-q']); git(['config', 'core.autocrlf', 'false']); git(['add', '--', ...files]);
  git(['-c', 'user.name=Local QA', '-c', 'user.email=qa@example.invalid', 'commit', '-qm', 'owned V2 source fixture']);
  return { cwd, head: git(['rev-parse', 'HEAD']) };
}
