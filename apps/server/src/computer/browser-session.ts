import { singleFlight } from '../util.ts';

export type BrowserPresence = 'ready' | 'process' | 'absent';

export class BrowserSessionError extends Error {}

export interface BrowserSessionDeps {
  authorized: () => Promise<boolean>;
  takenOver: () => Promise<boolean>;
  startDesktop: () => Promise<unknown>;
  presence: () => Promise<BrowserPresence>;
  launch: () => Promise<void>;
  waitUntilReady: () => Promise<boolean>;
}

const flights = new Map<string, Promise<void>>();

const UNAUTHORIZED = 'Accès au bureau non autorisé pour ce compagnon. Aucun bureau ni navigateur n’a été démarré.';
const TAKEN = 'L’utilisateur a pris la main. Démarrage du navigateur annulé.';
const NOT_READY = 'Le navigateur privé n’est pas prêt : obu/active.json est absent. Aucun second navigateur n’a été lancé.';
const PROCESS_NOT_READY = 'Chromium est déjà ouvert mais la session du navigateur (obu/active.json) n’est pas prête. Aucun second navigateur n’a été lancé.';

/** Probe partagé par le contrôleur. `wait` honore OPENDOTS_BROWSER_WAIT_SECONDS (20 s par défaut). */
export const browserPresencePy = `
import json, os, stat, sys, time, subprocess
from pathlib import Path
runtime = Path(os.environ['XDG_RUNTIME_DIR'])
active = runtime / 'obu' / 'active.json'

def presence():
    proc = subprocess.run(['pgrep', '-u', str(os.getuid()), '-x', 'chromium'], capture_output=True, text=True)
    running = bool(proc.stdout.strip())
    ready = False
    if running and active.is_file():
        try:
            record = json.loads(active.read_text())
            sock = Path(str(record.get('socketPath') or ''))
            ready = bool(sock.is_absolute() and sock.parent == active.parent and stat.S_ISSOCK(sock.stat().st_mode))
        except (OSError, ValueError, TypeError):
            ready = False
    if ready:
        return 'ready'
    if running:
        return 'process'
    return 'absent'

mode = sys.argv[1] if len(sys.argv) > 1 else 'status'
if mode == 'status':
    sys.stdout.write(presence())
elif mode == 'wait':
    deadline = time.monotonic() + float(os.environ.get('OPENDOTS_BROWSER_WAIT_SECONDS', '20'))
    while True:
        if presence() == 'ready':
            sys.stdout.write('ready')
            break
        if time.monotonic() >= deadline:
            sys.stdout.write('missing')
            break
        time.sleep(0.25)
else:
    raise SystemExit('unknown browser probe')
`;

export function clarifyBrowserFailure(error: string): string {
  if (!/Errno 2|No such file or directory|FileNotFoundError/.test(error)) return error;
  if (!/active\.json|\/obu\/[^/\s'"]+\.sock/.test(error)) return error;
  return 'Le navigateur privé n’est pas prêt : la session Open Browser Use est absente. Réessaie l’inspection ; une session déjà ouverte est réutilisée et aucun second navigateur n’est lancé.';
}

async function runBrowserSession(deps: BrowserSessionDeps): Promise<void> {
  if (!await deps.authorized()) throw new BrowserSessionError(UNAUTHORIZED);
  if (await deps.takenOver()) throw new BrowserSessionError(TAKEN);
  await deps.startDesktop();
  if (!await deps.authorized()) throw new BrowserSessionError('Démarrage du bureau annulé.');
  if (await deps.takenOver()) throw new BrowserSessionError(TAKEN);
  const state = await deps.presence();
  if (state === 'ready') return;
  if (state === 'absent') await deps.launch();
  else if (state !== 'process') throw new BrowserSessionError('État du navigateur illisible.');
  if (!await deps.waitUntilReady()) {
    const after = await deps.presence().catch(() => 'absent' as const);
    if (after === 'ready') return;
    throw new BrowserSessionError(after === 'process' ? PROCESS_NOT_READY : NOT_READY);
  }
}

export function ensureBrowserSession(key: string, deps: BrowserSessionDeps, pending: Map<string, Promise<void>> = flights): Promise<void> {
  return singleFlight(pending, key, () => runBrowserSession(deps));
}
