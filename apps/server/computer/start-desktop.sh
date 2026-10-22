#!/bin/sh
set -eu
umask 077
: "${HOME:?}" "${DISPLAY:?}" "${XDG_RUNTIME_DIR:?}" "${OPENDOTS_VNC_PASSWORD:?}"
mkdir -p "$XDG_RUNTIME_DIR" "$HOME/.pki/nssdb" "$HOME/.vnc" "$HOME/.config/chromium"
chmod 700 "$HOME" "$XDG_RUNTIME_DIR"
exec >>"$HOME/.vnc/session.log" 2>&1
if [ -f /usr/local/share/ca-certificates/opendots-proxy.crt ]; then
  if [ ! -f "$HOME/.pki/nssdb/cert9.db" ]; then certutil -N --empty-password -d "sql:$HOME/.pki/nssdb"; fi
  certutil -A -d "sql:$HOME/.pki/nssdb" -n opendots-proxy -t 'C,,' -i /usr/local/share/ca-certificates/opendots-proxy.crt
fi
python3 - <<'PY'
from Cryptodome.Cipher import DES
import os
from pathlib import Path
password = os.environ['OPENDOTS_VNC_PASSWORD'].encode()[:8].ljust(8, b'\0')
with open(Path.home() / '.vnc/passwd', 'wb') as output:
    # libvncserver/d3des uses reversed key bits for its password-file format.
    key = bytes(int(format(value, '08b')[::-1], 2) for value in [23,82,107,6,35,78,88,7])
    output.write(DES.new(key, DES.MODE_ECB).encrypt(password))
PY
unset OPENDOTS_VNC_PASSWORD
rm -f "/tmp/.X${DISPLAY#:}-lock" "/tmp/.X11-unix/X${DISPLAY#:}"
cookie=$(mcookie)
xauth -f "$XAUTHORITY" add "$DISPLAY" MIT-MAGIC-COOKIE-1 "$cookie"
Xvfb "$DISPLAY" -screen 0 1280x800x24 -nolisten tcp -auth "$XAUTHORITY" &
xvfb_pid=$!
trap 'kill "$xvfb_pid" ${session_pid:-} ${vnc_pid:-} ${browser_pid:-} 2>/dev/null || true' EXIT INT TERM
while ! xdotool getdisplaygeometry >/dev/null 2>&1; do sleep 0.05; done
dbus-run-session -- /usr/local/bin/opendots-session &
session_pid=$!
port=$((5900 + ${DISPLAY#:}))
# Password + X cookie are private per bot, even inside this account's container.
x11vnc -display "$DISPLAY" -rfbport "$port" -localhost -rfbauth "$HOME/.vnc/passwd" -forever -shared -quiet >"$HOME/.vnc/vnc.log" 2>&1 &
vnc_pid=$!
rm -f "$HOME/.config/chromium/SingletonLock" "$HOME/.config/chromium/SingletonCookie" "$HOME/.config/chromium/SingletonSocket"
if [ -n "${HTTPS_PROXY:-${https_proxy:-}}" ]; then
  chromium --no-sandbox --disable-dev-shm-usage --no-first-run --proxy-server="${HTTPS_PROXY:-$https_proxy}" about:blank >"$HOME/.vnc/chromium.log" 2>&1 &
else
  chromium --no-sandbox --disable-dev-shm-usage --no-first-run about:blank >"$HOME/.vnc/chromium.log" 2>&1 &
fi
browser_pid=$!
wait "$vnc_pid"
