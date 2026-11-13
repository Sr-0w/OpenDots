# OpenDots for Android

A native Android client for the OpenDots engine: 100 % Kotlin and Jetpack Compose, no WebView.
It speaks the same HTTP API as the web app, so it works with any OpenDots server reachable over HTTPS.

## What it does

- One conversation per companion, with streamed replies, Markdown, code blocks and images.
- Reasoning and tool calls tucked behind a "Worked for…" line; terminal output and search results on demand.
- Approvals, "ready to send" email drafts and question forms, answered in the thread.
- Image attachments (system photo picker), replies, reactions, stop.
- A companions drawer with live state and unread markers, scheduled tasks, approvals, settings.
- System, light, dark and true-black OLED themes; English and French.

Connectors, skills, memory and the desktop viewer are still managed from the web app.

## Modules

- `:designsystem` — Quiet UI, the design language shared with Dot Mail: tokens (`Tokens.kt`), theme, and
  components. Backdrop blur goes through `QuietBackdrop` (Haze 2.1); screens never use the blur engine directly.
  Glass is only used for the top header and floating controls; the composer and the bottom of the screen never blur.
- `:app` — the OpenDots client: `data/` (API client, stream assembler), `chat/` (conversation logic), `ui/` (screens).

Settings → Quiet UI catalog shows every token and component, plus a scrolling test for the blur.

## Build

```bash
./gradlew :app:assembleDebug
```

```bash
./gradlew :app:testDebugUnitTest
```

The tests drive the real app against a fake OpenDots engine and write a PNG of each screen to `app/build/shots`.

## Release

Put the tag to publish (for example `android-v0.1.0-alpha.2`) in `RELEASE` and push: the
`Android release` workflow builds the APK and publishes it as a GitHub pre-release.
