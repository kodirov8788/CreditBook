import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createOwnedDirectory, fixtureEnvironment } from '../../scripts/lib/owned-local-supabase.mjs';

test('fresh internally generated target can be sealed, verified and removed', () => {
  const owned = createOwnedDirectory();
  mkdirSync(path.join(owned.workdir, 'supabase'));
  writeFileSync(path.join(owned.workdir, 'supabase/config.toml'), 'local fixture');
  owned.sealConfig(); owned.verify(); owned.remove();
  assert.equal(existsSync(owned.workdir), false);
});

test('staged app uses the same ownership protection and fixed prefix', () => {
  const owned = createOwnedDirectory('app');
  assert.match(owned.workdir, /^\/private\/tmp\/creditbook-g01-http-app\./);
  const marker = path.join(owned.workdir, '.fixture-owner'), original = readFileSync(marker);
  writeFileSync(marker, 'replacement'); assert.throws(() => owned.remove());
  assert.ok(existsSync(owned.workdir)); writeFileSync(marker, original); owned.remove();
});

test('directory kind cannot be an arbitrary path', () => {
  assert.throws(() => createOwnedDirectory('/private/tmp/unrelated'));
});

test('existing caller-supplied path is rejected before any CLI or Docker use', () => {
  const unrelated = mkdtempSync('/private/tmp/creditbook-unrelated.');
  const sentinel = path.join(unrelated, 'keep.txt'); writeFileSync(sentinel, 'preserve');
  try {
    assert.throws(() => execFileSync(process.execPath,
      ['scripts/test-shop-read-http.mjs', unrelated], { cwd: new URL('../..', import.meta.url),
        env: { PATH: '/not-a-cli-path' }, stdio: ['ignore', 'pipe', 'pipe'] }), error => {
      assert.match(error.stderr.toString(), /No caller-supplied target allowed/); return true;
    });
    assert.equal(readFileSync(sentinel, 'utf8'), 'preserve');
  } finally { rmSync(unrelated, { recursive: true }); }
});

test('marker tampering prevents cleanup without deleting anything', () => {
  const owned = createOwnedDirectory();
  const marker = path.join(owned.workdir, '.fixture-owner'), original = readFileSync(marker);
  writeFileSync(marker, 'forged');
  assert.throws(() => owned.remove(), /Ownership marker changed/);
  assert.ok(existsSync(owned.workdir));
  writeFileSync(marker, original); owned.remove();
});

test('config tampering prevents cleanup', () => {
  const owned = createOwnedDirectory();
  mkdirSync(path.join(owned.workdir, 'supabase'));
  const config = path.join(owned.workdir, 'supabase/config.toml');
  writeFileSync(config, 'original'); owned.sealConfig(); writeFileSync(config, 'other project');
  assert.throws(() => owned.remove(), /Config changed/);
  assert.ok(existsSync(owned.workdir)); writeFileSync(config, 'original'); owned.remove();
});

test('linked project marker prevents cleanup', () => {
  const owned = createOwnedDirectory();
  mkdirSync(path.join(owned.workdir, 'supabase/.temp'), { recursive: true });
  const linked = path.join(owned.workdir, 'supabase/.temp/project-ref');
  writeFileSync(linked, 'not-allowed');
  assert.throws(() => owned.remove(), /Linked targets are forbidden/);
  assert.ok(existsSync(owned.workdir)); rmSync(linked); owned.remove();
});

test('replacing target path with symlink preserves the replacement and original', () => {
  const owned = createOwnedDirectory();
  const saved = owned.workdir + '-original', unrelated = mkdtempSync('/private/tmp/creditbook-unrelated.');
  renameSync(owned.workdir, saved); symlinkSync(unrelated, owned.workdir);
  try { assert.throws(() => owned.remove()); assert.ok(existsSync(unrelated)); assert.ok(existsSync(saved)); }
  finally { rmSync(owned.workdir); renameSync(saved, owned.workdir); owned.remove(); rmSync(unrelated, { recursive: true }); }
});

test('copying the marker into a replacement directory cannot transfer ownership', () => {
  const owned = createOwnedDirectory(), saved = owned.workdir + '-original';
  const marker = readFileSync(path.join(owned.workdir, '.fixture-owner'));
  renameSync(owned.workdir, saved); mkdirSync(owned.workdir);
  writeFileSync(path.join(owned.workdir, '.fixture-owner'), marker);
  try { assert.throws(() => owned.remove()); assert.ok(existsSync(saved)); assert.ok(existsSync(owned.workdir)); }
  finally { rmSync(owned.workdir, { recursive: true }); renameSync(saved, owned.workdir); owned.remove(); }
});

test('a sealed Supabase directory cannot be redirected through a symlink', () => {
  const owned = createOwnedDirectory(), dir = path.join(owned.workdir, 'supabase');
  const unrelated = mkdtempSync('/private/tmp/creditbook-unrelated.');
  mkdirSync(dir); writeFileSync(path.join(dir, 'config.toml'), 'same bytes'); owned.sealConfig();
  renameSync(dir, dir + '-original'); writeFileSync(path.join(unrelated, 'config.toml'), 'same bytes'); symlinkSync(unrelated, dir);
  try { assert.throws(() => owned.remove()); assert.equal(readFileSync(path.join(unrelated, 'config.toml'), 'utf8'), 'same bytes'); }
  finally { rmSync(dir); renameSync(dir + '-original', dir); owned.remove(); rmSync(unrelated, { recursive: true }); }
});

test('child environment never inherits hosted credentials or application env', () => {
  const originalToken = process.env.SUPABASE_ACCESS_TOKEN, originalDatabase = process.env.DATABASE_URL;
  process.env.SUPABASE_ACCESS_TOKEN = 'sentinel-not-a-token';
  process.env.DATABASE_URL = 'sentinel-not-a-dsn';
  try {
    const env = fixtureEnvironment();
    assert.equal(env.SUPABASE_ACCESS_TOKEN, undefined); assert.equal(env.DATABASE_URL, undefined);
    assert.ok(Object.keys(env).every(key => ['DOCKER_CONTEXT', 'NEXT_TELEMETRY_DISABLED', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL'].includes(key)));
  } finally {
    if (originalToken === undefined) delete process.env.SUPABASE_ACCESS_TOKEN; else process.env.SUPABASE_ACCESS_TOKEN = originalToken;
    if (originalDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalDatabase;
  }
});
