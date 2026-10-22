#!/usr/bin/python3
"""Trusted account controller: private process group per Linux user, no public VNC."""
import json
import os
from pathlib import Path
import pwd
import re
import signal
import subprocess
import sys

operation, user, display = sys.argv[1:]
if operation not in ('start', 'stop') or not re.fullmatch(r'agent_[a-f0-9]{16}', user) or not 1 <= int(display) <= 1000:
    raise SystemExit('Invalid session')
try:
    account = pwd.getpwnam(user)
except KeyError:
    if operation == 'stop':
        raise SystemExit(0)
    raise
root = Path('/run/opendots-sessions')
root.mkdir(mode=0o700, exist_ok=True)
record = root / f'{user}.json'

def process_start(pid):
    try:
        fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
        return None if fields[0] == 'Z' else fields[19]
    except (FileNotFoundError, ProcessLookupError):
        return None

previous = json.loads(record.read_text()) if record.exists() else None
alive = previous and process_start(previous['pid']) == previous['start']
if operation == 'stop':
    if alive:
        os.killpg(previous['pid'], signal.SIGTERM)
    record.unlink(missing_ok=True)
    raise SystemExit(0)
config = json.load(sys.stdin)
if alive:
    print('existing')
    raise SystemExit(0)
environment = dict(os.environ, HOME=account.pw_dir, USER=user, LOGNAME=user,
                   DISPLAY=f':{int(display)}', XAUTHORITY=f'{account.pw_dir}/.Xauthority',
                   XDG_RUNTIME_DIR=f'/tmp/runtime-{user}', OPENDOTS_VNC_PASSWORD=config['password'],
                   TZ=config['timezone'], OPENDOTS_DESKTOP_WALLPAPER=config['wallpaper'])
# Session applications run as the bot, never as the controller's root user.
log = open(root / f'{user}.log', 'ab', buffering=0)
child = subprocess.Popen(['/usr/sbin/runuser', '-u', user, '--', '/usr/local/bin/opendots-desktop'],
                         stdin=subprocess.DEVNULL, stdout=log,
                         stderr=subprocess.STDOUT, env=environment, start_new_session=True)
record.write_text(json.dumps({'pid': child.pid, 'start': process_start(child.pid)}))

print('started')
