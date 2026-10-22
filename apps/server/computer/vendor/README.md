# Third-party source integrations

`sources.json` pins the upstream repositories, commit IDs and retained paths.
The adjacent `LICENSE` files apply to their respective MIT source trees.
These are source snapshots, not git submodules or downloads from a moving branch.

- **open-computer-use**: the unmodified Linux AT-SPI Python runtime is imported
  by `semantic-bridge.py`. The unmodified Swift CursorMotion reference is retained
  for the Linux path/progress port in `cursor-motion.py`.
- **open-browser-use**: the unmodified Go CLI/native-host source and Chromium
  extension are built/bundled by the computer Dockerfile. Upstream tests/examples
  are omitted from the runtime snapshot. `configure-browser.py` derives a keyed
  unpacked extension using the upstream beta public key without changing the
  vendored source. `browser-host.sh` selects the private per-bot Unix socket
  directory. The OpenDots adapter sends the upstream framed JSON-RPC protocol.

OpenDots adapters are outside these source snapshots. To update: obtain a reviewed
upstream commit, replace the listed paths while preserving their license files,
update sources.json, rebuild the computer image and run `pnpm test:computer:live`
plus the normal test/type/build checks. Do not edit vendored runtime code in place
without recording the patch and its provenance here.

GitHub denied creating `Sr-0w` forks with `403 Resource not accessible by
integration` during integration. No remote fork is claimed by these snapshots.
