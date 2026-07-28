# Claude Handoff — MarTech Rescue Scheduler

Read this first if you're picking up work on this project. It captures institutional knowledge that isn't obvious from the code.

---

## What this project is

A crew-scheduling web app for MarTech Rescue (a small industrial cleaning / rescue services company). James Bell (owner) uses it to:

1. Collect monthly availability from ~22 crew members (phone-gated form)
2. Build the job schedule (create jobs, assign crew, add notes)
3. Publish the schedule for crew to view on their phones
4. Give each crew member a live calendar subscription (`webcal://`) that auto-updates on their phone

Stack is deliberately minimal: **Node 20 + Express 4** + JSON files on disk. No database, no framework, no build step. Everything is in `server.js` (~600 lines) + four HTML pages in `public/`.

Read `HANDOFF.md` for the IT-facing deployment doc. Read `CHANGELOG.md` for what's shipped in each version.

---

## Who James is (working with him)

- **Not a developer.** He runs the business. He can edit files in Notepad, use GitHub Desktop, and click buttons on Replit. That's the ceiling.
- **Windows + PowerShell** environment. Never assume Linux/Mac paths on his side.
- **Wants verb-first instructions.** "Click X. Type Y. Press Enter." Not "you might want to consider..."
- **Hates jargon.** Say "the letters after the version" not "the git short SHA."
- **Verb-first verdicts on recommendations.** Lead with Delete / Keep / Optional, then explain.
- **Never put two filenames in one sentence if one is a deletion candidate** — he'll delete the wrong one.
- **He does not run code locally.** Everything happens through GitHub Desktop → Replit web UI. No terminal, no `git` commands from his side.
- **He does not want to enter his admin password on your behalf.** The admin password is intentionally NOT rotated. Test admin features with synthetic data or on his behalf via the browser session where he's already logged in.
- **He does NOT delete files.** He'll do the delete himself once you name the exact file. Do NOT run `rm` on files in his working directory.

Detailed collaboration memory: `spaces/*/memory/james-collaboration-style.md` and `feedback-clear-instructions.md`.

---

## Two-Replit deploy pipeline (CRITICAL — easy to get wrong)

There are **TWO** Replit accounts running this app:

| Role | URL | Repl | Owner |
|---|---|---|---|
| **DEV / build** | `spock.replit.dev:5000` (rotating) | `replit.com/@650get/rescue` | James's `@650get` account |
| **PROD / live crew** | `rescue-reliabilitydiv.replit.app` | (different repl) | `reliabilitydiv` account (someone else) |

**Both connect to the same GitHub repo:** `github.com/650get-cell/rescue`.

**Deploy flow James actually uses:**

1. Claude edits files locally in `C:\Claude Projects\rescue-git\` (via bash → /tmp → cp to mount; see "Mount gotchas" below).
2. James commits + pushes in **GitHub Desktop**.
3. James opens **@650get/rescue on Replit** → Git panel → **Sync**.
4. James runs `kill 1` in the **Replit Shell** to restart the Node process.
5. James hard-refreshes with **Ctrl+Shift+R** (not F5).
6. To go live for crew: James separately moves the changes to `rescue-reliabilitydiv`. Ask him how he wants to do it — he sometimes forgets this step and thinks the crew are seeing the change when they're not.

**Never say "deployed" when only step 4 is done.** Say "deployed to dev" and remind him about prod.

---

## Common failure modes and their instant fixes

### Replit is serving an old file even though GitHub is up to date

Symptom: page renders empty, or the version chip in the footer shows an OLD commit hash.

**Root cause:** Replit's auto-generated state.json changes prevent Git Sync from pulling. Silent failure.

**Fix (Replit Shell, one line):**
```
git fetch origin && git reset --hard origin/main && kill 1
```

This force-syncs to match GitHub exactly, discards Replit's local noise, and restarts.

Verify: hard-refresh the page and check the version chip's commit hash matches the latest commit in GitHub Desktop's History tab.

### A file has been "regressed" to an older, feature-stripped version

Happened on 2026-07-10: `availability.html`, `availability_view.html`, `server.js`, `scheduler.html` all had features stripped out at various times, even though GitHub's latest commit had the good code. Suspect Replit's auto-Publish overwrote GitHub with stale local snapshots.

**Fix:** find a good commit in `git log` and restore from it:
```
git show <good-commit>:<path> > /tmp/<file>
cp -a /tmp/<file> <path>
```

Good commits to check (as of 2026-07-13):
- `5236849` — "Add per-job notes, calendar feed, and IT handoff bundle" → good `server.js` (553 lines) and `availability.html` (904 lines)
- `a0afcb7` — "Update availability_view.html" → good `availability_view.html` (1179 lines, complete with `boot()` call)

The `5236849` version of `availability_view.html` is truncated at line 1132 mid-`boot()` (missing the closing braces and the `boot()` call at the end). Don't use it — use `a0afcb7`.

### `.git/index.lock` blocks GitHub Desktop

James can't run shell commands, so tell him to:
1. File Explorer → View → Show → Hidden items (checkbox on)
2. Navigate to `C:\Claude Projects\rescue-git\.git\`
3. Delete `index.lock`

---

## Mount gotchas (working on files in `C:\Claude Projects\`)

The bash mount at `/sessions/*/mnt/Claude Projects/` has quirks:

1. **`Edit` and `Write` tools silently TRUNCATE large files** (>1000 lines). Symptom: file gets cut off mid-line, JS parse errors, missing closing tags.

   **Workaround:** for any file edit larger than ~100 lines, work in `/tmp` and `cp -a` to the mount:
   ```bash
   # read from mount
   cp -a "/sessions/.../mnt/.../file.html" /tmp/file.html
   # edit /tmp/file.html with Python or sed
   # copy back
   cp -a /tmp/file.html "/sessions/.../mnt/.../file.html"
   ```

2. **`git rm`, `rm -rf .git/*`, and `.git/index.lock` deletion** all fail with "Operation not permitted." Ask James to delete via File Explorer instead.

3. **`core.fileMode` drift** — git shows every file as modified due to executable-bit differences. Fix once with `git config --local core.fileMode false` right after cloning.

4. **Verify writes stuck.** After a bash write, always `wc -l` and `tail -3` to confirm the file is intact. If truncated, restore from git and redo the edit in /tmp.

---

## Version tracking (added 2026-07-13)

Every admin page shows a small chip in the bottom-left corner: `v1.1.0 · abc1234`.

- **Version** comes from `package.json`'s `version` field. Bump manually before each deploy (semver: PATCH for fixes, MINOR for features, MAJOR for breaking changes).
- **Commit hash** is auto-captured at server startup via `git rev-parse --short HEAD` (with a fallback to reading `.git/HEAD`).
- Both are served by `GET /api/version` (public, no auth).
- Chip HTML is injected inline at the bottom of `scheduler.html`, `availability_view.html`, and `admin.html`.

**Why this exists:** to instantly verify a deploy landed. If the chip shows an old hash after a deploy, the fix is the `git reset --hard` one-liner above.

**Add an entry to `CHANGELOG.md` for each version bump.** Format: `## X.Y.Z — YYYY-MM-DD` followed by bullet points of what changed.

---

## File map

```
server.js                      # Express app, all backend logic. Single file.
package.json                   # Deps (express only), version, start script.
CHANGELOG.md                   # Version history — update every deploy.
HANDOFF.md                     # IT-facing deployment doc.
CLAUDE.md                      # THIS FILE — for future Claude sessions.
README.md                      # Quick project overview.
Dockerfile / .dockerignore     # Optional containerized deploy for IT.
.env.example                   # Env var template.
.replit / replit.nix           # Replit config (delete when migrating off Replit).
data/state.json                # Full app state. NEVER edit by hand at runtime.
data/published.json            # Snapshot admin created via Publish. Crew reads this.
data/backups/                  # Auto-rotated state snapshots (writeJSONAtomic).
public/admin.html              # Admin landing hub (button cards). Password-gated.
public/scheduler.html          # Main admin scheduler. Password-gated.
public/availability_view.html  # Admin calendar of everyone's availability. Password-gated.
public/availability.html       # Crew-facing form + personal "See my schedule" popup.
public/schedule_view.html      # Legacy — redirects to availability.html now.
```

---

## HTTP endpoints (from server.js)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/` | none | Redirects to `/availability.html` |
| GET | `/api/version` | none | `{version, commit, startedAt}` for footer chip |
| GET | `/api/roster` | none | Active employees list for the crew form dropdown |
| POST | `/api/availability/pin-check` | phone match | Verify crew identity |
| POST | `/api/availability/lookup` | phone match | Get crew's saved availability for a month |
| POST | `/api/availability/submit` | phone match | Submit/update availability |
| POST | `/api/availability/subscribe-url` | phone match | Mint per-crew calendar token, return https + webcal URLs |
| GET | `/api/myschedule.ics` | token in query | Live per-crew ICS calendar feed (calendar apps poll hourly) |
| GET | `/api/published` | none | Latest published schedule snapshot |
| POST | `/api/admin/check` | password | Validate admin password |
| GET | `/api/state` | password | Full state dump (admin scheduler reads this) |
| PUT | `/api/state` | password | Save full state (with optimistic-concurrency version check) |
| POST | `/api/availability/admin-set` | password | Admin edits/deletes a single crew member's month |
| POST | `/api/publish` | password | Snapshot current state to published.json |

Admin auth: `X-Admin-Password` header, `crypto.timingSafeEqual`, per-IP rate limiting (10 fails → few min lockout).

Crew auth: phone digits match against roster (digits-only, leading `1` stripped).

---

## Frontend patterns worth knowing

- **All admin pages** cache the password in `sessionStorage['martech_admin_pw']`. If you need to skip the login prompt during automation, set it before load.
- **All admin pages** open a browser `prompt('Admin password:')` at boot if no cached password. Native prompts freeze Claude-in-Chrome automation — use `fetch` from the console instead when scripting E2E tests.
- **The scheduler `Publish` button** triggers a native `confirm()` — CDP can't dismiss that either. To automate publishing, call `POST /api/publish` with the header from the JS console.
- **scheduler.html** has a "Show all crew" toggle in the day-modal and fill-popup that lets admin assign crew who didn't submit availability (they get a "no avail" badge). Look for `_showAllCrew`, `dmShowAllCrewToggle`, `fpShowAllCrewToggle`.
- **availability.html** contains a full personal "See my schedule" popup with day-click dialog + Add-to-calendar + Subscribe-to-live-calendar buttons. If you don't see `showMySchedule()` in the file, it's been regressed — restore from git.
- **availability_view.html** shows a month-by-month calendar with names in each day cell + edit-submission modal. If page renders header-only with blank body, the file is truncated (missing `boot()` at the end) — restore from `a0afcb7`.

---

## Environment quirks

- Replit **Shell has no `node` on PATH**. Don't try `node server.js` there. Just `kill 1`.
- The dev preview `spock.replit.dev:5000` URL includes a session ID that changes when James restarts the Repl. Always ask him to paste the current URL if you need to script against it.
- The mount doesn't have `node_modules` — if you need to actually run server.js to smoke-test, copy the project to `/tmp/rescue-test/`, `npm install`, and run there.
- `.git/index.lock` deletion needs File Explorer (see above).
- Replit's runtime writes to state.json and backup snapshots constantly. This blocks `git pull` — use the `git reset --hard` one-liner instead.

---

## Testing patterns

**Syntax check server.js:**
```bash
node -c "/sessions/.../mnt/Claude Projects/rescue-git/server.js"
```

**Live test the running app** (assumes James's browser tab is at the dev preview URL):

Use Claude-in-Chrome MCP → `javascript_tool` with top-level `await`:
```js
const r = await fetch('/api/version'); ({ status: r.status, body: await r.text() })
```

The `browser_batch` tool works but returns EMPTY payloads when using promise-chain syntax — always use `await` in a single `javascript_tool` call for real data.

**Full local smoke test** (needs node_modules):
```bash
mkdir -p /tmp/rescue-test && cp -a "/sessions/.../mnt/Claude Projects/rescue-git/"* /tmp/rescue-test/ && cd /tmp/rescue-test && npm install --silent && PORT=3999 node server.js &
sleep 1
curl -sS http://localhost:3999/api/version
pkill -f "node server.js"
```

---

## Related memory files (in `spaces/*/memory/`)

- `james-collaboration-style.md` — how James wants to work
- `feedback-clear-instructions.md` — the verb-first, plain-language rule
- `rescue-scheduler-locations.md` — file paths, URLs, environment gotchas, Replit-sync fix
- `rescue-scheduler-two-replits.md` — dev vs prod Replit accounts
- `rescue-scheduler-hardening.md` — the 2026-05-21 security hardening pass
- `rescue-scheduler-export-feature.md` — Excel export design decisions
- `rescue-scheduler-mobile-ics.md` — mobile-friendly + Add-to-calendar
- `rescue-scheduler-notes-and-feed.md` — per-job notes + live ICS subscription feed

---

## When you finish work

1. Bump `version` in `package.json` (semver rules above).
2. Add an entry to `CHANGELOG.md` describing what changed.
3. Tell James verb-first: "Deploy: GitHub Desktop → Commit + Push → Replit Sync → Shell `kill 1` → Ctrl+Shift+R."
4. Tell him to verify the version chip in the bottom-left matches the new version + fresh commit hash.
5. If the change is user-facing, remind him to also move it to `rescue-reliabilitydiv` for the crew.
