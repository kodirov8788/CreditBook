// Local-only disposable fixture lifecycle. Never accepts an existing target.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';

const digest = text => createHash('sha256').update(text).digest('hex');
export function fixtureEnvironment() {
  const env = { DOCKER_CONTEXT: 'colima', NEXT_TELEMETRY_DISABLED: '1' };
  for (const key of ['PATH', 'TMPDIR', 'LANG', 'LC_ALL']) if (process.env[key]) env[key] = process.env[key];
  return env;
}

// Separate filesystem ownership primitive for deterministic safety regressions.
// The returned methods close over the original inode and nonce, not user input.
export function createOwnedDirectory(kind = 'supabase') {
  assert.ok(kind === 'supabase' || kind === 'app', 'Only fixed fixture directory kinds are allowed');
  const workdir = mkdtempSync(kind === 'app' ? '/private/tmp/creditbook-g01-http-app.' : '/private/tmp/creditbook-g01-supabase.');
  const identity = lstatSync(workdir);
  const nonce = randomBytes(32).toString('hex');
  const marker = path.join(workdir, '.fixture-owner');
  writeFileSync(marker, nonce, { flag: 'wx', mode: 0o600 });
  let configHash;
  function verify() {
    const current = lstatSync(workdir);
    assert.ok(current.isDirectory() && !current.isSymbolicLink());
    assert.equal(realpathSync(workdir), workdir);
    assert.equal(current.dev, identity.dev); assert.equal(current.ino, identity.ino);
    assert.ok(lstatSync(marker).isFile() && !lstatSync(marker).isSymbolicLink());
    assert.equal(readFileSync(marker, 'utf8'), nonce, 'Ownership marker changed; refuse cleanup');
    assert.equal(existsSync(path.join(workdir, 'supabase/.temp/project-ref')), false, 'Linked targets are forbidden');
    if (configHash) {
      const supabaseDir = path.join(workdir, 'supabase');
      assert.ok(lstatSync(supabaseDir).isDirectory() && !lstatSync(supabaseDir).isSymbolicLink());
      const configPath = path.join(workdir, 'supabase/config.toml');
      assert.ok(lstatSync(configPath).isFile() && !lstatSync(configPath).isSymbolicLink());
      assert.equal(digest(readFileSync(configPath)), configHash, 'Config changed; refuse cleanup');
    }
  }
  return { workdir, nonce, verify,
    sealConfig() { verify(); configHash = digest(readFileSync(path.join(workdir, 'supabase/config.toml'))); },
    remove() { verify(); rmSync(workdir, { recursive: true }); },
  };
}

async function requireFreePort(port) {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

export async function provisionOwnedSupabase() {
  const env = fixtureEnvironment();
  const run = (command, args, options = {}) => {
    try { return execFileSync(command, args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000, ...options }).trim(); }
    catch (error) {
      // CLI output can contain keys. Never attach stdout/stderr/cause here.
      throw new Error(`Local fixture ${command} ${args[0]} failed (status ${error.status ?? 'unknown'}); output withheld`);
    }
  };
  assert.equal(run('supabase', ['--version']), '2.75.0');
  // No image downloads or dependency installation in this approved slice.
  for (const image of ['postgres:17.6.1.075', 'gotrue:v2.186.0', 'postgrest:v14.3', 'kong:2.8.1']) {
    run('docker', ['--context', 'colima', 'image', 'inspect', 'public.ecr.aws/supabase/' + image]);
  }
  await requireFreePort(54321); await requireFreePort(54322);
  const owned = createOwnedDirectory();
  const workdir = owned.workdir, project = path.basename(workdir);
  const network = 'creditbook-http-' + randomBytes(12).toString('hex');
  let networkId, starting = false, disposed = false;
  function verifyDockerOwnership() {
    owned.verify();
    if (networkId) {
      const info = JSON.parse(run('docker', ['--context', 'colima', 'network', 'inspect', networkId]))[0];
      assert.equal(info.Name, network); assert.equal(info.Labels['creditbook.fixture.owner'], owned.nonce);
    }
    const ids = run('docker', ['--context', 'colima', 'ps', '-aq', '--filter', 'label=com.supabase.cli.project=' + project]);
    for (const id of ids.split(/\s+/).filter(Boolean)) {
      const info = JSON.parse(run('docker', ['--context', 'colima', 'inspect', id]))[0];
      assert.equal(info.Config.Labels['com.supabase.cli.project'], project);
      assert.equal(info.NetworkSettings.Networks[network]?.NetworkID, networkId);
    }
  }
  function dispose() {
    if (disposed) return;
    verifyDockerOwnership(); // No destructive action before ownership checks.
    if (starting) run('supabase', ['stop', '--workdir', workdir, '--project-id', project, '--no-backup']);
    if (networkId) {
      const info = JSON.parse(run('docker', ['--context', 'colima', 'network', 'inspect', networkId]))[0];
      assert.equal(Object.keys(info.Containers ?? {}).length, 0, 'Never remove a network with attached containers');
      run('docker', ['--context', 'colima', 'network', 'rm', networkId]);
    }
    owned.remove(); disposed = true;
  }
  try {
    // A preexisting target cannot be adopted, even if it contains no data.
    assert.equal(run('docker', ['--context', 'colima', 'ps', '-aq', '--filter', 'label=com.supabase.cli.project=' + project]), '');
    assert.ok(!run('docker', ['--context', 'colima', 'volume', 'ls', '--format', '{{.Name}}']).split('\n').some(name => name.endsWith(project)));
    run('supabase', ['init', '--workdir', workdir, '--yes']);
    const configPath = path.join(workdir, 'supabase/config.toml');
    let config = readFileSync(configPath, 'utf8');
    config = config.replace(/^project_id = .*$/m, `project_id = "${project}"`)
      .replace(/^enable_anonymous_sign_ins = false$/m, 'enable_anonymous_sign_ins = true');
    assert.match(config, /^enable_anonymous_sign_ins = true$/m);
    writeFileSync(configPath, config); owned.sealConfig();
    networkId = run('docker', ['--context', 'colima', 'network', 'create', '--label', 'creditbook.fixture.owner=' + owned.nonce,
      '--opt', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1', network]);
    starting = true;
    run('supabase', ['start', '--workdir', workdir, '--network-id', network,
      '--exclude', 'realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor']);
    verifyDockerOwnership();
    for (const container of [`supabase_db_${project}`, `supabase_kong_${project}`]) {
      const info = JSON.parse(run('docker', ['--context', 'colima', 'inspect', container]))[0];
      const bindings = Object.values(info.NetworkSettings.Ports).flat().filter(Boolean);
      assert.ok(bindings.length > 0 && bindings.every(binding => binding.HostIp === '127.0.0.1'));
    }
    return { workdir, project, env, verify: verifyDockerOwnership, dispose };
  } catch {
    // If ownership cannot be re-proven, leave the fixture for explicit inspection.
    try { dispose(); } catch { throw new Error('Fixture setup/cleanup failed; ownership not proven. No forced cleanup attempted.'); }
    throw new Error('Fixture setup failed; only the newly owned target was cleaned. CLI output withheld.');
  }
}
