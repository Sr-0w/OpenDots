# Images in chat

Use the **+** button next to the prompt to choose images from your computer, or
the photo library/file chooser offered by your mobile browser. You can also paste
an image into the prompt (Ctrl+V / Cmd+V). Both paths produce the same attachment
preview. Remove an image with its X before sending. Images can be sent with text
or on their own. Ordinary text paste and Shift+Enter continue to work normally.

The composer accepts up to **6 images per message**, **10 MiB per source image**,
in JPEG, PNG, WebP or GIF format. Other formats, including HEIC, need conversion
before attachment. The server validates the actual bytes rather than trusting the
filename or browser MIME type. GIF uses its first frame. Images exceeding 40
megapixels are rejected. Accepted images are rotated according to orientation,
scaled down to at most 2048 × 2048, flattened onto white and encoded as JPEG with
EXIF/GPS metadata removed. The original file on the user's device is unchanged.

Previews remain local until Send. Upload errors preserve the draft and selected
images. Normalized images live under the account's private
`data/users/<id>/attachments` directory. Authenticated URLs are used in chat
history; knowing an image ID does not grant another account access. Images remain
available after reloading the conversation. Back up this directory with the rest
of the account's data.

The default attachment storage quota is **512 MiB per account**. Configure it with
`OPENDOTS_ATTACHMENTS_QUOTA_MB`. Uploads that exceed the quota are refused; existing
conversation images are not automatically deleted. This initial version does not
include a media-library deletion screen. An upload completed before a later chat
request fails may also occupy quota.

When generating a reply, OpenDots loads verified image bytes from the account's
own storage and sends them inline to the model. Private URLs, session cookies and
server filesystem paths are not sent as image-fetch credentials. At most the
**12 most recent context images** are included; older images get an explicit text
notice so the model can request them again if needed. Previously stored safe
inline images remain supported. Unrecognized remote/server file URLs are never
fetched as attachment sources.

Use a model with image input support. OpenRouter lists `qwen/qwen3.8-27b` with
image input and tools; the model picker shows an eye icon for advertised image
support. Local Ollama models also need a compatible vision configuration. Model
providers receive uploaded image contents and bill their normal image/token rates.

## Verification

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm exec playwright install chromium
pnpm test:images:ui
```

For system Chromium, use
`OPENDOTS_CHROMIUM_PATH=/usr/bin/chromium pnpm test:images:ui`.

The browser test exercises the real + file chooser, actual clipboard image paste,
previews, removal, failed upload/retry, private uploads, image-only messages,
normal text paste, history reload, cross-account access and the mobile layout.
It runs a local model-response fixture and checks the actual Qwen/OpenRouter request
payload contains JPEG image data; it does not make a paid model call or claim a
physical mobile-device test. Server tests additionally verify EXIF removal,
orientation, source validation, quotas and bounded history hydration.
