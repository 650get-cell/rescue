// MarTech Rescue Scheduler — Express server
// Storage: PostgreSQL (durable across restarts / deploys). Two logical blobs
// live in the `kv_store` table: 'state' (the full admin state) and 'published'
// (the crew-facing snapshot). Point-in-time snapshots of state go into
// `state_backups`. Legacy data/*.json files are used only to seed an empty
// database on first boot.

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PUBLISHED_FILE = path.join(DATA_DIR, 'published.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me';
const MAX_BACKUPS = 20;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.on('error', (err) => console.error('Unexpected PG pool error', err));

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// wrap: adapt async route handlers so a rejected promise is forwarded to the
// Express error middleware instead of hanging the request (Express 4 quirk).
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ============================================================
// STORAGE HELPERS (PostgreSQL-backed)
// ============================================================

// Parse a JSON file or throw. Used only when seeding from legacy files.
function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Read a JSON blob from kv_store. Returns the parsed object, or null if absent.
// pg automatically parses jsonb columns into JS values.
async function readKV(key) {
  const { rows } = await pool.query('SELECT value FROM kv_store WHERE key = $1', [key]);
  return rows.length ? rows[0].value : null;
}

// Upsert a JSON blob into kv_store.
async function writeKV(key, value) {
  await pool.query(
    `INSERT INTO kv_store (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
}

// Most recent backup, or null.
async function latestGoodBackup() {
  try {
    const { rows } = await pool.query('SELECT data FROM state_backups ORDER BY id DESC LIMIT 1');
    return rows.length ? rows[0].data : null;
  } catch (_) {
    return null;
  }
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

// Load state from the database. Falls back to the most recent backup, then to
// defaults, if the primary row is somehow missing.
async function loadState() {
  const raw = await readKV('state');
  if (raw != null) return normalizeState(raw);
  const backup = await latestGoodBackup();
  if (backup) {
    console.error('!!! state row missing — recovered from the latest backup');
    return normalizeState(backup);
  }
  return normalizeState(defaultState());
}

// Atomic read-modify-write for the 'state' blob. Serializes all state
// mutations via a transaction-scoped advisory lock so concurrent writers can
// never clobber each other (last-writer-wins) or bypass the optimistic
// version check. `fn(state)` receives the current normalized state and returns
// the object to persist; return null/undefined to make no change (no write,
// no backup). The previous committed value is snapshotted into state_backups
// in the same transaction, so backups always correspond to committed versions.
async function withStateTxn(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('kv_store:state'))");
    const { rows } = await client.query("SELECT value FROM kv_store WHERE key = 'state'");
    const stateRow = rows.length ? rows[0].value : null;

    // Baseline to mutate from. If the state row is missing, recover from the
    // latest backup (same semantics as loadState) rather than starting from
    // defaults, which would silently discard recoverable data on first write.
    let baseline = stateRow;
    if (baseline == null) {
      const bk = await client.query('SELECT data FROM state_backups ORDER BY id DESC LIMIT 1');
      if (bk.rows.length) {
        console.error('!!! state row missing in withStateTxn — recovering from latest backup');
        baseline = bk.rows[0].data;
      }
    }
    const stored = normalizeState(baseline != null ? baseline : defaultState());

    const toWrite = await fn(stored);

    if (toWrite != null) {
      normalizeState(toWrite);
      // Only snapshot an actual committed state row; when we recovered from a
      // backup there is nothing new to back up (that value is already a backup).
      if (stateRow != null) {
        await client.query('INSERT INTO state_backups (data) VALUES ($1::jsonb)', [JSON.stringify(stateRow)]);
        await client.query(
          `DELETE FROM state_backups
             WHERE id NOT IN (SELECT id FROM state_backups ORDER BY id DESC LIMIT $1)`,
          [MAX_BACKUPS]
        );
      }
      await client.query(
        `INSERT INTO kv_store (key, value, updated_at) VALUES ('state', $1::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [JSON.stringify(toWrite)]
      );
    }

    await client.query('COMMIT');
    return toWrite;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

// Seed the two blobs from legacy JSON files when the database is empty (first
// boot in a fresh environment such as production). The schema itself (the
// kv_store and state_backups tables) is owned by the environment: it is created
// in development via Replit's managed database tooling and applied to production
// automatically by the Publish flow's schema diff — the app must not run DDL.
async function initDb() {
  await seedIfEmpty('state', STATE_FILE, () => defaultState());
  await seedIfEmpty('published', PUBLISHED_FILE, () => null);
}

async function seedIfEmpty(key, file, fallbackFn) {
  const existing = await readKV(key);
  if (existing != null) return;
  let value = null;
  let fromFile = false;
  try {
    if (fs.existsSync(file)) { value = readJSON(file); fromFile = true; }
  } catch (e) {
    console.error('seed read error', file, e);
  }
  if (value == null) value = fallbackFn();
  if (value == null) return;   // nothing to seed (e.g. no published file yet)
  await writeKV(key, value);
  console.log(`Seeded '${key}' from ${fromFile ? 'legacy file' : 'defaults'}`);
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
app.get('/api/roster', wrap(async (req, res) => {
  const state = await loadState();
  const list = state.employees
    .filter(e => e.active !== false)
    .map(e => ({ id: e.id, name: e.name }));
  res.json(list);
}));

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
async function verifyEmpAuth(req, res) {
  const { name, phone } = req.body || {};
  if (!name) { res.status(400).json({ error: 'name required' }); return null; }
  if (!phone) { res.status(400).json({ error: 'phone required' }); return null; }
  const state = await loadState();
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
app.post('/api/availability/pin-check', wrap(async (req, res) => {
  const result = await verifyEmpAuth(req, res);
  if (!result) return;
  res.json({ ok: true });
}));

// Get a specific employee's availability for a month. Requires phone match.
app.post('/api/availability/lookup', wrap(async (req, res) => {
  const { month, year } = req.body || {};
  if (!month || !year) return res.status(400).json({ error: 'month and year required' });
  const result = await verifyEmpAuth(req, res);
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
}));

// Submit / update availability — requires phone match.
app.post('/api/availability/submit', wrap(async (req, res) => {
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

  const result = await verifyEmpAuth(req, res);
  if (!result) return;
  const empId = result.emp.id;
  const empName = result.emp.name;
  const submittedDigits = phoneDigits(req.body.phone);

  await withStateTxn((state) => {
    const emp = state.employees.find(e => e.id === empId && e.active !== false);
    // Re-check auth inside the transaction: the roster phone could have changed
    // between the pre-txn auth check and now (TOCTOU). Reject if it no longer matches.
    if (!emp || phoneDigits(emp.phone) !== submittedDigits) {
      throw Object.assign(new Error('Authorization no longer valid — the roster changed. Please re-verify.'), { httpStatus: 409 });
    }

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
    return state;
  });
  res.json({ ok: true, employee: { id: empId, name: empName }, days: cleanDays });
}));

// Get the published schedule (read-only for crew)
app.get('/api/published', wrap(async (req, res) => {
  const pub = await readKV('published');
  if (!pub) return res.status(404).json({ error: 'No schedule published yet' });
  res.json(pub);
}));

// ============================================================
// CALENDAR FEED (per-crew live ICS subscription)
// ============================================================

// Generate (once) the opaque token that identifies a crew member to their
// personal calendar feed URL. 32 chars of url-safe random, stored on the
// employee record. Admin can revoke by clearing the field in state. The
// read-modify-write runs inside withStateTxn so it can't race other writers.
async function getOrCreateCalendarToken(empId, submittedDigits) {
  let token;
  await withStateTxn((state) => {
    const emp = state.employees.find(e => e.id === empId && e.active !== false);
    // Re-check auth inside the transaction (TOCTOU): reject if the roster phone
    // no longer matches the phone this request authenticated with.
    if (!emp || phoneDigits(emp.phone) !== submittedDigits) {
      throw Object.assign(new Error('Authorization no longer valid — the roster changed. Please re-verify.'), { httpStatus: 409 });
    }
    if (typeof emp.calendarToken === 'string' && emp.calendarToken.length >= 24) {
      token = emp.calendarToken;
      return null;   // already has a token — no write needed
    }
    token = crypto.randomBytes(24).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    emp.calendarToken = token;
    state.version = (state.version || 0) + 1;
    return state;
  });
  return token;
}

// Return both the https:// and webcal:// subscription URLs for a verified
// crew member. Phone-verified, same gate as the other availability endpoints.
app.post('/api/availability/subscribe-url', wrap(async (req, res) => {
  const result = await verifyEmpAuth(req, res);
  if (!result) return;
  const { emp } = result;
  const token = await getOrCreateCalendarToken(emp.id, phoneDigits(req.body.phone));
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  const host  = (req.get('x-forwarded-host')  || req.get('host')   || '').split(',')[0].trim();
  res.json({
    https:  `${proto}://${host}/api/myschedule.ics?token=${token}`,
    webcal: `webcal://${host}/api/myschedule.ics?token=${token}`,
  });
}));

// Live ICS feed. Calendar apps poll this URL automatically with no UI, so
// the token in the query string IS the credential — there's no phone challenge
// here. Token is bound to a single employee record and is regenerable.
app.get('/api/myschedule.ics', wrap(async (req, res) => {
  const token = String(req.query.token || '');
  if (token.length < 16) return res.status(400).type('text/plain').send('token required');
  const state = await loadState();
  const emp = state.employees.find(e => e.calendarToken === token && e.active !== false);
  if (!emp) return res.status(404).type('text/plain').send('not found');

  const pub = await readKV('published');
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
}));

// ============================================================
// ADMIN ENDPOINTS
// ============================================================

// Get full state (includes version, used for optimistic concurrency)
app.get('/api/state', requireAdmin, wrap(async (req, res) => {
  res.json(await loadState());
}));

// Save full state. Validates shape and enforces an optimistic-concurrency
// version check so a stale window cannot silently overwrite newer changes.
app.put('/api/state', requireAdmin, wrap(async (req, res) => {
  const incoming = req.body;
  if (!validState(incoming)) {
    return res.status(400).json({ error: 'Invalid or incomplete state — refused to save (must include employees, jobs, availability, assignments).' });
  }
  let newVersion;
  try {
    await withStateTxn((stored) => {
      const storedV = stored.version || 0;
      const incomingV = (typeof incoming.version === 'number') ? incoming.version : storedV;
      if (storedV !== 0 && incomingV !== storedV) {
        throw Object.assign(new Error('stale'), { stale: true, currentVersion: storedV });
      }
      incoming.version = storedV + 1;
      newVersion = incoming.version;
      return incoming;   // persist the client's full state as the new value
    });
  } catch (e) {
    if (e && e.stale) {
      return res.status(409).json({
        error: 'stale',
        message: 'The schedule changed in another window or via a crew submission since this page loaded.',
        currentVersion: e.currentVersion,
      });
    }
    throw e;
  }
  res.json({ ok: true, version: newVersion });
}));

// Publish — write a snapshot for crew to read
app.post('/api/publish', requireAdmin, wrap(async (req, res) => {
  const state = await loadState();
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
  await writeKV('published', snapshot);
  res.json({ ok: true, publishedAt: snapshot.publishedAt });
}));

// ============================================================
// ROUTES (serve HTML)
// ============================================================
app.get('/', (req, res) => res.redirect('/availability.html'));

// Error handler — anything a wrapped async route rejects with lands here.
app.use((err, req, res, next) => {
  console.error('Unhandled request error:', err);
  if (res.headersSent) return next(err);
  if (err && Number.isInteger(err.httpStatus)) {
    return res.status(err.httpStatus).json({ error: err.message || 'Request failed' });
  }
  res.status(500).json({ error: 'Internal server error' });
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`MarTech scheduler running on port ${PORT}`);
      console.log(`Admin password: ${ADMIN_PASSWORD === 'change-me' ? 'CHANGE-ME (set ADMIN_PASSWORD env var!)' : '[set]'}`);
      console.log('Storage: PostgreSQL');
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database — not starting server:', err);
    process.exit(1);
  });
