# MarTech Rescue Scheduler

Complete crew scheduler with availability submissions, admin tools, and a published schedule view.

## Pages

- **`/availability.html`** — Crew submission form (default landing page). Crew picks name from dropdown, enters phone + email, picks days, submits. Returning visitors get their previous submission pre-filled — they can update and resubmit.
- **`/schedule_view.html`** — Read-only published schedule. Crew filter to their own name to highlight their assigned days. Updates only when admin clicks Publish.
- **`/scheduler.html`** — Admin scheduler. Password-protected. Create jobs, assign crew (auto or manual), manage roster, publish.
- **`/availability_view.html`** — Admin's second-window companion. Password-protected. Calendar of who's available each day. Includes Edit Submission — pick any employee + month, toggle days, save instantly. Also create-from-scratch and delete.

## Setup on Replit

1. **Set the admin password.** In your Replit project, open the Secrets panel (lock icon, left sidebar). Add:
   - Key: `ADMIN_PASSWORD`
   - Value: pick any password
2. **Click Run.** Replit installs `express` and starts the server.
3. **Open the URL** Replit gives you.
   - Default lands on `/availability.html` (crew form)
   - Add `/scheduler.html` for the admin tool (will prompt for password)
   - Add `/availability_view.html` for the second-window admin tool (same password)
   - Add `/schedule_view.html` for the read-only crew view

## Typical workflow

1. Send the **base URL** (or `/availability.html`) to crew so they submit availability.
2. As submissions come in, you build the schedule in `/scheduler.html`. Open `/availability_view.html` in a second window so you can see who's free at a glance while you work. Edit submissions from the availability view if needed.
3. Click **Publish** in the scheduler when ready. This snapshots the current state for crew to see.
4. Crew opens `/schedule_view.html` and sees the published schedule. Filter by name to highlight their days.
5. Things change — re-edit, re-publish.

## Sharing tips

- **Crew get** the base URL (form) and `/schedule_view.html` (read-only).
- **You keep** the `/scheduler.html` and `/availability_view.html` URLs to yourself — they're admin-only.

## Data

All data is stored in `data/state.json` (full state) and `data/published.json` (snapshot crew sees). Replit persists these between runs. To reset, delete the files.

## Notes

- Editing in `/scheduler.html` and `/availability_view.html` saves to the same server-side state, so they always agree.
- The schedule view (`schedule_view.html`) doesn't update until you click Publish. This is intentional — crew shouldn't see half-built schedules.
