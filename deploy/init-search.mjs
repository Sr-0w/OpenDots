import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const directory = process.env.OPENDOTS_SEARCH_CONFIG_DIR ?? '/etc/searxng';
const base = JSON.parse(await readFile(new URL('../apps/server/search/settings.json', import.meta.url), 'utf8'));
const path = `${directory}/settings.yml`;
let secret;
try { secret = JSON.parse(await readFile(path, 'utf8')).server.secret_key; }
catch (error) { if (error.code !== 'ENOENT') throw error; }
base.server.secret_key = secret || randomBytes(32).toString('hex');
const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
if (proxy) base.outgoing.proxies = { 'all://': [proxy] };
if (process.env.SSL_CERT_FILE) {
  const ca = await readFile(process.env.SSL_CERT_FILE, 'utf8');
  if (ca.includes('PRIVATE KEY') || !ca.includes('BEGIN CERTIFICATE')) throw new Error('Public CA certificates required.');
  await writeFile(`${directory}/opendots-ca.pem`, ca, { mode: 0o644 });
  base.outgoing.verify = '/etc/searxng/opendots-ca.pem';
}
await writeFile(path, JSON.stringify(base, null, 2), { mode: 0o644 });
console.log('SearXNG configuration ready.');
