# MarTech Rescue Scheduler — IT Handoff

Deployment guide for hosting the Rescue Scheduler outside Replit. Current as of version **1.12.0** (2026-11-18). If anything here disagrees with `server.js`, the code wins.

## What it is

A small web app for MarTech Rescue's confined space rescue crew:

- **Crew** submit monthly availability from their phones, view their published schedule, and can subscribe to a live calendar feed.
- **Admin** builds jobs and crew assignments, publishes the schedule, and builds job estimates (quotes).
- **Ventilation Calculator** — a public, no-login tool for crew and customers.

One Node.js process, a folder of static HTML, and a PostgreSQL database.

## Tech stack

- **Runtime:** Node.js 20 (what it runs on today).
- **Dependencies:** `express` 4 and `pg` 8. See `package.json`.
- **Frontend:** plain HTML/CSS/JavaScript in `public/`. No framework, no build step.
- **Storage:** PostgreSQL. Required; the server will not start without a reachable database.
- **Fonts:** pages load Inter and Syne from Google Fonts. That is the only outbound call, and it is made by the browser, not the server.

## Package contents

```
server.js            Express app — all server logic in one file
package.json         Dependencies, version, start script
package-lock.json    Lockfile for npm ci
public/              All pages (see Pages below)
db/schema.sql        Tables the app expects (run once on a new database)
Dockerfile           Optional container build
.dockerignore
.env.example         Environment variable template
HANDOFF.md           This file
CHANGELOG.md         Version history
README.md            Original end-user notes; describes the older JSON-file storage — use this HANDOFF for deployment
```

Not included on purpose: live data (`data/`), Replit config, and internal development notes. See "Migrating live data" for the data.

## Pages

| Path | Who | Auth |
|---|---|---|
| `/` | — | Redirects to `/availability.html` |
| `/availability.html` | Crew | Phone-number match. Links to the Ventilation Calculator. |
| `/schedule_view.html` | Crew | None (read-only published schedule) |
| `/ventilation` and `/ventilation.html` | Crew and customers | None. Runs entirely in the browser — no server calls. |
| `/admin.html` | Admin | Admin password. Hub page linking to the admin tools. |
| `/scheduler.html` | Admin | Admin password. Desktop scheduler. |
| `/scheduler-mobile.html` | Admin | Admin password. Phone scheduler. |
| `/availability_view.html` | Admin | Admin password. Availability roster. |
| `/estimator.html` | Admin | Admin password. Job estimates / quotes. |

Admin pages are static files that prompt for the password in the browser; the protection is on the API endpoints behind them.

## API endpoints

| Method | Path | Auth |
|---|---|---|
| GET | `/api/version` | none — returns version and git commit |
| GET | `/api/roster` | none |
| GET | `/api/published` | none |
| POST | `/api/availability/pin-check` | phone match |
| POST | `/api/availability/lookup` | phone match |
| POST | `/api/availability/submit` | phone match |
| POST | `/api/availability/subscribe-url` | phone match |
| GET | `/api/myschedule.ics?token=…` | per-crew token |
| POST | `/api/admin/check` | password |
| GET / PUT | `/api/state` | password |
| POST | `/api/publish` | password |
| GET | `/api/quotes` | password |
| PUT / DELETE | `/api/quotes/:id` | password |
| POST | `/api/admin/subscribe-url` | password |
| POST | `/api/admin/subscribe-rotate` | password |
| GET | `/api/admin/schedule.ics?token=…` | admin feed token |

Admin endpoints take the password in the `X-Admin-Password` header. Calendar feed endpoints use a token in the query string because calendar apps cannot send headers.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | **yes** | — | PostgreSQL connection string, e.g. `postgres://user:pass@host:5432/dbname`. For a host that requires TLS, append `?sslmode=require`. |
| `ADMIN_PASSWORD` | **yes** | `change-me` | Admin password. The default is a placeholder; never deploy with it. Get the production value from James through a secure channel. |
| `PORT` | no | `3000` | HTTP listen port |

## Database

The app does **not** create its own tables. Run `db/schema.sql` once against a new, empty database before first start:

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

Two tables:

- `kv_store` — three JSON rows keyed `state` (employees, jobs, availability, assignments), `published` (the crew-facing snapshot) and `quotes` (job estimates).
- `state_backups` — a snapshot of the previous `state` value is written before every save; the app keeps the most recent 20 (`MAX_BACKUPS` in `server.js`).

`schema.sql` is written from the queries in `server.js`. If you have access to the current Replit database, compare it against the live schema (`\d kv_store`, `\d state_backups` in psql) before relying on it.

On first start against an empty database, the app seeds `state` with a default roster. To carry over live data, see below.

## How to run

**Bare Node:**

```bash
npm ci --omit=dev
psql "$DATABASE_URL" -f db/schema.sql      # first time only
DATABASE_URL='postgres://…' ADMIN_PASSWORD='…' PORT=3000 npm start
```

Success prints `MarTech scheduler running on port 3000` and `Storage: PostgreSQL`. If the database is unreachable the process exits with `Failed to initialize database`.

**Docker:**

```bash
docker build -t martech-rescue .
docker run -d --name martech-rescue \
  -p 3000:3000 \
  -e DATABASE_URL='postgres://…' \
  -e ADMIN_PASSWORD='…' \
  --restart unless-stopped \
  martech-rescue
```

All data lives in PostgreSQL, so the container itself holds nothing that needs a volume. The image's `/app/data` volume is left over from the older JSON-file storage and is not needed.

## Migrating live data from Replit

Production currently runs on Replit (`rescue-reliabilitydiv.replit.app`) with a Replit-managed PostgreSQL database. Options:

1. **Database dump (simplest, complete).** From the Replit Shell of the production repl: `pg_dump "$DATABASE_URL" --data-only -t kv_store -t state_backups > rescue.sql`, download it, then `psql "$NEW_DATABASE_URL" -f rescue.sql` after running `schema.sql`.
2. **Through the API.** `GET /api/state` and `GET /api/quotes` with the `X-Admin-Password` header return those two blobs; `GET /api/published` returns the published snapshot. Insert each into `kv_store` under keys `state`, `quotes` and `published`.

Do the migration while the old instance is not being edited, then point crew at the new URL.

## Security notes

- **Crew login is the phone number on file.** No password or SMS code. Phone numbers in the database are effectively credentials — treat the database and any dump of it as sensitive.
- **Admin** is one shared password, compared in constant time, with a lockout after 10 failed attempts per IP in 15 minutes.
- **No HTTPS in the app.** Terminate TLS at a reverse proxy or load balancer. Rate limiting reads the first `X-Forwarded-For` address, so make sure your proxy sets that header (and strips any client-supplied one).
- **No CSRF protection on admin endpoints.** Consider limiting admin pages to a trusted network or putting them behind SSO.
- **Calendar tokens** do not expire. To revoke one crew member's feed, clear `calendarToken` on their employee record in `state`. The admin feed token can be rotated from the scheduler.

## Operational notes

- **Restart on deploy.** `server.js` changes need a process restart. Use a process manager (systemd, PM2) or the container restart policy.
- **Browser caching.** After a deploy, users may need a hard refresh (Ctrl+Shift+R) to see new pages.
- **Version check.** `GET /api/version` returns the running version and git commit. If deployed without the `.git` folder, the commit shows `nogit`; that is expected.
- **Logs** go to stdout.
- **Backups.** Run your normal PostgreSQL backup on this database. The in-app `state_backups` table is a short history, not an offsite backup.

## Source

GitHub repo: <https://github.com/650get-cell/rescue>. James can grant access if IT wants to own the repo.
