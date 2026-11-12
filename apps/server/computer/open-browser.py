#!/usr/bin/python3
"""Launch a browser without inheriting shell pipes or its timeout process group."""
import os
from pathlib import Path
import subprocess
import sys
import time
from urllib.parse import urlsplit

bus = Path(os.environ['XDG_RUNTIME_DIR']) / 'session-bus'
if bus.exists():
    os.environ['DBUS_SESSION_BUS_ADDRESS'] = bus.read_text().strip()
os.environ['NO_AT_BRIDGE'] = '0'

url = sys.argv[1] if len(sys.argv) == 2 else 'about:blank'
if Path(url).is_absolute():
    # Desktop MIME launchers may expand a file URI to a local absolute path.
    url = Path(url).as_uri()
if len(sys.argv) > 2 or urlsplit(url).scheme not in ('http', 'https', 'file', 'about'):
    raise SystemExit('Usage: opendots-open-browser [http(s)://… | file://… | about:blank]')
import runpy
runpy.run_path('/usr/local/share/opendots/configure-browser-user.py')
def chromium_running():
    proc = subprocess.run(['pgrep', '-u', str(os.getuid()), '-x', 'chromium'], capture_output=True, text=True)
    return bool(proc.stdout.strip())


def visible_windows():
    # --class is case-sensitive. A mapped window is enough; activation is best-effort.
    for command in (
        ['xdotool', 'search', '--onlyvisible', '--class', 'chromium'],
        ['xdotool', 'search', '--onlyvisible', '--class', 'Chromium'],
        ['xdotool', 'search', '--onlyvisible', '--name', 'Chromium'],
    ):
        result = subprocess.run(command, capture_output=True, timeout=2)
        found = result.stdout.decode().split()
        if found:
            return found
    return []


windows = visible_windows()
already = bool(windows) or chromium_running()
log = Path.home() / '.vnc' / 'chromium.log'
# about:blank only ensures a window. A real URL still opens, including in an existing Chromium.
if not already or url != 'about:blank':
    log.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with log.open('ab') as output:
        subprocess.Popen(['/usr/bin/chromium', '--new-window', url], stdin=subprocess.DEVNULL,
                         stdout=output, stderr=output, start_new_session=True)
deadline = time.monotonic() + float(os.environ.get('OPENDOTS_BROWSER_WINDOW_SECONDS', '20'))
while time.monotonic() < deadline:
    windows = visible_windows()
    if windows:
        break
    time.sleep(0.2)
if not windows:
    raise SystemExit(f'Fenêtre non visible après {os.environ.get("OPENDOTS_BROWSER_WINDOW_SECONDS", "20")} s. Consulte {log}, puis reprends une capture.')
subprocess.run(['xdotool', 'windowactivate', windows[-1], 'windowraise', windows[-1]], capture_output=True, timeout=2)
print('Navigateur ouvert. Vérifie la capture du bureau pour confirmer la page chargée.')
