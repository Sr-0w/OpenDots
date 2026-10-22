#!/bin/sh
set -eu
umask 077
: "${XDG_RUNTIME_DIR:?}"
mkdir -p "$XDG_RUNTIME_DIR/obu"
exec /usr/local/bin/open-browser-use host --socket-dir "$XDG_RUNTIME_DIR/obu"
