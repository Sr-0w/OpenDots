# Graphical computer use

For the complete Linux container deployment, volumes, HTTPS, backup and upgrade
commands, see [Docker Compose](docker-compose.md).

The **Computer / Ordinateur** page selects a companion's own Linux desktop:
XFCE, Xvfb, Chromium, xdotool and a noVNC viewer. The account owns **one Docker
container** combining shell and GUI. Each companion has its own stable Linux UID,
1280 × 800 X display, X authentication cookie, clipboard, VNC password, D-Bus
session, home directory and Chromium profile. Shell and GUI use the same home:
`data/users/<account>/workspaces/<agent>`, mounted at `/workspaces/<agent>`.
Screenshots live separately under `data/users/<account>/desktops/<agent>/screenshots`.
Only `/workspaces/shared` is intentionally shared between that account's bots.
The Docker socket, account databases and OAuth tokens are never mounted inside.

These are containers sharing the host kernel, not full virtual machines. The
components are free/open-source; model providers still charge their usual token
usage. Install Docker and prepare `opendots/computer:5` using `pnpm desktop:build`
or `docker compose build computer-image` before accepting users. Compose does this
automatically. A missing image can also build at first use, taking minutes; this
is not an instant start. To rebuild: `pnpm desktop:build -- --rebuild`.

Grant desktop access to a companion to let its tools start its session on demand.
The Computer page lets you select, start, stop and take over each bot independently.
Stopping a bot's desktop does not stop its teammates or shell. Homes/profiles
persist through restarts. Default account limits are 4 GiB, 2 CPUs and 2048 PIDs
(shared by all its bots): `OPENDOTS_COMPUTER_MEMORY`, `OPENDOTS_COMPUTER_CPUS`,
`OPENDOTS_COMPUTER_PIDS`. Old `OPENDOTS_DESKTOP_MEMORY/CPUS` are no longer used.
Custom shell images must include the account session controller and GUI tools;
plain Debian images support shell only. Old built-in `opendots/computer:1` settings
upgrade automatically to `:3`.

## Fast on-demand resume

After `OPENDOTS_COMPUTER_IDLE_SECONDS` without a shell command, desktop action or
connected viewer (300 by default, 0 disables), the account container is **paused**.
Its screens, browsers and processes remain in RAM. The next tool action or viewer
connection unpauses it without rebooting Chromium. Active commands and noVNC
connections hold leases so the container cannot pause mid-operation. Closing the
viewer allows the idle timer to run. Pause retains RAM and disk; it does not free
memory. Detached background daemons are paused too; set the timeout to 0 if they
must run continuously. A fully stopped container needs a cold start and relaunches requested bot
sessions, preserving files and browser profiles. Latency depends on the host;
use the live test's measured resume time rather than assuming an instant cold boot.

An upgrade recreates the account container when its image/resources/network change;
packages installed only in the old container layer are lost. Persistent workspace
files remain. Prepare a custom image for persistent system packages. The previous
shared desktop under `data/users/<account>/desktop` is retained as legacy data and
is **not copied into every bot**: doing so would duplicate logged-in sessions.
Stop old `opendots-desktop-*` containers during upgrade using the deployment's
stop script. Reconnect services in each bot's own browser when needed.

## Dynamic wallpaper

The desktop includes five project-provided JPEGs. A local Python/Pillow process
smoothly blends them according to the account timezone (Settings → timezone):
midnight/night, dawn at 06:00, morning at 09:00, day at 13:00, dusk at 18:00,
night at 22:00. It updates every minute, including on all XFCE workspaces.
Only two disposable 1280 × 800 PNGs are retained under
`~/.cache/opendots-wallpaper`; no network request or AI call is involved.

Set `OPENDOTS_DESKTOP_WALLPAPER=off` in the **server** environment to keep a
manually selected background. Timezone/wallpaper mode changes take effect when
its session is next restarted. Its home and browser profile are preserved. An image rebuild is required after changing the
bundled assets: `pnpm desktop:build -- --rebuild` or `docker compose build computer-image`.

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
  keys/shortcuts and scrolling. **Once desktop access is granted, actions execute
  directly by default.** This also applies to previously enabled companions.
  On the Computer page, choose per companion: **Always allow**, **Always ask**,
  or **Custom**. Custom mode lets clicks, typing, keys, scrolling and pointer
  movement be independently allowed without confirmation; unchecked actions ask
  for approval. Settings persist privately per account and take effect on the
  next action, including in an ongoing conversation. Models cannot change these
  approval settings themselves. Desktop access remains off by default.

When approval is required, the card shows the actual input and rechecks access
and desktop settings before execution. Changing to Always allow affects future
actions; existing pending cards still need approval or rejection.
Rejected/disabled/replayed approvals cannot execute the action. Shell command
approval is configured separately in **Settings → Tools → Computer**; the default
executes directly in the isolated Docker container.

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

Keep the account's computer network enabled to use the desktop. Turning computer networking off or selecting the off
mode stops the desktop. Re-enable it explicitly when needed.

VNC stays on the container loopback with a private password per bot. No VNC port
is published on the host. OpenDots relays it with `docker exec`/socat through
`/api/computer/vnc?agentId=…`, requiring the signed-in session, bot ownership and
exact browser Origin. Logout/session expiry terminates established WebSockets. No VNC port or
additional public hostname is needed. Do not expose Docker or VNC directly.

The existing reverse proxy must forward WebSocket upgrades for `/api/computer/vnc`
and support long connections. Caddy's `reverse_proxy` already does this; for nginx
include the usual Upgrade/Connection headers and an appropriate read timeout.
Local Vite development forwards this WebSocket with the normal `/api` proxy.

The account container runs each bot as a distinct Linux UID and mounts only that
account's workspaces, with no Docker socket or host credential mounts. Chromium uses `--no-sandbox`
inside this container; the Docker container is its isolation boundary. This is
not a hardened environment for mutually hostile tenants; use a dedicated host or
VM for untrusted public registrations. Granting a bot unrestricted sudo also grants
control of the other sessions within its own account container; keep sudo off for
mutual Linux-user isolation. Runtime proxy CA trust is configured without
disabling browser TLS verification.

## Verification

### Typing and visual feedback

`computer_action` pastes text without pressing Enter by default. Keep `submit: false`
(or omit it) to fill individual form fields. Set `submit: true` only when the
paste must also validate, for example after `ctrl+l` to navigate to a URL. A
separate `key: Return` also remains available.

The first automatic action in each turn returns a fresh observation without
executing if the agent has not yet captured its desktop. Executed actions wait
450 ms and attach a screenshot. If capture fails, the result still reports that
the action ran, and requires another observation. The third identical automatic
action in a turn is blocked. Pending approvals do not execute or capture.

Only the last two desktop images are replayed. They are sent as standard user
image parts after the tool result, rather than images inside tool messages.
Desktop tools require image input advertised by OpenRouter's model catalogue or
Ollama's `/api/show`. This metadata check cannot guarantee that every routed
provider interprets images correctly; the optional probe below checks actual
recognition with one provider and no fallback.

### Browser launchers and upgrades

The built-in computer image is `opendots/computer:5`. Pull the application changes
and run `pnpm desktop:build -- --rebuild` on the Docker host (or rebuild using the
Compose instructions). The old built-in image setting migrates automatically;
custom image names remain unchanged and must include the equivalent launcher
configuration. Account containers are recreated on next use when the image changes;
bot home folders persist.

Neither the account container nor the XFCE desktop automatically opens Chromium.
The desktop becomes ready when XFCE is visible, independently of any browser.
Use the terminal, file manager or another application as needed. To browse, open
Xfce's Web Browser launcher or run
`chromium about:blank >"$HOME/chromium.log" 2>&1 &` through `shell_exec`, after
opening the desktop. Redirect output and launch graphical applications in the
background so the shell tool returns without waiting for their window to close.
Closing/restarting the desktop does not
require a browser window; Chromium profiles remain persistent.

Terminal launches, Xfce's Web Browser launcher, and `xdg-open`
share `/etc/chromium.d/opendots`. It applies the existing `--no-sandbox` choice,
shared-memory flags, maximization and the environment's HTTPS proxy consistently.
The Xfce default browser is configured as Chromium. No extra Docker capabilities,
privileged mode, or seccomp relaxation are required. Closing Chromium leaves the
desktop usable so it can be reopened normally.

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm exec playwright install chromium
pnpm test:computer:live
pnpm test:onboarding:ui
```

If Chromium is installed system-wide:
`OPENDOTS_CHROMIUM_PATH=/usr/bin/chromium pnpm test:computer:live`.

The separate live smoke builds/starts actual Docker desktops, drives Chromium,
verifies Unicode typing and click/scroll events, private PNGs, direct/custom/ask permissions,
account filesystem separation, the actual noVNC canvas and WebSocket logout.
It first verifies that shell and desktop startup launch no Chromium process,
opens a real graphical terminal, then explicitly starts the browser for its checks.
`OPENDOTS_DESKTOP_LIVE_WEB=1` additionally verifies a real HTTPS page. Tests do not
make a paid model call: a separate provider serialization test checks that the
OpenRouter request actually contains image content rather than base64 text.

Optional **paid** recognition probe (not part of CI): supply a dedicated test key
through the environment, then run:

```sh
pnpm --filter @opendots/server exec tsx scripts/vision-probe.ts --paid
```

It requires `OPENROUTER_VISION_TEST_KEY`, defaults to `qwen/qwen3.8-27b` and
`Cerebras`, and makes exactly two requests: image in a tool result, then image in
a user message. Set `OPENDOTS_VISION_TEST_MODEL` / `OPENDOTS_VISION_TEST_PROVIDER`
to compare another endpoint. It prints HTTP status, reported provider and whether
a random code was read correctly; no key or image data is printed. The default
local tests do not establish Cerebras recognition or the Amazon scenario on SRV03.
