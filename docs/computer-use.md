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
usage. Install Docker and prepare `opendots/computer:9` using `pnpm desktop:build`
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
and `:3` through `:6` settings upgrade automatically to `:7`.

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

### Semantic control (Open Computer Use and Open Browser Use)

The built-in image includes pinned MIT sources from
[Open Computer Use](https://github.com/iFurySt/open-computer-use) and
[Open Browser Use](https://github.com/iFurySt/open-browser-use). Revision IDs and
licenses are in `apps/server/computer/vendor/sources.json` and the adjacent
license files. They require no extra account, paid API, or browser-store install.
The existing model provider/key is still needed for reasoning.

Prefer semantic targets before screenshot coordinates:

1. `computer_inspect {}` lists accessible Linux applications. Inspect an `app`
   name or PID to get role/name/state and bounded element references via AT-SPI.
2. `computer_target` with `engine: native`, `action: focus` or `click`, `snapshot`
   and `ref` acts on that exact inspected control. Native clicks invoke its
   accessibility action, without a guessed coordinate fallback.
3. For Chromium, `computer_target` with `engine: browser`, `action: open` and
   `url` opens it on demand. `browser_inspect {}` lists tabs; supplying `tabId`
   returns the page accessibility tree with DOM-backed targets. Browser clicks
   use DOM geometry and hit testing with trusted CDP pointer events. A covered
   element is refused rather than clicking through an overlay.
4. Focus a field and use `computer_keyboard` for real X11 text/key events.
   `submit` is false by default. Re-inspect to verify the effect. Typed values
   are not exposed in semantic tree results, including password values.

These tools are available to text-only models too. Only the screenshot/coordinate
tools require image support. Snapshots expire after 120 seconds, another
inspection, or a successful target action. Changed native target identities and
browser navigations reject old references. Native inspection is bounded to
300 nodes/32 levels, browser inspection to 400 exposed nodes; inaccessible apps,
canvas surfaces and deeper trees can still require screenshots. This does not
guarantee that every application exposes usable accessibility information.

AT-SPI and Chromium native messaging run on the bot's private D-Bus/session and
Linux UID. The extension is bundled and keyed locally. Its Go relay uses a
mode-600 Unix socket inside the mode-700 bot runtime directory; there is no TCP
debugging port. Browser profiles, accessibility snapshots and sockets are not
shared across bots. Chromium is not started at container/session startup.

Semantic clicks/focus/browser opening follow the **click** permission;
`computer_keyboard` follows **type/key** permissions. Auto remains the default.
Stop and manual takeover cancel in-progress operations. Inspections and actions
cannot bypass a disabled desktop or revoked bot permission. UI labels and page
content remain untrusted external data.

The system prompt and coordinate-tool description specify an accessibility-first
workflow: inspect named controls, target their current refs, type with explicit
submission, then inspect again. Screenshots and coordinate clicks are a last
resort for controls absent from the accessibility tree. After one ineffective
coordinate attempt, agents are instructed to return to semantic inspection rather
than adjust guessed coordinates repeatedly. These are model instructions, not a
guarantee that every model follows them.

### Cursor Motion on Linux

The X11 movement adapter ports the upstream MIT `CursorMotionPath` cubic curve
and Velocity Verlet spring progress (reference Swift source retained in vendor).
It animates the real pointer in about 350 ms, then locks to the exact native
endpoint **before** a coordinate click/scroll. A move to the same point returns
immediately. Motion cancellation stops before the pending click.

This is a Linux adaptation of the path/progress portion, not the Swift/macOS
application or its complete glyph/rotation renderer. noVNC displays the real
moving X11 pointer. The noVNC patch reads TightVNC PointerPos and Cursor shape
updates: view-only mode renders the server sprite at the reported hotspot,
scaled with the desktop canvas on desktop and mobile. It never derives pointer
position from a commanded click. Manual control restores the normal local
cursor. The viewer uses x11vnc’s standard arrow (`-noxfixes -cursor arrow`): the packaged
x11vnc crashed when updating custom XFixes cursor shapes in live tests. Native
position updates remain enabled; screenshots still include the actual native
XFixes shape. Server-side cursor blitting is also avoided.

Semantic AT-SPI/CDP focus and click also animate this same pointer to the live
accessible target before dispatch. Native targets use AT-SPI screen bounds;
browser targets use fresh DOM geometry and the active X11 window/client metrics.
Hover changes are checked before dispatch. Off-screen targets are refused,
not represented by a fake cursor or a last-command overlay. Screenshot cursor metadata continues to
describe the actual native X11 hotspot.

Enable **Desktop access** for the intended companion on the Computer page or its
permissions panel. This permission is off by default for existing and new
companions. Semantic tools require tool calling; screenshot-based control also
requires vision. Choose a model with both vision and tools for that fallback. OpenRouter's model picker
shows an eye icon for advertised image support; `qwen/qwen3.8-27b` advertises both
image input and tool calls. For local Ollama, the installed model and serving
configuration must support images as well.

The model receives:

- `computer_screenshot`: a real PNG image, with physical pixel dimensions. Only
  small private artifact references are stored in chat tool outputs; PNG bytes
  are sent through the AI SDK's image content format.
- `computer_action`: click/double-click, move, Unicode keypress typing, whitelisted
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

`computer_action` types using native X11 key press/release events (`xdotool type`),
never clipboard paste. Printable Unicode characters are accepted, up to 2000 per call; split longer text.
A 12 ms interval paces events. For batches that fit the available spare X11
keycodes, Unicode mappings remain stable through the whole batch and a short
client-drain interval, then only those previously empty slots are restored. This
avoids per-character remapping races observed in a busy XTerm. Larger distinct
Unicode alphabets use xdotool’s normal mapping behavior. Stop, manual takeover and desktop shutdown
interrupt typing through a liveness pipe and release held keys. Control characters
(including newlines and tabs) are rejected before any input is sent: use explicit
`key: Return` or `key: Tab` actions instead. This prevents hidden Enter events
from submitting a partially filled form. Keep `submit: false` (the default); set
`submit: true` only when the text should be followed by Return, for example an
address-bar URL. Tests read Unicode back from a real terminal's TTY and from
Chromium while checking that the clipboard is unchanged and forms remain unsent.

The first automatic action in each turn returns a fresh observation without
executing if the agent has not yet captured its desktop. Executed actions wait
450 ms and attach a screenshot. Both explicit screenshots and post-action images
are visible in chat. Native X11 cursor pixels come from XFixes together with their
actual position and hotspot, and are composited at `(x - hotspotX, y - hotspotY)`
without resizing the 1280×800 screen. The marker is the real virtual desktop
cursor, not an estimated position from the requested action. Cropping handles
screen edges. If cursor capture is unavailable, `cursor` is null rather than
inventing a position. No overlay window intercepts input. Moving or clicking at the current pointer
position does not wait for a motion event: X11 queues motion and click commands
on the same connection without `xdotool mousemove --sync`.

Coordinates always refer to original 1280×800 pixels, not a thumbnail. The chat
caption shows native dimensions and origin; **Check coordinates** opens an
inspector that converts a click/tap in the displayed image to native pixels.
Arrow keys fine-tune one pixel (Shift: ten). On reduced images a CSS/touch pixel
can span several native pixels, so small differences from visual measurement
are expected. The inspector does not send actions to the desktop.

Each image sent to the model is labelled with its screenshot ID, tool call ID,
capture time, dimensions, pointer and focus. This keeps the last two observations
distinguishable. Their IDs and original tool arguments survive history compaction
even after a busy turn. If a retained PNG has expired from storage, the model is
explicitly told no image is attached and must request a fresh screenshot.
A visual estimate in a resized preview is not evidence of an
X11 coordinate bug; verify the matching original image before diagnosing one.

Each observation also includes `focusedWindow`: actual focused X11 window ID,
title, WM_CLASS and native x/y/width/height, or null when unavailable. The model
can check whether keyboard focus belongs to a terminal, browser or desktop without
inferring it solely from an image. Titles remain untrusted external content and
are bounded; they never supply instructions or executable commands.

`frameHash` compares native desktop pixels before compositing the cursor, so
pointer movement alone does not count as visual progress. `visualChange: unchanged`
is feedback, not an automatic failure: focusing a field can leave pixels unchanged.
`ok: true` confirms that input was delivered, not that the intended UI target was
reached. The agent must inspect the image and must not guess coordinates.

Completed model steps store `metadata.modelSteps` with the actual response model,
OpenRouter-reported provider (or null if absent), response ID and step number.
Routing can change between steps; the preferred provider is never recorded as
if it were the actual provider. This trace does not prove image recognition.

If capture fails, the result still reports that
the action ran, and requires another observation. Repeated actions are allowed; Stop remains available to interrupt a loop. `observe_first` explicitly returns
`actionExecuted: false`: it has not clicked or acquired focus. Pending approvals
do not execute or capture.

Oversized historical tool arguments are replaced by a plain-text summary of the
whole call, not an invalid `{preview,truncated}` argument object. Short arguments
retain their original schema and values; summaries must never be executed.

Only the last two desktop images are replayed. They are sent as standard user
image parts after the tool result, rather than images inside tool messages.
Desktop tools require image input advertised by OpenRouter's model catalogue or
Ollama's `/api/show`. This metadata check cannot guarantee that every routed
provider interprets images correctly; the optional probe below checks actual
recognition with one provider and no fallback.

### Automatic desktop startup

OpenDots restores all authorized, enabled bot desktops in the background when
an account runtime starts. It also watches Docker container-start events and
restarts those desktops after the account container is restarted externally.
After a Docker daemon interruption, the watcher reconnects and reconciles
missed starts. No manual start click or first agent tool call is required.

Each account keeps its own container; each bot keeps its private Linux UID,
screen, home directory and browser profile. Explicitly stopped desktops,
archived bots, revoked permissions and disabled/offline computer settings are
respected. Chromium is still opened only on demand. Startup errors in one bot
do not prevent other desktops or the HTTP service from starting. No credentials
are stored in container labels or writable bot startup scripts.

The change is in the application controller; the existing `computer:9` image
works without a rebuild. Deploy the updated application and its background
startup runs automatically. Test the actual lifecycle with
`pnpm test:computer:autostart` (requires Docker and the desktop image).

### Browser launchers and upgrades

The built-in computer image is `opendots/computer:9`. Pull the application changes
and run `pnpm desktop:build -- --rebuild` on the Docker host (or rebuild using the
Compose instructions). The old built-in image setting migrates automatically;
custom image names remain unchanged and must include the equivalent launcher
configuration. Account containers are recreated on next use when the image changes;
bot home folders persist.

Neither the account container nor the XFCE desktop automatically opens Chromium.
The desktop becomes ready when XFCE is visible, independently of any browser.
Use the terminal, file manager or another application as needed. To browse, open
Xfce's Web Browser launcher or run
`opendots-open-browser https://example.com` through `shell_exec`, after
opening the desktop. This helper detaches Chromium, redirects its output to the
bot's private `.vnc/chromium.log`, and raises the visible window, returning within
five seconds. Xfce and `xdg-open` use the same helper. The shell runner collects
output through temporary files, so background commands such as `sleep 999 &` or
`chromium --new-window … &` no longer keep Docker's output pipe open. Their output
is a snapshot; redirect durable logs explicitly. Foreground commands still have
their timeout and process group. Old custom images retain the legacy runner with
an upgrade notice until they include `opendots-shell-run`.
Closing/restarting the desktop does not
require a browser window; Chromium profiles remain persistent.
After a container recreation the UI shows that the desktop must be restarted;
the next desktop action starts its session again and observes a fresh screen.

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
a random code was read correctly and its rectangle centre was located within
24 native pixels in a 1280×800 image. The target position is random and appears
only in the image, testing recognition and coordinate grounding separately. No
key or image data is printed. The default
local tests do not establish Cerebras recognition or the Amazon scenario on SRV03.

### Turn completion and optional budgets

There is **no step limit by default**: a model may continue using tools beyond
12, 48 or any other fixed number of steps. Normal model completion, an
interactive form or Stop can end the workflow; existing operation timeouts
still report errors rather than a silent step cutoff.

Each account can explicitly opt into a positive work-step limit in
**Settings → General → Step limit per turn**. Leave the field blank for no limit.
The value is private to that account and applies to subsequent turns. If that optional budget is exhausted, one extra
tools-disabled step reads the last tool result and summarizes progress. A deterministic limit notice is streamed and
saved even if the model returns no summary, and `turn.limit` is journaled.
This is a suspension, not a claim of completion; asking to continue starts a
new turn with the conversation history. Stop, errors and interactive forms keep
their existing early-exit behavior.

During a live turn only the latest two semantic UI trees remain complete in
the model context. Older trees become bounded text summaries without snapshot
refs; stored tool results are unchanged. This prevents repeated 30 KB browser
inspections accumulating unbounded UI trees in the model's context.

Identical desktop actions and keyboard typing are not blocked automatically.
The prompt still recommends checking results and switching to accessibility
targets when coordinate clicks fail. Submission remains explicit.
