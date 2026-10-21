import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { systemDataDir, repoRoot } from '../config.ts';

// Official upstream image, pinned to the digest exercised by test:search:live.
const IMAGE = 'searxng/searxng@sha256:5ed0323b5f5f8701264ef65e239a2bd83cb57098f2b971fa30bf79c06eeae271';
const run = promisify(execFile);
const name = `opendots-search-${createHash('sha256').update(systemDataDir).digest('hex').slice(0, 12)}`;
let starting: Promise<string> | undefined;
let endpoint: string | undefined;

async function docker(args: string[], timeout = 15_000) {
  return (await run('docker', args, { timeout, maxBuffer: 128_000 })).stdout.trim();
}

async function inspect() {
  try {
    const raw = await docker(['inspect', '--format', '{{.State.Running}}|{{index .Config.Labels "opendots.search"}}|{{index .Config.Labels "opendots.search-config"}}', name]);
    const [running, owner, fingerprint] = raw.split('|');
    if (owner !== 'managed') throw new Error(`Le conteneur ${name} existe déjà et n’appartient pas à OpenDots.`);
    return { running: running === 'true', fingerprint };
  } catch (error) {
    if ((error as { code?: number }).code === 1 && /No such (object|container)/i.test((error as { stderr?: string }).stderr ?? '')) return null;
    throw error;
  }
}

async function healthy(base: string) {
  try {
    const res = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(1000) });
    return res.ok && (await res.text()).trim() === 'OK';
  } catch { return false; }
}

async function start(): Promise<string> {
  try { await docker(['info', '--format', '{{.ServerVersion}}'], 5000); }
  catch { throw new Error('SearXNG intégré nécessite Docker en cours d’exécution. Installe/démarre Docker, ou choisis Mwmbl dans les paramètres pour rechercher sans Docker.'); }
  const dir = join(systemDataDir, 'search');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const secretPath = join(dir, 'secret.key');
  try { await writeFile(secretPath, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const settings = JSON.parse(await readFile(join(repoRoot, 'apps/server/search/settings.json'), 'utf8'));
  settings.server.secret_key = (await readFile(secretPath, 'utf8')).trim();
  const extraArgs: string[] = [];
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
  let proxyHost = '';
  if (proxy) {
    settings.outgoing.proxies = { 'all://': [proxy] };
    const host = new URL(proxy).hostname;
    if (!isIP(host)) {
      const { address, family } = await lookup(host);
      proxyHost = `${host}:${family === 6 ? `[${address}]` : address}`;
      extraArgs.push('--add-host', proxyHost);
    }
  }
  let ca = '';
  if (process.env.CODEX_PROXY_CERT || process.env.SSL_CERT_FILE) {
    const base = process.env.SSL_CERT_FILE ?? '/etc/ssl/certs/ca-certificates.crt';
    ca = await readFile(base, 'utf8');
    if (process.env.CODEX_PROXY_CERT && process.env.CODEX_PROXY_CERT !== base) ca += `\n${await readFile(process.env.CODEX_PROXY_CERT, 'utf8')}`;
    if (ca.includes('PRIVATE KEY') || !ca.includes('BEGIN CERTIFICATE')) throw new Error('Le fichier de confiance TLS doit contenir uniquement des certificats publics.');
    const caPath = join(dir, 'ca.pem');
    await writeFile(caPath, ca, { mode: 0o644 });
    await chmod(caPath, 0o644); // readable by the container despite a restrictive host umask
    settings.outgoing.verify = '/run/opendots-ca.pem';
    extraArgs.push('--mount', `type=bind,src=${caPath},dst=/run/opendots-ca.pem,readonly`, '-e', 'SSL_CERT_FILE=/run/opendots-ca.pem');
  }
  const serialized = JSON.stringify(settings, null, 2);
  const fingerprint = createHash('sha256').update(IMAGE + serialized + ca + proxyHost).digest('hex');
  const settingsPath = join(dir, 'settings.yml'); // JSON is also valid YAML.
  let state = await inspect();
  if (state && state.fingerprint !== fingerprint) {
    await docker(['rm', '-f', name]); // inspect checked ownership first
    state = null;
  }
  if (!state) {
    await writeFile(settingsPath, serialized, { mode: 0o644 });
    await chmod(settingsPath, 0o644);
    try { await docker(['image', 'inspect', '--format', '{{.Id}}', IMAGE]); }
    catch { await docker(['pull', IMAGE], 180_000); }
    try {
      await docker(['run', '-d', '--name', name,
        '--label', 'opendots.search=managed', '--label', `opendots.search-config=${fingerprint}`,
        '--restart', 'unless-stopped', '--memory', '1g', '--pids-limit', '256',
        '-p', '127.0.0.1::8080',
        '--mount', `type=bind,src=${settingsPath},dst=/etc/searxng/settings.yml,readonly`,
        ...extraArgs, IMAGE], 30_000);
    } catch (error) {
      const raced = await inspect(); // another app process may have created it
      if (!raced || raced.fingerprint !== fingerprint) throw error;
    }
  } else if (!state.running) {
    await docker(['start', name], 30_000);
  }
  const port = await docker(['port', name, '8080/tcp']);
  if (!/^127\.0\.0\.1:\d+$/.test(port)) throw new Error('Le moteur local doit être accessible uniquement sur 127.0.0.1.');
  const base = `http://${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await healthy(base)) return base;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('SearXNG local n’est pas prêt après 30 secondes. Consulte les logs du conteneur avec la commande search:logs.');
}

export async function ensureLocalSearch(): Promise<string> {
  if (endpoint && await healthy(endpoint)) return endpoint;
  starting ??= start();
  try { endpoint = await starting; return endpoint; }
  finally { starting = undefined; }
}

export async function stopLocalSearch() {
  await docker(['info', '--format', '{{.ServerVersion}}'], 5000);
  if (await inspect()) await docker(['stop', name], 30_000);
  endpoint = undefined;
}

export async function localSearchLogs() {
  if (!await inspect()) throw new Error('Le moteur local n’a pas encore été démarré.');
  const result = await run('docker', ['logs', '--tail', '80', name], { maxBuffer: 64_000 });
  return result.stdout + result.stderr;
}
