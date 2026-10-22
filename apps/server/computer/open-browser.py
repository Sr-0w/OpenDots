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
log = Path.home() / '.vnc' / 'chromium.log'
log.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
with log.open('ab') as output:
    subprocess.Popen(['/usr/bin/chromium', '--new-window', url], stdin=subprocess.DEVNULL,
                     stdout=output, stderr=output, start_new_session=True)
deadline = time.monotonic() + 4
while time.monotonic() < deadline:
    result = subprocess.run(['xdotool', 'search', '--onlyvisible', '--class', 'chromium'], capture_output=True, timeout=1)
    windows = result.stdout.decode().split()
    if windows:
        active = subprocess.run(['xdotool', 'windowactivate', windows[-1], 'windowraise', windows[-1]], capture_output=True, timeout=1)
        if active.returncode == 0:
            print('Navigateur ouvert. Vérifie la capture du bureau pour confirmer la page chargée.')
            raise SystemExit(0)
    time.sleep(0.1)
raise SystemExit(f'Fenêtre non visible après 4 s. Consulte {log}, puis reprends une capture.')
