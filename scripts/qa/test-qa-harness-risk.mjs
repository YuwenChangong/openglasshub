import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  RiskClassificationError,
  classifyChanges,
  collectChangedPaths,
  resolveComparisonBase,
} from './risk.mjs';

test('classifies styling as LOW and device changes as MEDIUM with dependencies', () => {
  const styling = classifyChanges({ paths: ['src/styles/site.css'] });
  assert.deepEqual(styling.directAreas, ['frontend']);
  assert.deepEqual(styling.expandedAreas, ['frontend']);
  assert.equal(styling.risk, 'LOW');
  assert.deepEqual(styling.escalationReasons, []);

  const devices = classifyChanges({ paths: ['src/pages/devices/example.astro'] });
  assert.deepEqual(devices.directAreas, ['devices']);
  assert.deepEqual(devices.expandedAreas, ['devices', 'products', 'search', 'seo']);
  assert.equal(devices.risk, 'MEDIUM');
});

test('fails closed for high-risk migration, auth, security, Wrangler, and provider paths', () => {
  const result = classifyChanges({
    paths: [
      'wrangler.toml',
      'supabase/migrations/20260902042807_forward_reconcile_devices.sql',
      'src/pages/auth/callback.astro',
      'src/lib/server/permissions.ts',
      'src/lib/supabase-server.ts',
    ],
  });
  assert.equal(result.risk, 'HIGH');
  assert.equal(result.releaseRequired, true);
  assert.deepEqual(result.directAreas, ['auth', 'cloudflare', 'database', 'security', 'supabase-config']);
  assert.deepEqual(result.escalationReasons, [
    'HIGH_RISK_AREA:auth',
    'HIGH_RISK_AREA:cloudflare',
    'HIGH_RISK_AREA:database',
    'HIGH_RISK_AREA:security',
    'HIGH_RISK_AREA:supabase-config',
    'RELEASE_REQUIRED:qa:release',
  ]);
});

test('uses only manifest-backed areas and maps unmatched source or config paths fail-closed', () => {
  const compareLike = classifyChanges({ paths: ['src/pages/compare/[slug].astro'] });
  assert.equal(compareLike.directAreas.includes('compare'), false);
  assert.deepEqual(compareLike.directAreas, ['frontend']);

  const unknownConfig = classifyChanges({ paths: ['custom-provider.config.mjs'] });
  assert.deepEqual(unknownConfig.directAreas, ['security']);
  assert.equal(unknownConfig.risk, 'HIGH');
});

test('classifies nested runtime configuration and environment files as HIGH risk', () => {
  const result = classifyChanges({
    paths: [
      '.dev.vars',
      'config/provider.yaml',
      'config/default.yaml',
      'infra/wrangler.toml',
      'infra/deployment.json',
      'public/runtime-config.json',
    ],
  });
  assert.deepEqual(result.directAreas, ['security']);
  assert.equal(result.risk, 'HIGH');
  assert.equal(result.releaseRequired, true);
});

test('explicit feature area is a hint and cannot downgrade a changed high-risk path', () => {
  const result = classifyChanges({
    paths: ['src/pages/auth/callback.astro'],
    explicitArea: 'devices',
  });
  assert.deepEqual(result.directAreas, ['auth', 'devices']);
  assert.equal(result.risk, 'HIGH');
  assert.equal(result.releaseRequired, true);
  assert.equal(result.escalationReasons.at(-1), 'RELEASE_REQUIRED:qa:release');
});

test('produces deterministic normalized and deduplicated output', () => {
  const first = classifyChanges({
    paths: ['src\\pages\\devices\\example.astro', 'src/styles/site.css', 'src/pages/devices/example.astro'],
  });
  const second = classifyChanges({
    paths: ['src/pages/devices/example.astro', 'src/styles/site.css'],
  });
  assert.deepEqual(first, second);
  assert.deepEqual(first.paths, ['src/pages/devices/example.astro', 'src/styles/site.css']);
});

test('collects staged, unstaged, and untracked paths from a temporary offline git repository', () => {
  const repo = mkdtempSync(join(tmpdir(), 'openglass-qa-risk-'));
  try {
    const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
    git(['init', '--quiet']);
    git(['config', 'core.autocrlf', 'false']);
    git(['config', 'user.email', 'qa@example.invalid']);
    git(['config', 'user.name', 'QA Harness']);
    writeFileSync(join(repo, 'staged.txt'), 'initial\n');
    writeFileSync(join(repo, 'unstaged.txt'), 'initial\n');
    git(['add', 'staged.txt', 'unstaged.txt']);
    git(['commit', '--quiet', '-m', 'initial']);
    const baseSha = git(['rev-parse', 'HEAD']);
    writeFileSync(join(repo, 'staged.txt'), 'changed\n');
    git(['add', 'staged.txt']);
    writeFileSync(join(repo, 'unstaged.txt'), 'changed\n');
    writeFileSync(join(repo, 'untracked.txt'), 'new\n');

    assert.deepEqual(collectChangedPaths({ baseSha, cwd: repo }), [
      'staged.txt', 'unstaged.txt', 'untracked.txt',
    ]);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('resolves a merge-base for a divergent feature branch and rejects unproven main divergence', () => {
  const repo = mkdtempSync(join(tmpdir(), 'openglass-qa-risk-'));
  try {
    const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
    git(['init', '--quiet', '--initial-branch=main']);
    git(['config', 'core.autocrlf', 'false']);
    git(['config', 'user.email', 'qa@example.invalid']);
    git(['config', 'user.name', 'QA Harness']);
    writeFileSync(join(repo, 'file.txt'), 'initial\n');
    git(['add', 'file.txt']);
    git(['commit', '--quiet', '-m', 'initial']);
    const initial = git(['rev-parse', 'HEAD']);
    git(['branch', 'origin/main']);
    git(['switch', '--quiet', '-c', 'feature/qa-risk']);
    writeFileSync(join(repo, 'feature.txt'), 'feature\n');
    git(['add', 'feature.txt']);
    git(['commit', '--quiet', '-m', 'feature']);
    assert.equal(resolveComparisonBase({ branch: 'feature/qa-risk', mainRef: 'origin/main', cwd: repo }), initial);

    assert.throws(
      () => resolveComparisonBase({ branch: 'main', mainRef: 'origin/main', cwd: repo }),
      (error) => error instanceof RiskClassificationError && error.code === 'BASE_UNRESOLVED',
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
