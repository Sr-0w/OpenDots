import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { companionGitBundle, setCompanionUpstream, type GitSnapshotRequest } from './shell.ts';
import { truncate } from '../util.ts';

const exec = promisify(execFile);
export interface GitPushRequest extends GitSnapshotRequest { repo: string; expectedSha: string; setUpstream?: boolean; token: string }

/** Deliberately excludes inherited GIT_*, loader variables and user config. */
export function brokerEnvironment(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin', HOME: home, XDG_CONFIG_HOME: home, LANG: 'C.UTF-8', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '' };
  for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']) if (process.env[name]) env[name] = process.env[name];
  const ca = process.env.SSL_CERT_FILE ?? process.env.CODEX_PROXY_CERT;
  if (ca) env.GIT_SSL_CAINFO = ca;
  return env;
}

export function gitPushArgs(r: Pick<GitPushRequest, 'repo' | 'branch' | 'expectedSha'>) {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(r.repo) || r.repo.split('/').some((v) => v === '.' || v === '..')) throw new Error('Dépôt GitHub invalide.');
  if (!/^[a-zA-Z0-9._/-]+$/.test(r.branch) || r.branch.startsWith('-') || r.branch.startsWith('/') || r.branch.includes('..') || r.branch.includes('//') || r.branch.endsWith('/') || r.branch.endsWith('.') || r.branch.split('/').some((v) => v.startsWith('.') || v.endsWith('.lock'))) throw new Error('Branche invalide.');
  if (!/^[a-f0-9]{40}$/.test(r.expectedSha)) throw new Error('Approbation obsolète : prépare une nouvelle action avec le commit exact.');
  const helper = '!f() { test "$1" = get || exit 0; printf "username=x-access-token\\npassword=%s\\n" "$OPENDOTS_GIT_TOKEN"; }; f';
  return ['-c', 'core.hooksPath=/dev/null', '-c', 'credential.helper=', '-c', `credential.https://github.com.helper=${helper}`, '-c', 'credential.interactive=never', '-c', 'http.sslVerify=true', '-c', 'http.followRedirects=false', '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', 'push', '--porcelain', '--no-verify', `https://github.com/${r.repo}.git`, `${r.expectedSha}:refs/heads/${r.branch}`];
}

/** Import data only into a fresh server-owned bare repository. No source path is
 * traversed on the host, and neither companion config nor processes see tokens. */
export async function withApprovedSnapshot<T>(r: Omit<GitPushRequest, 'token' | 'setUpstream'>, use: (dir: string, env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  gitPushArgs(r);
  const dir = await mkdtemp(join(tmpdir(), 'opendots-push-'));
  try {
    const home = join(dir, 'home'), repo = join(dir, 'repo.git'), bundle = join(dir, 'source.bundle');
    await mkdir(home, { mode: 0o700 });
    const env = brokerEnvironment(home);
    const run = (args: string[]) => exec('/usr/bin/git', args, { cwd: dir, env, timeout: 60_000, maxBuffer: 128_000 });
    await writeFile(bundle, await companionGitBundle(r), { mode: 0o600 });
    await run(['init', '--bare', '--template=', repo]);
    await run(['-C', repo, '-c', 'core.hooksPath=/dev/null', '-c', 'fetch.fsckObjects=true', '-c', 'transfer.fsckObjects=true', '-c', 'protocol.allow=never', '-c', 'protocol.file.allow=always', 'fetch', '--no-tags', '--', bundle, `refs/heads/${r.branch}:refs/heads/approved`]);
    const { stdout } = await run(['-C', repo, 'rev-parse', '--verify', 'refs/heads/approved^{commit}']);
    if (stdout.trim() !== r.expectedSha) throw new Error('La branche a changé depuis la préparation : une nouvelle validation est nécessaire.');
    return await use(repo, env);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export async function gitPushFromCompanion(r: GitPushRequest) {
  // Credentials are obtained by the caller but are never included in the export.
  const started = Date.now();
  const scrub = (v: string) => truncate(v.split(r.token).join('***').split(Buffer.from(`x-access-token:${r.token}`).toString('base64')).join('***'), 6000);
  const result = await withApprovedSnapshot(r, async (cwd, env) => {
    try {
      const out = await exec('/usr/bin/git', gitPushArgs(r), { cwd, env: { ...env, OPENDOTS_GIT_TOKEN: r.token }, timeout: 180_000, maxBuffer: 128_000 });
      return { ok: true, repo: r.repo, branch: r.branch, sha: r.expectedSha, duration_ms: Date.now() - started, stdout: scrub(out.stdout), stderr: scrub(out.stderr) };
    } catch (error) {
      // execFile's error.message includes argv; expose only bounded stderr.
      throw new Error(`git push a échoué. ${scrub(String((error as { stderr?: string }).stderr ?? 'Transport Git indisponible.'))}`);
    }
  });
  if (r.setUpstream !== false) {
    try { await setCompanionUpstream(r, r.repo); }
    catch { return { ...result, notice: 'Push réussi ; le suivi de branche local n’a pas pu être configuré.' }; }
  }
  return result;
}
