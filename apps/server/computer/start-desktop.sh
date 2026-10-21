#!/bin/sh
set -eu
if [ "$(id -u)" = 0 ]; then
  chown 1000:1000 /home/opendots
  if [ -f /usr/local/share/ca-certificates/opendots-proxy.crt ]; then update-ca-certificates >/dev/null; fi
  exec runuser -u opendots -- "$0"
fi
chmod 700 /home/opendots
export HOME=/home/opendots DISPLAY=:99 XDG_RUNTIME_DIR=/tmp/runtime-opendots
mkdir -p "$XDG_RUNTIME_DIR" "$HOME/.pki/nssdb"
chmod 700 "$XDG_RUNTIME_DIR"
if [ -f /usr/local/share/ca-certificates/opendots-proxy.crt ]; then
  if [ ! -f "$HOME/.pki/nssdb/cert9.db" ]; then certutil -N --empty-password -d "sql:$HOME/.pki/nssdb"; fi
  certutil -A -d "sql:$HOME/.pki/nssdb" -n opendots-proxy -t 'C,,' -i /usr/local/share/ca-certificates/opendots-proxy.crt
fi
rm -f /tmp/.X99-lock
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp -ac &
xvfb_pid=$!
trap 'kill "$xvfb_pid" 2>/dev/null || true' EXIT INT TERM
while ! xdotool getdisplaygeometry >/dev/null 2>&1; do sleep 0.1; done
dbus-run-session -- startxfce4 >/tmp/xfce.log 2>&1 &
# VNC is only published on the host loopback and relayed after session checks.
x11vnc -display :99 -rfbport 5900 -listen 0.0.0.0 -forever -shared -nopw -quiet >/tmp/vnc.log 2>&1 &
vnc_pid=$!
rm -f "$HOME/.config/chromium/SingletonLock" "$HOME/.config/chromium/SingletonCookie" "$HOME/.config/chromium/SingletonSocket"
# Browser has its own persistent profile in this account's mounted home.
if [ -n "${HTTPS_PROXY:-${https_proxy:-}}" ]; then
  chromium --no-sandbox --disable-dev-shm-usage --no-first-run --proxy-server="${HTTPS_PROXY:-$https_proxy}" about:blank >/tmp/chromium.log 2>&1 &
else
  chromium --no-sandbox --disable-dev-shm-usage --no-first-run about:blank >/tmp/chromium.log 2>&1 &
fi
wait "$vnc_pid"
