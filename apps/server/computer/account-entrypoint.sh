#!/bin/sh
set -eu
mkdir -p /tmp/.X11-unix
chmod 1777 /tmp/.X11-unix
if [ -f /usr/local/share/ca-certificates/opendots-proxy.crt ]; then update-ca-certificates >/dev/null; fi
exec sleep infinity
