# Changelog

All notable changes to the MarTech Rescue Scheduler are listed here.

Version format: `MAJOR.MINOR.PATCH`
- **PATCH** — bug fix, no behavior change for the admin/crew
- **MINOR** — new feature, no breaking changes
- **MAJOR** — anything that changes existing behavior in a way people will notice

Bump the `version` field in `package.json` before each deploy, then add an entry
here describing what changed.

---

## 1.6.0 — 2026-08-07

- **New (mobile):** tapping a day on the calendar now opens the day's job detail INLINE between the week rows (Google-Calendar style), instead of scrolling down to a list below. Shows each job on that day with times, filled/needed count, and green pills for assigned crew (dashed red "Unassigned" pills for empty slots). Tap the ✕ or the day again to close. Tap any job in the detail to open the assign modal.

## 1.5.5 — 2026-08-07

- **Style (mobile):** simplified version chip to show only the version number (e.g. `v1.5.5`). Dropped the commit hash from the visible text — the hash is still returned by `/api/version` for anyone who needs it, just not shown in the header.

## 1.5.4 — 2026-08-06

- **Style (mobile):** version indicator changed from red pill to plain grey uppercase text matching the "MOBILE SCHEDULER" subtitle. Sits inline right after it in the header.

## 1.5.3 — 2026-08-06

- **Style (mobile):** version chip moved to the top header, inline next to "MOBILE SCHEDULER" text — red pill with white text, always visible in the sticky header while scrolling.

## 1.5.2 — 2026-08-06

- **Fix (mobile):** version chip was hidden behind the sticky Publish bar. Moved it inline with the "Last published" text at the bottom so it's always visible. Now you can verify at a glance which version is running on your phone.

## 1.5.1 — 2026-08-06

- **Mobile:** tapping a day on the calendar now shows the full assignment for that day inline — each job on that day lists the assigned crew (green pills) plus any unfilled slots (dashed red "Unassigned" pills). No need to open the assign modal just to check who's on what. Tap the job card to open the modal if you want to change anything.

## 1.5.0 — 2026-08-06

- **Mobile scheduler rebuilt around a sticky header:** (1) horizontal-scroll row of pills for jobs in the current month — tap a pill to open that job's assign-crew modal; (2) collapsible + Add Job button that expands the form when tapped and collapses back on save/cancel. Body area (below the sticky header) shows the month calendar grid and a jobs list, with more scroll room than before.

## 1.4.0 — 2026-08-06

- **Redesign (mobile scheduler):** now uses the same card + form layout as the crew availability page — dark header, uppercase field labels, red focus borders. Top: job creation form. Middle: month calendar grid with colored bars per job (tap a day to filter). Bottom: jobs list. Sticky Publish button. Tap a job in the list to open the assign-crew modal, or hit "Edit job" to load it back into the form at the top.

## 1.3.1 — 2026-08-06

- **New (mobile):** compact calendar grid at the top of the mobile scheduler. Each day shows colored bars per job. Tap a day to filter the list below to just that day's jobs. Tap again to clear.

## 1.3.0 — 2026-08-06

- **New:** mobile-friendly scheduler at `/scheduler-mobile.html`. Purpose-built for field use on a phone: sticky top bar with month navigation + big "+ Add Job" button; vertical scrollable job list; tap a job to assign crew day-by-day; sticky Publish button at the bottom. Uses the same data as the desktop scheduler — any change syncs both ways. Also linked as a new tile on the admin hub.

## 1.2.0 — 2026-08-06

- **New:** admin can subscribe to the full schedule (every job, every crew) via a live calendar feed. Click "Subscribe (calendar)" in the scheduler header → modal shows webcal:// and https:// URLs. Works with iOS, Google Calendar, Outlook. Feed auto-refreshes hourly.
- Rotate button revokes the current link and issues a fresh one.

## 1.1.4 — 2026-08-06

- **Style:** "My Schedule" heading larger (22px → 30px). All three top buttons (Subscribe, Add to calendar, Back to form) now the same pill shape and size, in larger 17px font.

## 1.1.3 — 2026-08-06

- **Style:** version chip font bumped from 12px to 14px. Back-to-form pill on See my schedule popup bumped from 14px to 16px. Both easier to read.

## 1.1.2 — 2026-08-06

- **Style:** version chip on admin pages now uses black background with white text (matches the app header). Easier to read against the light page background.

## 1.1.1 — 2026-08-06

- **Fix:** "See my schedule" popup now has a **← Back to form** button in the header. Previously crew had no way to close the popup other than closing the browser tab.

## 1.1.0 — 2026-07-13

- **New:** admin landing page at `/admin.html`. Big button cards linking to Scheduler, Availability View, and the Crew Availability Form. Password-gated. Bookmark it as your admin homepage.
- Same version + commit-hash footer as the other admin pages.
- **Fix:** admin password comparison now trims leading/trailing whitespace so accidental spaces from paste or autofill don't cause "Wrong password."

## 1.0.0 — 2026-07-10

Baseline version. Includes everything currently in production:

- Crew-facing monthly availability form with phone-gated auth
- Admin scheduler with job management, drag-to-assign, per-job notes pill
- "See my schedule" personal calendar view for crew (green button on availability page)
- `/api/myschedule.ics` live calendar subscription feed — auto-updates hourly on subscribed phones
- Per-job notes flow through to the crew's day-detail dialog and calendar event descriptions
- Admin availability view with month-grid calendar showing everyone's submitted days
- Show All Crew toggle on scheduler pickers (assign someone who didn't submit availability)
- Excel calendar export from scheduler with pastel job palette
- Hardened admin auth: `crypto.timingSafeEqual` password check + per-IP rate limiting
- Leading-1 US country code normalization on phone match
- Atomic state.json writes + auto-rotated backups in `data/backups/`
- Version + commit-hash footer on admin pages (this feature)
- `/api/version` public endpoint returning `{version, commit, startedAt}`
