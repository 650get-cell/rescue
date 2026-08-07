# Changelog

All notable changes to the MarTech Rescue Scheduler are listed here.

Version format: `MAJOR.MINOR.PATCH`
- **PATCH** — bug fix, no behavior change for the admin/crew
- **MINOR** — new feature, no breaking changes
- **MAJOR** — anything that changes existing behavior in a way people will notice

Bump the `version` field in `package.json` before each deploy, then add an entry
here describing what changed.

---

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
