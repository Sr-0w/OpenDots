# Graphical computer use

The **Computer / Ordinateur** page starts a private Linux desktop for the signed-in
account: XFCE, Xvfb, Chromium, xdotool and a noVNC viewer. These components are
free/open-source; there is no desktop service subscription or API key. The model
provider still charges its usual image/input token usage.

Install Docker on the OpenDots server. Open **Computer → Start desktop**. The
first start automatically builds `opendots/desktop:1` from the repository's
Dockerfile and may take several minutes. You can pre-build it with
`pnpm desktop:build`, or rebuild after changing its Dockerfile/start script with
`pnpm desktop:build -- --rebuild`. Allow access to Debian package repositories and
the Docker registry. The default memory limit is 2 GiB per desktop, configurable
with `OPENDOTS_DESKTOP_MEMORY`; leave additional RAM for OpenDots and its account
databases. The desktop uses a separate container from the existing shell, so
adding it does not reset installed shell programs.

A fixed **1280 × 800** display keeps model coordinates consistent. The browser
viewer scales the display without changing its resolution. A persistent home and
Chromium profile are mounted from `data/users/<id>/desktop`; closing/stopping the
desktop preserves them. Do not share or copy one account's browser profile into
another account. The GUI is shared by companions within that account.

## Models and approvals

Enable **Desktop access** for the intended companion on the Computer page or its
permissions panel. This permission is off by default for existing and new
companions. Choose a model with both vision and tools. OpenRouter's model picker
shows an eye icon for advertised image support; `qwen/qwen3.8-27b` advertises both
image input and tool calls. For local Ollama, the installed model and serving
configuration must support images as well.

The model receives:

- `computer_screenshot`: a real PNG image, with physical pixel dimensions. Only
  small private artifact references are stored in chat tool outputs; PNG bytes
  are sent through the AI SDK's image content format.
- `computer_action`: click/double-click, move, Unicode text paste, whitelisted
  keys/shortcuts and scrolling. **Every model input action requires human
  approval**, even if shell approval is automatic. The approval card shows the
  actual action and input, and rechecks permission and desktop settings before
  execution. Rejected/disabled/replayed approvals cannot execute the action.

After an action executes, the model takes another screenshot to verify it. Screen
contents are untrusted external data. Service connectors remain preferable for
sending/publishing because they expose specific permissions and operations.

Click **Take control / Prendre la main** to interact directly through noVNC.
Model screenshots and input actions are then suspended. Enter credentials directly
here rather than in chat. This suspension is stored with the account: closing the
page, losing the connection or restarting OpenDots does not silently resume model
captures. Explicitly hand control back, allow models on reopening the page, or stop
the desktop. Earlier images already sent to a provider cannot be withdrawn.

The last 20 screenshot artifacts are retained in the account's private data
folder for chat display/history. They are never public image URLs. Backups of the
account include potentially sensitive screenshots and browser sessions.

## Network and deployment

Keep the account's computer network enabled for the desktop: the VNC relay needs
Docker's bridge network. Turning computer networking off or selecting the off
mode stops the desktop. Re-enable it explicitly when needed.

VNC port 5900 is published only on a random **host loopback** port. OpenDots relays
it through `/api/computer/vnc`, requiring the signed-in session and exact browser
Origin. Logout/session expiry terminates established WebSockets. No VNC port or
additional public hostname is needed. Do not expose Docker or VNC directly.

The existing reverse proxy must forward WebSocket upgrades for `/api/computer/vnc`
and support long connections. Caddy's `reverse_proxy` already does this; for nginx
include the usual Upgrade/Connection headers and an appropriate read timeout.
Local Vite development forwards this WebSocket with the normal `/api` proxy.

The graphical container runs desktop applications as uid 1000, mounts only that
account's home, has no Docker socket or host credential mounts, and uses
`no-new-privileges` with a reduced capability set. Chromium uses `--no-sandbox`
inside this container; the Docker container is its isolation boundary. This is
not a hardened environment for mutually hostile tenants; use a dedicated host or
VM for untrusted public registrations. Runtime proxy CA trust is configured without
disabling browser TLS verification.

## Verification

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm exec playwright install chromium
pnpm test:computer:live
```

If Chromium is installed system-wide:
`OPENDOTS_CHROMIUM_PATH=/usr/bin/chromium pnpm test:computer:live`.

The separate live smoke builds/starts actual Docker desktops, drives Chromium,
verifies Unicode typing and click/scroll events, private PNGs, approval enforcement,
account filesystem separation, the actual noVNC canvas and WebSocket logout.
`OPENDOTS_DESKTOP_LIVE_WEB=1` additionally verifies a real HTTPS page. Tests do not
make a paid model call: a separate provider serialization test checks that the
OpenRouter request actually contains image content rather than base64 text.
