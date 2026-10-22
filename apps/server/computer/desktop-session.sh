#!/bin/sh
set -eu
printf '%s' "$DBUS_SESSION_BUS_ADDRESS" > "$XDG_RUNTIME_DIR/session-bus"
startxfce4 >"$HOME/.vnc/xfce.log" 2>&1 &
xfce_pid=$!
wallpaper_pid=''
if [ "${OPENDOTS_DESKTOP_WALLPAPER:-dynamic}" = dynamic ]; then
  /usr/local/bin/opendots-wallpaper >"$HOME/.vnc/wallpaper.log" 2>&1 &
  wallpaper_pid=$!
fi
trap 'kill "$xfce_pid" ${wallpaper_pid:+"$wallpaper_pid"} 2>/dev/null || true' EXIT INT TERM
wait "$xfce_pid"
