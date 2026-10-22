#!/usr/bin/python3
"""Collect a finite foreground result even when background children keep output open."""
from pathlib import Path
import os
import signal
import subprocess
import sys
import tempfile

# Applications launched by the bot's shell join its existing private GUI bus.
# A shell-only computer still starts no desktop or browser.
runtime = os.environ.get('XDG_RUNTIME_DIR')
if runtime:
    bus = Path(runtime) / 'session-bus'
    if bus.exists():
        os.environ['DBUS_SESSION_BUS_ADDRESS'] = bus.read_text().strip()
        os.environ['NO_AT_BRIDGE'] = '0'
        os.environ['GTK_MODULES'] = 'gail:atk-bridge'

seconds, command = sys.argv[1:]
with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
    process = subprocess.Popen(['timeout', '-k', '1', seconds, 'bash', '-lc', command],
                               stdin=subprocess.DEVNULL, stdout=output, stderr=errors, start_new_session=True)
    try:
        code = process.wait(timeout=float(seconds) + 2)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
        code = 124
    for stream, target in [(output, sys.stdout.buffer), (errors, sys.stderr.buffer)]:
        stream.seek(0)
        target.write(stream.read(200_000))
        target.flush()
    # Descendants still in this process group survive a completed foreground
    # command. They no longer own docker exec's output pipes.
    background = False
    for entry in Path('/proc').iterdir():
        if entry.name.isdigit():
            try:
                fields = (entry / 'stat').read_text().rsplit(')', 1)[1].split()
                if fields[0] != 'Z' and int(fields[2]) == process.pid:
                    background = True
                    break
            except (FileNotFoundError, ProcessLookupError, PermissionError):
                pass
    if background:
        print('\n[OpenDots] Processus en arrière-plan conservés ; sorties limitées à cet instant. Pour le navigateur, utilise opendots-open-browser [url]. Redirige explicitement les sorties des tâches durables vers un fichier.', file=sys.stderr)
raise SystemExit(code if code >= 0 else 128 - code)
