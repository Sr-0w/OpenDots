import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

/** Respecte HTTPS_PROXY / NO_PROXY pour tous les appels fetch sortants. */
export function setupNetwork() {
  if (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY) {
    setGlobalDispatcher(new EnvHttpProxyAgent());
  }
}
