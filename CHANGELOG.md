# Changelog

All notable changes to the MarTech Rescue Scheduler are listed here.

Version format: `MAJOR.MINOR.PATCH`
- **PATCH** — bug fix, no behavior change for the admin/crew
- **MINOR** — new feature, no breaking changes
- **MAJOR** — anything that changes existing behavior in a way people will notice

Bump the `version` field in `package.json` before each deploy, then add an entry
here describing what changed.

---

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
