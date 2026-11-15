const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const source = fs.readFileSync('pixel-art.js', 'utf8') + '\n' + fs.readFileSync('game.js', 'utf8');
const memory = new Map();
const noop = () => {};
function boot(storage = memory) {
  const metrics = { fills: 0, images: 0, hearts: 0 }; const frames = [];
  const nodes = new Map();
  const events = {};
  const context2d = new Proxy({}, { get: (_, key) => key === 'fillRect' ? () => metrics.fills++ : key === 'drawImage' ? () => metrics.images++ : noop, set: () => true });
  function node(id = '') {
    const classes = new Set();
    return { set innerHTML(value) { if (id === 'livesValue') metrics.hearts++; }, id, value: '', textContent: '', hidden: false, open: false, children: [], listeners: {},
      classList: { add: x => classes.add(x), remove: x => classes.delete(x) },
      setAttribute: noop, focus: noop, reportValidity: noop, getContext: () => context2d,
      getBoundingClientRect: () => ({ width: 1440, height: 800 }),
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
    window: { addEventListener: noop }, matchMedia: () => ({ matches: false }), devicePixelRatio: 2,
    ResizeObserver: class { observe() {} }, requestAnimationFrame: callback => frames.push(callback), setTimeout, clearTimeout,
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) }
  };
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  return { metrics, frames, next(time) { const callback = frames.shift(); assert.ok(callback); callback(time); }, run: code => vm.runInContext(code, sandbox), $, events, sandbox };
}

if (require.main === module) {
  const app = boot();
  assert.equal(app.run('view.dpr'), 1);
  assert.equal(app.frames.length, 0, 'start screen stays idle');
  app.run('startGame(); startGame()');
  assert.equal(app.frames.length, 1, 'only one animation loop');
  app.next(1000);
  app.run('draw(1000)');
  const fills = app.metrics.fills;
  const images = app.metrics.images;
  app.run('draw(1000)');
  assert.equal(app.metrics.fills, fills, 'warm frame reuses sprites and fixes');
  assert.equal(app.metrics.images - images, 10, 'board and nine sprites');
  const hearts = app.metrics.hearts;
  app.run('updateHud(); updateHud()');
  assert.equal(app.metrics.hearts, hearts, 'unchanged hearts stay in DOM');
  app.run('lives--; updateHud()');
  assert.equal(app.metrics.hearts, hearts + 1);
  app.run('player = actor(1, 1, Object.keys(DIRS)[3]); player.x = 2');
  assert.ok(app.run('new Set(Array.from({length: 40}, (_, i) => position(player, i / 39).x)).size') > 16);
  app.run('map[1][2] = String.fromCharCode(46); dots.set(keyFor(2, 1), { x: 2, y: 1, power: false }); player = actor(1, 1, Object.keys(DIRS)[3])');
  const beforeFix = app.metrics.fills;
  app.run('movePlayer()');
  assert.equal(app.run('dots.has(keyFor(2, 1))'), false);
  assert.equal(app.metrics.fills, beforeFix + 1, 'collected fix erases one cached cell');
  app.run('draw(1000)');
  const beforeChip = app.metrics.images;
  app.run('dots.delete(keyFor(1, 1)); draw(1000)');
  assert.equal(app.metrics.images - beforeChip, 9, 'collected chip disappears from rendering');
  app.run('togglePause()');
  app.next(1010);
  assert.equal(app.frames.length, 0, 'pause stops redraws');
  app.run('startGame()');
  app.next(60000);
  assert.equal(app.run('accumulator'), 0, 'resume does not catch up paused time');
  app.run('resizeCanvas(); draw(60000)');
  const resized = app.metrics.fills;
  app.run('draw(60000)');
  assert.equal(app.metrics.fills, resized, 'resize rebuilds the cache');
  function ticksAt(hz) {
    const app = boot();
    app.run('tick = () => { elapsed++; }; startGame()');
    for (let i = 0; i <= hz; i++) app.next(1000 + i * 1000 / hz);
    return app.run('elapsed');
  }
  assert.equal(ticksAt(60), ticksAt(120), 'refresh rate does not change speed');
  assert.equal(ticksAt(60), 6);
  console.log('PASS: render cache, pixel buffer, interpolation, HUD, pause/resume, equal game speed at 60/120 Hz.');
}
module.exports = { boot };
