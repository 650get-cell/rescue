// MarTech Rescue Scheduler — Express server
// Storage: JSON files on disk (Replit persists files between runs)

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PUBLISHED_FILE = path.join(DATA_DIR, 'published.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// STORAGE HELPERS
// ============================================================
function loadJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error('loadJSON error', file, e);
    return fallback;
  }
}
function saveJSON(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

function defaultState() {
  return {
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

function loadState() {
  return loadJSON(STATE_FILE, defaultState());
}
function saveState(state) { saveJSON(STATE_FILE, state); }

// ============================================================
// AUTH MIDDLEWARE (admin only)
// ============================================================
function requireAdmin(req, res, next) {
  const pw = req.get('X-Admin-Password') || '';
  if (pw !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Admin password required' });
  }
  next();
}

// ============================================================
// PUBLIC ENDPOINTS
// ============================================================

// Auth check
app.post('/api/admin/check', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ ok: true });
  } else {
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

// Helper: extract just the digits from a phone string
function phoneDigits(s) {
  return String(s || '').replace(/\D/g, '');
}

// Helper: verify the phone matches the named employee (active only).
// Compares digits-only, so format ((209) 555-1234, 2095551234, etc.) doesn't matter.
// Returns the employee on success, or sends an HTTP error and returns null on failure.
// If the employee has no phone on file, treat as not-yet-set-up — admin must add it.
function verifyEmpAuth(req, res) {
  const { name, phone } = req.body;
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

// Get a specific employee's availability for a month (so they can review/edit)
// Requires phone match.
app.post('/api/availability/lookup', (req, res) => {
  const { month, year } = req.body;
  if (!month || !year) {
    return res.status(400).json({ error: 'name, month, year required' });
  }
  const result = verifyEmpAuth(req, res);
  if (!result) return;
  const { state, emp } = result;
  const key = `${year}_${month - 1}`;
  const monthData = state.availability[key] || {};
  const record = monthData[emp.id];
  if (!record) {
    return res.json({ found: false, employee: { id: emp.id, name: emp.name } });
  }
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
  const { month, year, days, email } = req.body;
  if (!month || !year || !Array.isArray(days)) {
    return res.status(400).json({ error: 'name, month, year, days required' });
  }
  if (!email) {
    return res.status(400).json({ error: 'email is required' });
  }
  const result = verifyEmpAuth(req, res);
  if (!result) return;
  const { state, emp } = result;

  const key = `${year}_${month - 1}`;
  if (!state.availability[key]) state.availability[key] = {};

  state.availability[key][emp.id] = {
    days: days.slice().sort((a, b) => a - b),
    phone: emp.phone, // store the canonical version from the roster, not what they typed
    email: email.trim(),
    submittedAt: new Date().toISOString(),
  };

  // Update email on the master record (phone is the auth, doesn't change here)
  if (email) emp.email = email.trim();

  saveState(state);
  res.json({ ok: true, employee: { id: emp.id, name: emp.name }, days: state.availability[key][emp.id].days });
});

// Get the published schedule (read-only for crew)
app.get('/api/published', (req, res) => {
  const pub = loadJSON(PUBLISHED_FILE, null);
  if (!pub) return res.status(404).json({ error: 'No schedule published yet' });
  res.json(pub);
});

// ============================================================
// ADMIN ENDPOINTS
// ============================================================

// Get full state (admin scheduler reads everything)
app.get('/api/state', requireAdmin, (req, res) => {
  res.json(loadState());
});

// Save full state (admin writes everything)
app.put('/api/state', requireAdmin, (req, res) => {
  const newState = req.body;
  if (!newState || typeof newState !== 'object') {
    return res.status(400).json({ error: 'Invalid state' });
  }
  saveState(newState);
  res.json({ ok: true });
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
    })),
    assignments: state.assignments,
  };
  saveJSON(PUBLISHED_FILE, snapshot);
  res.json({ ok: true, publishedAt: snapshot.publishedAt });
});

// ============================================================
// ROUTES (serve HTML)
// ============================================================
app.get('/', (req, res) => res.redirect('/availability.html'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`MarTech scheduler running on port ${PORT}`);
  console.log(`Admin password: ${ADMIN_PASSWORD === 'change-me' ? 'CHANGE-ME (set ADMIN_PASSWORD env var!)' : '[set]'}`);
});
