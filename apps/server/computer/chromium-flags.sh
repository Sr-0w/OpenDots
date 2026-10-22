# Sourced by Debian's /usr/bin/chromium for terminal, Xfce and xdg-open alike.
# Keep Docker's existing isolation; no extra capabilities or seccomp exceptions.
CHROMIUM_FLAGS="${CHROMIUM_FLAGS:-} --no-sandbox --disable-dev-shm-usage --no-first-run --start-maximized --force-renderer-accessibility --load-extension=/usr/local/share/opendots/browser-extension"
if [ -n "${HTTPS_PROXY:-${https_proxy:-}}" ]; then
  CHROMIUM_FLAGS="$CHROMIUM_FLAGS --proxy-server=${HTTPS_PROXY:-$https_proxy}"
fi
export CHROMIUM_FLAGS
