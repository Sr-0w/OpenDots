# Semantic computer and browser integration

Use pinned MIT sources from iFurySt/open-computer-use (Linux AT-SPI runtime,
CursorMotion geometry/progress) and iFurySt/open-browser-use (Chromium extension
and Go native host). Provenance and licenses live in computer/vendor.

GitHub fork creation was attempted but the installed integration returned 403.
Vendored source allows development and reproducible builds without a fork grant.

Keep one Docker container per account and separate UID, HOME, DISPLAY,
Xauthority, D-Bus and private Unix browser socket for each bot. No TCP debugger.
Browser remains stopped until explicitly opened. Text is still typed as real
keypresses, with Enter separate. Existing auto/ask/custom policies and manual
takeover apply to semantic actions too.

Expose bounded textual inspection and snapshot-scoped element references for
native applications and browser tabs. Reject expired, changed or cross-session
targets. Never silently fall back from a stale reference to guessed coordinates.
Semantic tools work without a vision model; screenshots remain an optional
fallback. External UI text is untrusted input.

Port the upstream cubic path and spring progress to X11 motion, keeping the
native hotspot authoritative and finishing at the exact endpoint before click.
Do not reuse extracted proprietary cursor assets or emulate macOS overlays.

Validation: real GTK application and Chromium form, stale targets, per-bot
isolation, password typing without submission, native motion/endpoint/click,
permissions, Stop/manual takeover, existing Docker/noVNC smoke and full suite.

## Completed validation — 2026-10-22

- 198 tests across 23 files passed; workspace typecheck and production build passed.
- Full live Docker/XFCE/Chromium/noVNC recipe passed, including real GTK AT-SPI,
  the actual OBU extension/Go host, Unicode/password keypresses, stale snapshots,
  Stop during motion/typing/a deliberately slow CDP click, isolation, resume and
  restart, desktop/mobile cursor sprite and native hotspot calibration.
- Latest measured warm resume: 357 ms in this environment; this is not a promise
  about cold starts or other hosts. No paid model request was made. A real
  Qwen/OpenRouter provider session still needs its own deployment validation.
- All 29 retained upstream files match the pinned source snapshots byte for byte.
- The Linux Cursor Motion port covers cubic path/spring progress, not the macOS
  app/glyph pose renderer. The packaged x11vnc crashed on custom XFixes cursor
  shapes, so its viewer uses a standard arrow plus real RFB PointerPos updates.
  Native screenshots keep their original XFixes shape and hotspot.

GitHub fork creation remains blocked by the integration's repository permissions;
the functional integration is delivered as licensed, pinned source snapshots.
