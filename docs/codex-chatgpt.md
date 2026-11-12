# Codex with a ChatGPT subscription

OpenDots uses the official `@openai/codex` app-server (pinned in the lockfile),
including its managed ChatGPT device authorization and token refresh. There is
no API-key fallback and no OpenRouter billing for Codex models. ChatGPT plan
eligibility and Codex usage limits apply; subscription access is not unlimited.

Rebuild and restart the **OpenDots application** to install the new dependency.
The computer image does not need rebuilding. Persist the existing application
data volume: each account's `codex/` directory contains its own credentials.
Treat this directory as a secret (including backups); the official CLI stores
its credentials in a file, protected by a private 0700 directory. It is not
covered by OpenDots' database secret encryption. Do not share/mount a host's
personal Codex home or API keys into this integration.

1. Open Settings → credentials → **Connecter ChatGPT**, or use the same card
   during onboarding instead of providing an OpenRouter key.
2. Open the official verification link and enter the displayed code. Device
   authorization may need enabling in ChatGPT's security settings.
3. Once connected, open Settings → models, choose **Codex · ChatGPT**, and select
   a model from the actual Codex catalog. Agents can also select provider `codex`.
4. **Déconnecter ChatGPT** removes the official client's saved authorization.

The server must reach OpenAI authentication and Codex services over HTTPS.
Device authorization works behind a reverse proxy and on mobile: no localhost
OAuth callback, DNS change, client secret or application registration is needed.

OpenDots controls its existing tool loop, permission checks and Stop button.
Each inference step uses an ephemeral Codex thread with the conversation
serialized by role, attachments and dynamic tool schemas. A requested tool call
returns to OpenDots for execution; its result is supplied on the next step.
Codex native shell/patch tools and web search are disabled. This initial adapter
replays context on each step; it does not reuse persistent Codex threads and
may consume more subscription quota on long tool-heavy tasks. Token usage is
reported as unknown, not zero cost or a fabricated remaining credit balance.

Verification: unit tests cover tool handoff, unknown tools, images, no-tools
synthesis, Stop and account directory isolation. The real app-server startup, model catalog, device-code issuance and cancellation
were verified without paid inference. Chromium also checks the connection card
with simulated OAuth responses. End-to-end
subscription authorization and inference require a user to complete sign-in;
mock transport tests do not establish those have succeeded.

Official protocol: https://developers.openai.com/codex/app-server/
Authentication: https://developers.openai.com/codex/auth/
