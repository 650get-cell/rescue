const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('public/analytics.js', 'utf8');
function setup(umami) {
  const window = { umami };
  vm.runInNewContext(source, { window });
  return window;
}

test('works without the injected tracker, including late injection', () => {
  const window = setup();
  assert.doesNotThrow(() => window.trackEvent('crew_verified'));
  const events = [];
  window.umami = { track: (...args) => events.push(args) };
  window.trackEvent('crew_verified');
  assert.equal(events[0][0], 'crew_verified');
});

test('does not forward personal data, free text, or unknown events', () => {
  const events = [];
  const window = setup({ track: (...args) => events.push(args) });
  window.trackEvent('schedule_published', {
    surface: 'mobile', name: 'PRIVATE', phone: 'PRIVATE', notes: 'PRIVATE',
  });
  window.trackEvent('unknown_event');
  window.trackEvent('availability_submitted', { days: 'PRIVATE' });
  window.trackEvent('schedule_published', { surface: 'PRIVATE' });
  assert.equal(JSON.stringify(events), JSON.stringify([
    ['schedule_published', { surface: 'mobile' }],
    ['availability_submitted', {}],
    ['schedule_published', {}],
  ]));
});

test('tracker exceptions and rejected promises do not break application flows', async () => {
  const window = setup({ track: () => { throw new Error('offline'); } });
  assert.doesNotThrow(() => window.trackEvent('crew_verified'));
  window.umami.track = () => Promise.reject(new Error('offline'));
  window.trackEvent('crew_verified');
  await new Promise(resolve => setImmediate(resolve));
});

test('all instrumented pages load the helper before their inline scripts', () => {
  for (const page of ['availability', 'scheduler', 'scheduler-mobile', 'schedule_view', 'estimator']) {
    const html = fs.readFileSync(`public/${page}.html`, 'utf8');
    assert.ok(html.indexOf('src="/analytics.js"') < html.indexOf('<script>'), page);
    for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      assert.doesNotThrow(() => new vm.Script(match[1]), page);
    }
  }
});
