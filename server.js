// MarTech Rescue Scheduler — Express server
// Storage: JSON files on disk (Replit persists files between runs)

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PUBLISHED_FILE = path.join(DATA_DIR, 'published.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me';
const MAX_BACKUPS = 20;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// STORAGE HELPERS
// ============================================================

// Atomic write: write to a temp file in the same directory, then rename().
// rename() is atomic on the same filesystem, so a crash mid-write can never
// leave a half-written / truncated JSON file behind.
function writeJSONAtomic(file, obj) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

// Parse a JSON file or throw. Callers decide what to do on failure.
function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// loadJSON: forgiving read used for derived/optional files (published.json).
function loadJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return readJSON(file);
  } catch (e) {
    console.error('loadJSON error', file, e);
    return fallback;
  }
}

// Snapshot the current state file into backups/, then prune to MAX_BACKUPS.
function backupStateFile() {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(STATE_FILE, path.join(BACKUP_DIR, `state-${stamp}.json`));
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('state-') && f.endsWith('.json'))
      .sort();
    while (files.length > MAX_BACKUPS) {
      const old = files.shift();
      try { fs.unlinkSync(path.join(BACKUP_DIR, old)); } catch (_) {}
    }
  } catch (e) {
    console.error('backupStateFile error', e);
  }
}

// Most recent backup that still parses, or null.
function latestGoodBackup() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('state-') && f.endsWith('.json'))
      .sort();
    for (let i = files.length - 1; i >= 0; i--) {
      try { return readJSON(path.join(BACKUP_DIR, files[i])); } catch (_) {}
    }
  } catch (_) {}
  return null;
}

function defaultState() {
  return {
    version: 1,
    employees: [
      { id: 1,  name: 'Christopher Wright', email: '', phone: '', dep: false, active: true },
      { id: 2,  name: 'Eugene Teves',       email: '', phone: '', dep: false, active: true },
      { id: 3,  name: 'Tim Moyles',         email: '', phone: '', dep: false, active: true },
      { id: 4,  name: 'James Bell',         email: '', phone: '', dep: false, active: true },
      { id: 5,  name: 'Brendan Wright',     email: '', phone: '', dep: false, active: true },
      { id: 6,  name: 'Brian Swanson',      email: '', phone: '', dep: false, active: true },
      { id: 7,  name: 'Cody De Lemos',      email: '', phone: '', dep: false, active: true },
      { id: 8,  name: 'Ryan Rose',          email: '', phone: '', dep: false, active: true },
      { id: 9,  name: 'James Magnuson',     email: '', phone: '', dep: false, active: true },
      { id: 10, name: 'Frank Zavala',       email: '', phone: '', dep: false, active: true },
      { id: 11, name: 'Travis Chamberlain', email: '', phone: '', dep: false, active: true },
      { id: 12, name: 'Justin Wilson',      email: '', phone: '', dep: false, active: true },
      { id: 13, name: 'James Craig',        email: '', phone: '', dep: false, active: true },
      { id: 14, name: 'Eugene Hernandez',   email: '', phone: '', dep: false, active: true },
      { id: 15, name: 'Xavier Ricci',       email: '', phone: '', dep: false, active: true },
      { id: 16, name: 'Kevin Crosby',       email: '', phone: '', dep: false, active: true },
      { id: 17, name: 'Matthew Landers',    email: '', phone: '', dep: false, active: true },
      { id: 18, name: 'Justin Nasello',     email: '', phone: '', dep: false, active: true },
      { id: 19, name: 'Tony Mo',            email: '', phone: '', dep: false, active: true },
      { id: 20, name: 'Craig Hunter',       email: '', phone: '', dep: false, active: true },
      { id: 21, name: 'John Loverin',       email: '', phone: '', dep: true,  active: true },
    ],
    nextEmpId: 22,
    jobs: [],
    nextJobId: 1,
    assignments: {},
    availability: {},      // 'YYYY_M' -> { empId: { days: [...], submittedAt, phone, email } }
    excludedMonthly: {},
    viewYear: new Date().getFullYear(),
    viewMonth: new Date().getMonth(),
    activeJobId: null,
  };
}

// Guarantee required fields + a numeric version, and migrate any legacy
// availability records (bare arrays) into the { days, ... } object shape.
function normalizeState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return defaultState();
  if (typeof state.version !== 'number') state.version = 1;
  if (!Array.isArray(state.employees)) state.employees = [];
  if (!Array.isArray(state.jobs)) state.jobs = [];
  if (!state.assignments || typeof state.assignments !== 'object') state.assignments = {};
  if (!state.availability || typeof state.availability !== 'object') state.availability = {};
  for (const key of Object.keys(state.availability)) {
    const month = state.availability[key];
    if (!month || typeof month !== 'object') { state.availability[key] = {}; continue; }
    for (const empId of Object.keys(month)) {
      const rec = month[empId];
      if (Array.isArray(rec)) {
        month[empId] = { days: rec.slice(), phone: '', email: '', submittedAt: null, migrated: true };
      }
    }
  }
  return state;
}

// Load state. On a corrupt state.json, NEVER silently reset to defaults
// (that path is what destroys real data). Instead: preserve the corrupt file,
// recover from the most recent good backup, and only fall back to defaults as
// a true last resort — logging loudly throughout.
function loadState() {
  if (!fs.existsSync(STATE_FILE)) return normalizeState(defaultState());
  try {
    return normalizeState(readJSON(STATE_FILE));
  } catch (e) {
    console.error('!!! state.json failed to parse:', e.message);
    try {
      const corrupt = path.join(DATA_DIR, `state.corrupt-${Date.now()}.json`);
      fs.copyFileSync(STATE_FILE, corrupt);
      console.error('!!! preserved corrupt file at', corrupt);
    } catch (_) {}
    const backup = latestGoodBackup();
    if (backup) {
      console.error('!!! recovered state from the latest good backup');
      return normalizeState(backup);
    }
    console.error('!!! no usable backup — starting from defaults (existing file preserved, not overwritten until next save)');
    return normalizeState(defaultState());
  }
}

function saveState(state) {
  normalizeState(state);
  backupStateFile();              // snapshot previous good version first
  writeJSONAtomic(STATE_FILE, state);
}

// ============================================================
// AUTH: rate-limited, constant-time admin password check
// ============================================================
const RL_WINDOW_MS = 15 * 60 * 1000;  // 15 minutes
const RL_MAX = 10;                     // max failed attempts per IP per window
const authAttempts = new Map();        // ip -> { count, first }

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
}
function rateLimited(req) {
  const rec = authAttempts.get(clientIp(req));
  if (!rec) return false;
  if (Date.now() - rec.first > RL_WINDOW_MS) { authAttempts.delete(clientIp(req)); return false; }
  return rec.count >= RL_MAX;
}
function recordFail(req) {
  const ip = clientIp(req);
  const rec = authAttempts.get(ip);
  if (!rec || Date.now() - rec.first > RL_WINDOW_MS) authAttempts.set(ip, { count: 1, first: Date.now() });
  else rec.count++;
}
function recordSuccess(req) { authAttempts.delete(clientIp(req)); }

function passwordOk(pw) {
  const a = Buffer.from(String(pw || ''));
  const b = Buffer.from(String(ADMIN_PASSWORD));
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch (_) { return false; }
}

function requireAdmin(req, res, next) {
  if (rateLimited(req)) return res.status(429).json({ error: 'Too many attempts. Wait a few minutes and try again.' });
  if (!passwordOk(req.get('X-Admin-Password') || '')) {
    recordFail(req);
    return res.status(401).json({ error: 'Admin password required' });
  }
  recordSuccess(req);
  next();
}

// ============================================================
// VALIDATION HELPERS
// ============================================================
function validEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}
function validState(s) {
  return s && typeof s === 'object' && !Array.isArray(s)
    && Array.isArray(s.employees)
    && Array.isArray(s.jobs)
    && s.availability && typeof s.availability === 'object'
    && s.assignments && typeof s.assignments === 'object';
}

// ============================================================
// PUBLIC ENDPOINTS
// ============================================================

// Auth check
app.post('/api/admin/check', (req, res) => {
  if (rateLimited(req)) return res.status(429).json({ ok: false, error: 'Too many attempts. Wait a few minutes and try again.' });
  const { password } = req.body || {};
  if (passwordOk(password)) {
    recordSuccess(req);
    res.json({ ok: true });
  } else {
    recordFail(req);
    res.status(401).json({ ok: false, error: 'Wrong password' });
  }
});

// Roster of active employees (for the submission form dropdown)
app.get('/api/roster', (req, res) => {
  const state = loadState();
  const list = state.employees
    .filter(e => e.active !== false)
    .map(e => ({ id: e.id, name: e.name }));
  res.json(list);
});

// Extract just the digits from a phone string.
// US-friendly: if the result is 11 digits and begins with a "1", drop the
// leading "1" so that +1 / 1-prefixed numbers match the 10-digit form on file.
// e.g. "+1 916-479-3029", "19164793029", and "(916) 479-3029" all → "9164793029".
function phoneDigits(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d;
}

// Verify the phone matches the named employee (active only). Compares digits
// only, so formatting doesn't matter. Returns { state, emp } on success, or
// sends an HTTP error and returns null on failure.
function verifyEmpAuth(req, res) {
  const { name, phone } = req.body || {};
  if (!name) { res.status(400).json({ error: 'name required' }); return null; }
  if (!phone) { res.status(400).json({ error: 'phone required' }); return null; }
  const state = loadState();
  const emp = state.employees.find(e => e.name === name && e.active !== false);
  if (!emp) { res.status(404).json({ error: 'Name not found in roster' }); return null; }
  const onFile = phoneDigits(emp.phone);
  if (!onFile) {
    res.status(400).json({ error: 'No phone number on file for this name. Ask admin to add yours in Manage Crew.' });
    return null;
  }
  if (phoneDigits(phone) !== onFile) {
    res.status(401).json({ error: 'Phone number does not match what we have on file for that name.' });
    return null;
  }
  return { state, emp };
}

// Phone check — used by the form before showing the day picker
app.post('/api/availability/pin-check', (req, res) => {
  const result = verifyEmpAuth(req, res);
  if (!result) return;
  res.json({ ok: true });
});

// Get a specific employee's availability for a month. Requires phone match.
app.post('/api/availability/lookup', (req, res) => {
  const { month, year } = req.body || {};
  if (!month || !year) return res.status(400).json({ error: 'month and year required' });
  const result = verifyEmpAuth(req, res);
  if (!result) return;
  const { state, emp } = result;
  const key = `${year}_${month - 1}`;
  const monthData = state.availability[key] || {};
  const record = monthData[emp.id];
  if (!record) return res.json({ found: false, employee: { id: emp.id, name: emp.name } });
  res.json({
    found: true,
    employee: { id: emp.id, name: emp.name },
    days: Array.isArray(record) ? record : (record.days || []),
    phone: record.phone || '',
    email: record.email || '',
    submittedAt: record.submittedAt || null,
  });
});

// Submit / update availability — requires phone match.
app.post('/api/availability/submit', (req, res) => {
  const { month, year, days, email } = req.body || {};
  if (!month || !year || !Array.isArray(days)) {
    return res.status(400).json({ error: 'month, year, days required' });
  }
  if (!validEmail(email)) {
    return res.status(400).json({ error: 'A valid email is required.' });
  }
  // Keep only sane day-of-month integers (1..31), de-duplicated.
  const cleanDays = [...new Set(days.map(Number).filter(d => Number.isInteger(d) && d >= 1 && d <= 31))]
    .sort((a, b) => a - b);

  const result = verifyEmpAuth(req, res);
  if (!result) return;
  const { state, emp } = result;

  const key = `${year}_${month - 1}`;
  if (!state.availability[key]) state.availability[key] = {};

  state.availability[key][emp.id] = {
    days: cleanDays,
    phone: emp.phone,            // store canonical roster value, not what they typed
    email: email.trim(),
    submittedAt: new Date().toISOString(),
  };
  emp.email = email.trim();

  state.version = (state.version || 0) + 1;   // invalidate stale admin caches
  saveState(state);
  res.json({ ok: true, employee: { id: emp.id, name: emp.name }, days: cleanDays });
});

// Get the published schedule (read-only for crew)
app.get('/api/published', (req, res) => {
  const pub = loadJSON(PUBLISHED_FILE, null);
  if (!pub) return res.status(404).json({ error: 'No schedule published yet' });
  res.json(pub);
});

// ============================================================
// CALENDAR FEED (per-crew live ICS subscription)
// ============================================================

// Generate or fetch the opaque token that identifies a crew member to their
// personal calendar feed URL. 32 chars of url-safe random, stored on the
// employee record. Admin can revoke by clearing the field in state.json.
function getOrCreateCalendarToken(emp, state) {
  if (typeof emp.calendarToken === 'string' && emp.calendarToken.length >= 24) {
    return emp.calendarToken;
  }
  emp.calendarToken = crypto.randomBytes(24).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  state.version = (state.version || 0) + 1;
  saveState(state);
  return emp.calendarToken;
}

// Return both the https:// and webcal:// subscription URLs for a verified
// crew member. Phone-verified, same gate as the other availability endpoints.
app.post('/api/availability/subscribe-url', (req, res) => {
  const result = verifyEmpAuth(req, res);
  if (!result) return;
  const { state, emp } = result;
  const token = getOrCreateCalendarToken(emp, state);
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  const host  = (req.get('x-forwarded-host')  || req.get('host')   || '').split(',')[0].trim();
  res.json({
    https:  `${proto}://${host}/api/myschedule.ics?token=${token}`,
    webcal: `webcal://${host}/api/myschedule.ics?token=${token}`,
  });
});

// Live ICS feed. Calendar apps poll this URL automatically with no UI, so
// the token in the query string IS the credential — there's no phone challenge
// here. Token is bound to a single employee record and is regenerable.
app.get('/api/myschedule.ics', (req, res) => {
  const token = String(req.query.token || '');
  if (token.length < 16) return res.status(400).type('text/plain').send('token required');
  const state = loadState();
  const emp = state.employees.find(e => e.calendarToken === token && e.active !== false);
  if (!emp) return res.status(404).type('text/plain').send('not found');

  const pub = loadJSON(PUBLISHED_FILE, null);
  const shifts = [];
  if (pub && pub.assignments) {
    const jobsById = {};
    (pub.jobs || []).forEach(j => { jobsById[j.id] = j; });
    const empsById = {};
    (pub.employees || []).forEach(e => { empsById[e.id] = e; });
    for (const key in pub.assignments) {
      const parts = key.split('_').map(Number);
      const y = parts[0], m = parts[1];
      const monthAsgns = pub.assignments[key];
      for (const slot in monthAsgns) {
        const sp = slot.split('_');
        if (parseInt(sp[0]) === emp.id) {
          const day = parseInt(sp[1]);
          const shift = sp[2] || 'day';
          const jid = monthAsgns[slot];
          const job = jobsById[jid] || {};
          // Find everyone ELSE on the same job, same day, same shift.
          const partners = [];
          for (const otherSlot in monthAsgns) {
            if (otherSlot === slot) continue;
            const osp = otherSlot.split('_');
            if (parseInt(osp[1]) !== day) continue;
            if ((osp[2] || 'day') !== shift) continue;
            if (monthAsgns[otherSlot] !== jid) continue;
            const pe = empsById[parseInt(osp[0])];
            if (pe) partners.push(pe.name);
          }
          partners.sort();
          shifts.push({
            y, m, day, shift,
            job: job.clientName || 'Job',
            start: job.startTime || '07:00',
            end:   job.endTime   || '17:00',
            notes: job.notes || '',
            partners,
          });
        }
      }
    }
    shifts.sort((a, b) => a.y - b.y || a.m - b.m || a.day - b.day);
  }

  const pad = n => String(n).padStart(2, '0');
  const esc = v => String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MarTech Rescue//Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + esc('My Schedule - ' + emp.name),
    'X-WR-CALDESC:' + esc('Live schedule for ' + emp.name + ' — auto-syncs from MarTech Rescue'),
    'X-PUBLISHED-TTL:PT1H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  ];
  shifts.forEach(s => {
    const dt = '' + s.y + pad(s.m + 1) + pad(s.day);
    const st = (s.start || '07:00').replace(':', '') + '00';
    const en = (s.end   || '17:00').replace(':', '') + '00';
    // Stable UID per (employee, date, shift) - if the assignment changes, the
    // SUMMARY updates in the subscriber's calendar without creating a duplicate.
    const uid = 'martech-' + emp.id + '-' + dt + '-' + s.shift + '@martech-rescue.local';
    // Compose a calendar title that surfaces the partner at a glance.
    let summary = s.job;
    if (s.partners.length === 1) {
      summary = s.job + ' — with ' + s.partners[0];
    } else if (s.partners.length === 2) {
      summary = s.job + ' — with ' + s.partners[0] + ' & ' + s.partners[1];
    } else if (s.partners.length > 2) {
      summary = s.job + ' — with ' + s.partners[0] + ' +' + (s.partners.length - 1) + ' more';
    }
    // Full crew + hours go in DESCRIPTION (shown when you tap the event).
    const crewLine = s.partners.length
      ? 'Crew today: ' + emp.name + ', ' + s.partners.join(', ')
      : 'Solo today';
    const notesLine = s.notes ? '\\nNotes: ' + s.notes.replace(/\r?\n/g, ' ') : '';
    const description = 'Job: ' + s.job + '\\n' + crewLine + '\\nHours: ' + s.start + ' – ' + s.end + notesLine;
    lines.push(
      'BEGIN:VEVENT',
      'UID:' + uid,
      'DTSTAMP:' + stamp,
      'DTSTART:' + dt + 'T' + st,
      'DTEND:'   + dt + 'T' + en,
      'SUMMARY:' + esc(summary),
      'DESCRIPTION:' + esc(description),
      'END:VEVENT'
    );
  });
  lines.push('END:VCALENDAR');

  res.set('Cache-Control', 'public, max-age=300');
  res.type('text/calendar; charset=utf-8');
  res.send(lines.join('\r\n'));
});

// ============================================================
// ADMIN ENDPOINTS
// ============================================================

// Get full state (includes version, used for optimistic concurrency)
app.get('/api/state', requireAdmin, (req, res) => {
  res.json(loadState());
});

// Save full state. Validates shape and enforces an optimistic-concurrency
// version check so a stale window cannot silently overwrite newer changes.
app.put('/api/state', requireAdmin, (req, res) => {
  const incoming = req.body;
  if (!validState(incoming)) {
    return res.status(400).json({ error: 'Invalid or incomplete state — refused to save (must include employees, jobs, availability, assignments).' });
  }
  const stored = loadState();
  const storedV = stored.version || 0;
  const incomingV = (typeof incoming.version === 'number') ? incoming.version : storedV;
  if (storedV !== 0 && incomingV !== storedV) {
    return res.status(409).json({
      error: 'stale',
      message: 'The schedule changed in another window or via a crew submission since this page loaded.',
      currentVersion: storedV,
    });
  }
  incoming.version = storedV + 1;
  saveState(incoming);
  res.json({ ok: true, version: incoming.version });
});

// Publish — write a snapshot for crew to read
app.post('/api/publish', requireAdmin, (req, res) => {
  const state = loadState();
  const snapshot = {
    publishedAt: new Date().toISOString(),
    employees: state.employees.filter(e => e.active !== false).map(e => ({ id: e.id, name: e.name })),
    jobs: state.jobs.filter(j => j.active !== false).map(j => ({
      id: j.id, clientName: j.clientName, startDate: j.startDate, endDate: j.endDate,
      startTime: j.startTime, endTime: j.endTime, workDays: j.workDays, teamSize: j.teamSize,
      notes: j.notes || '',
    })),
    assignments: state.assignments,
  };
  writeJSONAtomic(PUBLISHED_FILE, snapshot);
  res.json({ ok: true, publishedAt: snapshot.publishedAt });
});

// ============================================================
// ROUTES (serve HTML)
// ============================================================
app.get('/', (req, res) => res.redirect('/availability.html'));

app.listen(PORT, () => {
  console.log(`MarTech scheduler running on port ${PORT}`);
  console.log(`Admin password: ${ADMIN_PASSWORD === 'change-me' ? 'CHANGE-ME (set ADMIN_PASSWORD env var!)' : '[set]'}`);
});
