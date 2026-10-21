# Accounts and built-in connectors

OpenDots now requires an account before any private API, event stream or model
configuration can be accessed. Sign up with an email address and a password of at
least 12 characters. Each account then supplies its **own OpenRouter key** in the
onboarding screen. The deployment's `OPENROUTER_API_KEY` is never inherited by
signed-in users.

Passwords use salted scrypt. Session cookies are HttpOnly, SameSite=Lax and Secure
on HTTPS; only session hashes are persisted. Logout revokes the session and closes
its event and conversation streams. Mutations require a same-origin client header. There is no email
verification, password reset or MFA flow yet; email is the local login identifier.

Private PGlite databases, encryption key files, workspaces, queues, schedules, mail
pollers and event channels live under `data/users/<user-id>`. OAuth refresh/access
tokens and personal API keys are encrypted with AES-256-GCM and never included in
connector DTOs or model tool inputs. Back up **all of data**, including key files.
`OPENDOTS_SECRET_KEY` optionally supplies a deployment-wide encryption key instead.

The account registry uses `data/auth/pg`. Account databases use PGlite even when
`DATABASE_URL` is defined: sharing the old database between accounts would defeat
isolation. `DATABASE_URL` remains available to trusted scripts outside an account
context. One Node process must own these embedded databases. Memory consumption
grows with active accounts; this is currently intended for small deployments.

Signed-in users cannot execute commands on the server host. Their companions use
separate Docker containers and mounts per account. Without Docker, shell execution
is unavailable. Advanced MCP servers and plugins containing MCP connectors are
reserved for the deployment administrator because stdio servers execute host code.
The built-in catalog works for ordinary users without MCP setup.

## Built-in catalog

| Service | Available operations |
| --- | --- |
| Google Drive | Search, read text/Docs/Sheets/Slides, create text files |
| Google Calendar | List calendars, read events, create events/invitations |
| Gmail | Search/read mail, list/create labels, create drafts, send mail |
| Outlook / Microsoft 365 | Search/read mail, drafts, send mail, calendars/events |
| GitHub | Repositories, issues, PRs, search, create issues/comments; with **code** permission (`repo` + `workflow`): create private/public repositories, branches, pull requests, merge PRs and `git push` from the companion's Docker computer |
| IMAP / SMTP | Standard mail reading/polling and approved sending |

Users select permissions before connecting. Reading is selected by default;
writing is optional. All built-in writes, including drafts and invitations, create
an approval request. No provider mutation occurs before approval. Permissions,
account ownership and enabled state are checked again when approval executes.
Changing the generic connector `approval` field cannot bypass this rule.

OAuth scopes can be broader than the operations exposed by OpenDots (GitHub's
`repo`, Microsoft's `Mail.ReadWrite`, for example). The consent screen explains
this. Google Docs export is supported; binary PDFs/images are metadata-only.
Search/list operations return bounded pages, not a complete mailbox or repository
export. IMAP/SMTP uses the existing provider presets or custom server settings;
IMAP and SMTP require TLS or STARTTLS by default; the explicit
`OPENDOTS_MAIL_INSECURE_TLS=1` setting is only for local development fixtures.
Google/Microsoft accounts should prefer the OAuth catalog entries when password
authentication is disabled by the provider.

## One-time OAuth setup by the operator

A self-hosted application cannot use Google/Microsoft/GitHub OAuth without an
application registered with each provider. This registration belongs to the
**operator once**, not to each end user. No paid search service or additional
connector subscription is required; provider account and organization policies
still apply.

1. Sign up your operator account, then **stop the OpenDots server**. PGlite must not
   be opened by two Node processes at once.
2. Run `pnpm auth:admin operator@example.com` with the same `OPENDOTS_DATA_DIR` and
   encryption-key environment as the server. There is no automatic first-user
   administrator privilege on a public deployment.
3. Restart OpenDots and sign in. In **Connectors → Applications OAuth du
   déploiement**, configure the application's Client ID and secret. Secrets are
   encrypted on the server. These settings are hidden from ordinary accounts.
4. Alternatively inject the environment variables in `.env.example`; environment
   configuration takes precedence and cannot be changed through the UI.

Register these **exact** callback URLs for the requested public deployment:

| Provider | Callback |
| --- | --- |
| Google | `https://opendots.snyders.xyz/api/integrations/oauth/callback/google` |
| Microsoft | `https://opendots.snyders.xyz/api/integrations/oauth/callback/microsoft` |
| GitHub | `https://opendots.snyders.xyz/api/integrations/oauth/callback/github` |

For local development, use the URL shown in the administrator panel (normally
`http://localhost:5173/api/integrations/oauth/callback/...` if opened on localhost).
OAuth permits HTTP only on loopback hosts. Use one consistent browser origin;
localhost and 127.0.0.1 have different cookies.

- **Google:** register a Web application, enable Drive API, Calendar API and Gmail
  API, configure the consent screen and requested scopes. In testing mode, add
  allowed test accounts. Gmail/Drive scopes may require Google's verification
  before general public use. Google testing-mode refresh tokens may expire after
  seven days.
- **Microsoft:** register a Web application in Entra, allow both organizational
  directories and personal accounts if needed, add delegated Graph permissions
  shown in the permission chooser, and create a client secret. Tenant policy can
  require administrator consent.
- **GitHub:** register an OAuth App with the exact callback. Organization SSO and
  third-party application restrictions may require organization approval.
  The permission **Créer des dépôts, pousser du code et ouvrir des PR** requests
  `repo` and `workflow`; existing connections must be reconnected with it.

### GitHub write operations and `git push`

Every write operation (`github_repo_create`, `github_branch_create`,
`github_pr_create`, `github_pr_merge`, `github_push`) is a prepared action that
runs only after human approval. The **code** permission must be selected in
OpenDots; selecting private-repository access alone does not enable these actions.
Companions make commits with their normal shell in their isolated computer.
Push and merge approvals display and retain the exact commit SHA:

- a merge sends GitHub's expected `sha`; a changed PR head requires a new approval;
- a push exports a credential-free Git bundle from the account's Docker computer
  (network enabled, sudo disabled). A branch changed since preparation is rejected;
- the server imports objects into a fresh private bare repository, validates them,
  and pushes the approved SHA to `https://github.com/<owner>/<repo>.git`. It never
  copies the source repository's configuration, hooks, alternates, or home folder;
- the server needs `/usr/bin/git`. Only the server's Git transport receives the
  OAuth token. The companion container receives no token, and cannot see the
  server's PID namespace or temporary repository;
- TLS verification remains enabled; HTTP redirects are disabled. Proxy and CA
  settings come from the trusted server environment. Source repository settings
  cannot override them. Temporary snapshots are removed after success or failure;
- source bundle export is limited to 128 MiB / 60 seconds; authenticated transport
  to 180 seconds. `set_upstream` updates local tracking after a successful push.

Pending push/merge approvals created by older versions have no captured SHA and
are refused; prepare a new action. On upgrade, managed shell/search containers
with the old mount configuration are recreated automatically to apply SELinux
labels. Workspace bind mounts retain the companion's files; install additional
system packages through a custom image if they must survive recreation.

Then ordinary users click **Connect**, select access, and sign in directly with
the provider in a popup. Authorization uses one-time state, PKCE S256 and a
browser-bound cookie. Expired access tokens refresh automatically where the
provider issues refresh tokens. Reconnect preserves identity and replaces grants;
disconnect deletes local tokens. To withdraw provider consent as well, remove
OpenDots in the provider's authorized-applications settings (Google revocation
can affect several connections to the same Google account). Microsoft has no
per-token revocation endpoint in this implementation.

## Public deployment for opendots.snyders.xyz

Create an Infomaniak **A** record: host `opendots`, value `83.228.215.124`.
DNS contains neither `http://` nor `:3000`. DNS creation requires authorized
Infomaniak DNS access; documenting this record does not create it.

Run the app with these environment variables and put your HTTPS reverse proxy in
front of it:

```sh
export OPENDOTS_PORT=3000
export OPENDOTS_HOST=127.0.0.1
export OPENDOTS_PUBLIC_URL=https://opendots.snyders.xyz
pnpm build
pnpm start
```

If the proxy runs in another container/machine, bind the application to its private
interface (or 0.0.0.0 with a firewall); do not expose the upstream port publicly.
Example Caddy configuration when the proxy runs on the same host:

```caddyfile
opendots.snyders.xyz {
    reverse_proxy 127.0.0.1:3000
}
```

Preserve Host and Origin and allow streaming responses. The public URL must be
HTTPS before users enter credentials. `.env.example` lists variables; inject them
through your process manager or export them in the shell (the app does not load
`.env` automatically). Set `OPENDOTS_REGISTRATION=closed` to close new signups.
`OPENDOTS_TOKEN` is legacy trusted-script support and does not replace account
sessions in the public server.

## Existing installations

Existing `data/pg`, `data/workspaces` and `data/secret.key` remain untouched. They
are deliberately **not assigned to the first person who signs up**. Make an
operator-controlled migration of that legacy workspace before replacing an
existing public installation; the new login does not automatically expose its
old shared data. Never copy a running PGlite directory. Legacy webhook URLs must
be replaced with the account-specific URLs shown in the new interface.

## Verification

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:ui
pnpm test:search:live
```

For an existing Chromium binary, use
`OPENDOTS_CHROMIUM_PATH=/usr/bin/chromium pnpm test:ui`.

The normal suite covers actual local HTTP OAuth exchanges and all 25 provider
operations, encrypted tokens, refresh/replay/expiry/denial, cross-account access,
approval/rejection/idempotence, local IMAP/SMTP servers and Docker filesystem
separation. The browser smoke runs the built app with real local accounts,
cookies and HTTP requests. It seeds a fixture key instead of billing an OpenRouter
account, and intercepts the external consent page. It does **not** certify live
Google/Microsoft/GitHub consent or production credentials. Verify those with
operator-registered apps and authorized test accounts before enabling public
OAuth access. The separate search smoke uses real search engines and public pages.
