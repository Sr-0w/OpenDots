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

def process_running():
    uid = str(os.getuid())
    # Debian Chromium is usually "chromium"; a few builds truncate or brand the comm.
    for name in ('chromium', 'chromium-browse', 'chrome', 'chromium-bin'):
        try:
            proc = subprocess.run(['pgrep', '-u', uid, '-x', name], capture_output=True, text=True, timeout=2)
        except (OSError, subprocess.TimeoutExpired):
            return False
        if proc.stdout.strip():
            return True
    return False

def window_open():
    # An already mapped window is the browser, even when pgrep misses the process name.
    # xdotool --class is case-sensitive; Chromium has shipped both casings.
    commands = [
        ['xdotool', 'search', '--onlyvisible', '--class', 'chromium'],
        ['xdotool', 'search', '--onlyvisible', '--class', 'Chromium'],
        ['xdotool', 'search', '--onlyvisible', '--name', 'Chromium'],
    ]
    for command in commands:
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=2)
        except (OSError, subprocess.TimeoutExpired):
            return False
        if result.stdout.strip():
            return True
    return False

def browser_up():
    return process_running() or window_open()

def presence():
    running = browser_up()
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
elif mode == 'launch':
    # The packaged helper gives up after 4 s. On a 1 GiB desktop the window often
    # maps later, and a window that is already visible must not start another Chromium.
    if browser_up():
        raise SystemExit(0)
    helper = subprocess.run(['opendots-open-browser', 'about:blank'], capture_output=True, text=True)
    deadline = time.monotonic() + float(os.environ.get('OPENDOTS_BROWSER_LAUNCH_WAIT_SECONDS', '20'))
    while True:
        if browser_up():
            raise SystemExit(0)
        if time.monotonic() >= deadline:
            break
        time.sleep(0.25)
    detail = (helper.stderr or helper.stdout or 'Chromium ne s’affiche pas').strip().splitlines()
    sys.stderr.write((detail[-1] if detail else 'Chromium ne s’affiche pas') + '\\n')
    raise SystemExit(1)
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
