const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const source = fs.readFileSync('pixel-art.js', 'utf8') + '\n' + fs.readFileSync('game.js', 'utf8');
const memory = new Map();
const noop = () => {};
function boot(storage = memory) {
  const nodes = new Map();
  const events = {};
  const context2d = new Proxy({}, { get: () => noop, set: () => true });
  function node(id = '') {
    const classes = new Set();
    return { id, value: '', textContent: '', hidden: false, open: false, children: [], listeners: {},
      classList: { add: x => classes.add(x), remove: x => classes.delete(x) },
      setAttribute: noop, focus: noop, reportValidity: noop, getContext: () => context2d,
      getBoundingClientRect: () => ({ width: 390, height: 680 }),
      replaceChildren() { this.children = []; }, append(...items) { this.children.push(...items); },
      addEventListener(type, fn) { this.listeners[type] = fn; },
      showModal() { this.open = true; }, close() { this.open = false; this.listeners.close?.(); },
      closest() { return null; }
    };
  }
  const $ = id => { if (!nodes.has(id)) nodes.set(id, node(id)); return nodes.get(id); };
  const sandbox = { console, Date, crypto: { randomUUID }, Element: class {},
    document: { getElementById: $, createElement: () => node(), querySelectorAll: () => [],
      addEventListener: (type, fn) => events[type] = fn, documentElement: {}, fullscreenEnabled: false },
    window: { addEventListener: noop }, matchMedia: () => ({ matches: false }), devicePixelRatio: 1,
    ResizeObserver: class { observe() {} }, requestAnimationFrame: noop, setTimeout, clearTimeout,
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) }
  };
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  return { run: code => vm.runInContext(code, sandbox), $, events, sandbox };
}
let app = boot();
const save = (score, name, outcome = 'lost') => {
  app.run('startGame(); score = ' + score + '; finishAttempt(' + JSON.stringify(outcome) + ')');
  app.$('playerName').value = name;
  app.run('saveResult({preventDefault(){}})');
};
assert.equal(app.run('MEME_NAMES.length'), 10);
assert.equal(app.run('new Set(MEME_NAMES).size'), 10);
save(120, 'Деплойный Пельмень');
assert.equal(app.run('allRecords().length'), 1);
app.run('saveResult({preventDefault(){}})');
assert.equal(app.run('allRecords().length'), 1, 'double submission');
app = boot();
assert.equal(app.run('allRecords()[0].name'), 'Деплойный Пельмень', 'reload restores records');
save(900, '<img src=x onerror=alert(1)>', 'won');
app.run('renderLeaderboard()');
assert.equal(app.$('leaderboardBody').children[0].children[1].children[0].textContent, '<img src=x onerror=alert(1)>');
assert.equal(app.run('allRecords()[0].score'), 900);
app.run('startGame(); score = 55; restartAttempt()');
assert.equal(app.run('pendingResult.outcome'), 'ended');
assert.equal(app.run('mode'), 'ended');
app.$('playerName').value = '  ';
app.run('saveResult({preventDefault(){}})');
assert.equal(app.run('pendingResult.saved'), false, 'blank name rejected');
app.run('chooseRandomName()');
assert.ok(app.run('MEME_NAMES.includes($("playerName").value)'));
app.run('saveResult({preventDefault(){}})');
assert.equal(app.run('allRecords().length'), 3);
assert.equal(app.run('pendingResult.saved'), true);
app.run('startGame(); openLeaderboard()');
assert.equal(app.run('mode'), 'paused');
app.$('leaderboardDialog').close();
assert.equal(app.run('mode'), 'running');
app.run('score=50;finishAttempt("lost")');
const input = new app.sandbox.Element(); input.closest = selector => selector.startsWith('input') ? input : null;
let prevented = false;
app.events.keydown({ code: 'KeyR', target: input, preventDefault() { prevented = true; } });
assert.equal(app.run('mode'), 'lost', 'typing R does not restart');
assert.equal(prevented, false);
const denied = { get() { throw Error('denied'); }, set() { throw Error('quota'); } };
app = boot(denied);
save(10, 'Рекорд');
assert.equal(app.run('allRecords().length'), 1);
assert.equal(app.run('storageUnavailable'), true);
assert.ok(app.$('saveFeedback').textContent.includes('закрытия страницы'));
app = boot(new Map([['prod-lotti-leaderboard-v1', '{broken']]));
assert.equal(app.run('allRecords().length'), 0);
console.log('PASS: persistence across reload, sorting, 10 meme names, duplicate and blank guards, safe nickname rendering, interrupted runs, modal pause/resume, typing isolation, unavailable/corrupt storage.');
