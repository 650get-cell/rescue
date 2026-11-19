const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('public/rescue-book.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/);
const source = script[1];
const parsedIds = new Set([...html.slice(0, script.index).matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));

// Minimal DOM harness runs the real page script and its registered handlers.
function page() {
  function element() {
    const classes = new Set();
    const el = {
      hidden: false, style: {}, dataset: {}, children: [], textContent: '', value: '',
      focus() { el.focused = true; },
      handlers: {},
      classList: {
        add: c => classes.add(c),
        remove: c => classes.delete(c),
        toggle(c, force) {
          const on = force === undefined ? !classes.has(c) : force;
          if (on) classes.add(c); else classes.delete(c);
          return on;
        },
      },
      addEventListener: (name, fn) => { el.handlers[name] = fn; },
      appendChild: child => el.children.push(child),
      querySelector: () => el.check,
    };
    Object.defineProperty(el, 'innerHTML', {
      set(value) {
        el.children = [];
        if (value.includes('doc-check on')) {
          el.check = element();
          el.check.classList.add('on');
        }
      },
    });
    el.hasClass = c => classes.has(c);
    return el;
  }
  const nodes = new Map();
  const get = id => {
    if (!parsedIds.has(id)) return null;
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  const document = {
    getElementById: get,
    createElement: element,
    addEventListener() {},
    querySelectorAll(selector) {
      const rows = get('docSelList').children;
      if (selector === '#docSelList .doc-sel') return rows;
      if (selector === '#docSelList .doc-check.on') {
        return rows.map(r => r.check).filter(c => c.hasClass('on'));
      }
      return [];
    },
  };
  const context = vm.createContext({ document, window: { scrollTo() {}, print() {} }, alert() {} });
  vm.runInContext(source, context);
  return { get, run: code => vm.runInContext(code, context), click: id => get(id).handlers.click() };
}

test('hidden attribute overrides grid and inline display styles', () => {
  assert.match(html, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});

test('new job opens before selecting an existing job, validates, creates, and cancels', () => {
  const p = page();
  p.click('newJobBtn');
  assert.equal(p.get('view-new').hidden, false);
  assert.equal(p.get('view-dashboard').hidden, true);
  p.click('nj-create');
  assert.equal(p.get('nj-customer').focused, true);
  p.click('nj-cancel');
  assert.equal(p.get('view-dashboard').hidden, false);
  p.click('newJobBtn');
  p.get('nj-customer').value = 'Test facility';
  p.get('nj-space').value = 'Test space';
  p.click('nj-create');
  assert.equal(p.get('view-new').hidden, true);
  assert.equal(p.get('view-job').hidden, false);
  assert.equal(p.get('jobCust').textContent, 'Test facility');
});

test('ALL, NONE, generate, and job navigation are safe before selecting a job', () => {
  const p = page();
  p.click('allBtn');
  p.click('noneBtn');
  p.click('generateBtn');
  p.click('goBookBtn');
  p.run('renderDocSelect(); resetBook();');
  assert.equal(p.get('bookCount').textContent, '0 OF 0');
  assert.equal(p.get('generateBtn').disabled, true);
  assert.equal(p.get('view-dashboard').hidden, false);
  assert.equal(p.get('view-book').hidden, true);
});

test('job selection, ALL/NONE, generation, back navigation, and job switching work', () => {
  const p = page();
  p.run('openJob(JOBS[0])');
  p.click('goBookBtn');
  assert.equal(p.get('view-dashboard').hidden, true);
  assert.equal(p.get('view-book').hidden, false);
  assert.equal(p.get('bookCount').textContent, '4 OF 4');
  p.click('noneBtn');
  assert.equal(p.get('genCount').textContent, 0);
  assert.equal(p.get('generateBtn').disabled, true);
  p.click('generateBtn');
  assert.equal(p.get('postGenActions').hidden, true);
  p.click('allBtn');
  assert.equal(p.get('generateBtn').disabled, false);
  p.click('generateBtn');
  assert.equal(p.get('postGenActions').hidden, false);
  assert.equal(p.get('preGenActions').hidden, true);
  p.click('backBtn');
  assert.equal(p.get('view-job').hidden, false);
  p.run('openJob(JOBS[1])');
  p.click('goBookBtn');
  assert.equal(p.get('bookCust').textContent, p.run('JOBS[1].customer'));
  assert.equal(p.get('postGenActions').hidden, true);
  assert.equal(p.get('preGenActions').hidden, false);
  assert.equal(p.get('bookCount').textContent, '4 OF 4');
});
