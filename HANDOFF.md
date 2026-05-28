# MarTech Rescue Scheduler — IT Handoff

This document is the deployment guide for taking the scheduler off Replit and hosting it on your own infrastructure.

## What it is

A small crew-scheduling web app for MarTech Rescue. Crew submit monthly availability through a phone-gated form, an admin assigns crew to jobs through a separate scheduler page, and the admin publishes a read-only schedule that crew can view on their phones. There is no SaaS dependency — the entire app is one Node.js process, a folder of static HTML, and two JSON files for persistence.

The admin can attach free-text notes to each job (parking, contact info, gear, gate codes) through a Notes pill on the scheduler. Crew see the notes both in the "See my schedule" day-detail dialog and in the live calendar subscription feed — a per-crew `webcal://` URL that any phone calendar (iOS, Google, Outlook) can subscribe to. Once subscribed, the crew member's phone calendar auto-updates each hour: new shifts, partner names ("Chili Bar — with Tim Moyles"), and notes flow through automatically.

## Tech stack

- **Runtime:** Node.js 20 (Node 18 works; 20 is what it has been running on).
- **Server:** Express 4.19.2. That is the *only* runtime dependency — see `package.json`.
- **Frontend:** Plain HTML/CSS/JavaScript in `public/`. No framework, no build step, no bundler.
- **Persistence:** JSON files in `./data/`. No database. No queue. No external services.
- **Auth:** Two layers. Crew authenticate by phone-number match (digits-only, leading-1 stripped). Admin authenticates by an `X-Admin-Password` HTTP header with constant-time comparison and basic per-IP rate limiting on failed attempts.

## Repository layout

```
server.js                    # Express app, all server logic in one file (~23 KB)
package.json                 # dependencies + start script
public/
  availability.html          # Crew-facing form (submit availability, view personal schedule)
  scheduler.html             # Admin-facing scheduler (job + assignment management)
  availability_view.html     # Admin-facing read-only roster + availability summary
  schedule_view.html         # Legacy redirect to availability.html
data/
  state.json                 # Full app state (employees, jobs, assignments, availability)
  published.json             # Snapshot pushed by admin when they hit "Publish"
  backups/                   # Auto-rotated snapshots written before each state save
HANDOFF.md                   # This file
Dockerfile                   # Optional containerized deploy
.env.example                 # Environment variable template
```

## Run requirements

- Outbound network access not required at runtime — the app does not call out to anything.
- Inbound: one HTTP port (default 3000, override via `PORT`).
- Disk: writes to `./data/state.json`, `./data/published.json`, and `./data/backups/*.json`. Needs read+write on the `data/` directory.
- RAM: trivial. The whole dataset is loaded into memory on each request — comfortable on 256 MB.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | no | `3000` | HTTP listen port |
| `ADMIN_PASSWORD` | **yes (for production)** | `change-me` | Required to call any admin endpoint. The default is a placeholder and unsafe to leave. Pick a long random string and set it in your hosting environment. James will share the current production password through a secure channel if you need to migrate state. |

A `.env.example` is in the repo. Copy to `.env` and fill in.

## How to run

**Local / bare Node:**

```bash
npm install
ADMIN_PASSWORD='choose-something-strong' PORT=3000 npm start
```

The console prints `MarTech scheduler running on port 3000` on success. Open `http://localhost:3000/` to confirm — it redirects to `/availability.html`.

**Docker (one-command):**

```bash
docker build -t martech-rescue .
docker run -d --name martech-rescue \
  -p 3000:3000 \
  -e ADMIN_PASSWORD='choose-something-strong' \
  -v /var/lib/martech-rescue/data:/app/data \
  --restart unless-stopped \
  martech-rescue
```

The bind-mount on `/app/data` is critical — without it the JSON state is lost on container recreation.

## HTTP endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/` | none | Redirects to `/availability.html` |
| GET | `/availability.html` | none | Crew-facing availability form |
| GET | `/scheduler.html` | client-side admin prompt | Admin scheduler UI |
| GET | `/availability_view.html` | client-side admin prompt | Admin roster view |
| GET | `/api/roster` | none | Names list for the dropdown |
| POST | `/api/availability/pin-check` | phone match | Verify crew identity before showing form |
| POST | `/api/availability/lookup` | phone match | Read a crew member's saved availability |
| POST | `/api/availability/submit` | phone match | Submit or update availability |
| GET | `/api/published` | none | Latest published schedule snapshot |
| POST | `/api/admin/check` | password | Validate admin password |
| GET | `/api/state` | password | Full state dump (admin) |
| POST | `/api/publish` | password | Promote current state to `published.json` |
| POST | `/api/availability/subscribe-url` | phone match | Mint (or fetch existing) opaque token, return https:// and webcal:// subscription URLs |
| GET | `/api/myschedule.ics` | token in query string | Live per-crew ICS feed — calendar apps poll this every hour |

Admin endpoints take the password in the `X-Admin-Password` header. The ICS feed endpoint is deliberately token-only (no header) because calendar apps cannot send custom headers when polling — the token is the entire credential.

**Per-job notes** ride along on the same publish flow: the admin types them in the scheduler's Notes pill, they save to `state.json` under each job, and the `/api/publish` snapshot copies them into `published.json` along with the other job fields. Crew see them in the calendar event DESCRIPTION (live feed) and in the day-detail dialog (See my schedule).

## Data and backup model

`server.js` writes `data/state.json` atomically and snapshots the previous version to `data/backups/state-<timestamp>.json` before each save. On startup, if the main file is corrupted, the server falls back to the most recent good backup. Backups self-prune past `MAX_BACKUPS` (defined in `server.js`).

**Backup strategy you should run alongside the app:** nightly tarball of `./data/` to wherever your offsite backups live. The dataset is small (single-digit KB to low MB).

**Restore:** copy a known-good `state.json` and `published.json` into `./data/` while the process is stopped, then start the process.

## Security model

- **Crew identity** is verified by exact match of the phone number on file (digits only, leading `1` country code is normalized away). No password, no SMS verification — the phone match is the entire crew-side authentication.
- **Admin identity** is a single shared password compared with `crypto.timingSafeEqual`. After 10 failed attempts from one IP, that IP is locked out for a few minutes (`recordFail` / `rateLimited` in `server.js`).
- **No HTTPS in the app itself.** Terminate TLS at your reverse proxy (nginx, Cloudflare, ALB, etc.) and forward to the Node process over HTTP on the configured `PORT`. The app does not look at `X-Forwarded-For` for rate limiting — if you need accurate per-IP limits behind a proxy, add `app.set('trust proxy', true)` near the top of `server.js`.
- **No CSRF protection on admin endpoints.** The admin UI is gated by the password header; treat the admin pages as something to expose only to a trusted network or behind your SSO. If you put the scheduler on the open internet, consider adding origin checks or wrapping the admin endpoints behind your IdP.
- **Calendar feed tokens** are 32-char url-safe random strings stored on each employee record (`calendarToken` field in `state.json`). They are minted on demand the first time a phone-verified crew member requests their subscribe URL. A leaked token only exposes one person's own shift schedule — no PII, no other crew's data — but tokens currently have no expiry. To revoke a token (e.g. a crew member changes phone), clear the field on their employee record in `state.json`; the next subscribe-url request will mint a fresh one. Consider adding a TTL or admin "rotate" button if you start dealing with sensitive customer addresses in job notes.

## What to drop when migrating off Replit

Files that exist only because the app was running on Replit and should be deleted when self-hosting:

- `.replit` — Replit run config.
- `replit.nix` — Replit Nix package config.
- `.local/` — Replit Agent's local scaffolding.

These do not affect the Node process; they are config for Replit's UI.

## Migrating live data from the current Replit deployment

The current production data lives in Replit at `./data/state.json` and `./data/published.json`. Two ways to move it:

1. **Via Replit's file pane:** download both JSON files from Replit, drop them into your new host's `./data/` folder before starting the process.
2. **Via the admin API:** while the Replit instance is still running, `curl -H 'X-Admin-Password: ...' https://<replit-url>/api/state > state.json`. That returns the full state JSON. There is no equivalent endpoint for `published.json`, so download that one directly via Replit's file pane.

## Known quirks worth flagging

- **Static HTML caching.** The browser cache can show stale versions of `availability.html` and `scheduler.html` after a deploy. Adding cache-busting query strings (`?v=<commit-sha>`) to the script/style refs is the proper fix; today users are told to hard-refresh (Ctrl+Shift+R).
- **`server.js` requires a process restart to pick up changes.** Replit's "Republish" did not always restart the Node process; we hit this during deployment. If you wire up a CD pipeline, make sure it actually restarts the Node process (or use a process manager like PM2 that watches `server.js`).
- **No structured logging.** The server writes to stdout. If you want structured logs, wrap with `pino` or a logger middleware.

## Single source of truth

GitHub repo: <https://github.com/650get-cell/rescue>

James can grant IT push access if you want the canonical repo to live with you. Otherwise, treat the GitHub copy as the snapshot at the moment of handoff and fork into your own org.

## Questions

If anything in this doc doesn't match what you see in the code, the code wins. Open `server.js` — it is small enough that reading it top to bottom is the fastest way to verify behaviour.
