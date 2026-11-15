'use strict';

const $ = id => document.getElementById(id);
const canvas = $('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false });
const stage = $('game');
const overlay = $('gameOverlay');
const overlayTitle = $('overlayTitle');
const overlayText = $('overlayText');
const overlayButton = $('overlayButton');
const pauseButton = $('pauseButton');
const fullscreenButton = $('fullscreenButton');
const DIRS = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
const STEP_MS = 155;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const PALETTE = { green: '#003f32', wall: '#07533f', outline: '#6f9d80', white: '#ffffff', coral: '#ff785f' };
const CHIP_FLASH_COLORS = { ...PIXEL_PALETTE, c: '#ffffff', W: '#ffad97' };
const LOTTI_POWER_COLORS = { ...PIXEL_PALETTE, s: '#ff785f' };
const BUG_PROFILES = Object.freeze([
  { name: 'Блинки', color: '#ff0000', shade: '#a80000' },
  { name: 'Пинки', color: '#ffb8ff', shade: '#ba70ba' },
  { name: 'Инки', color: '#00ffff', shade: '#009cba' },
  { name: 'Клайд', color: '#ffb852', shade: '#b87326' }
]);
const BUG_COLORS = BUG_PROFILES.map(({ color, shade }) => ({ ...PIXEL_PALETTE, c: color, h: color, d: shade }));
const FRIGHT_COLORS = { ...PIXEL_PALETTE, s: '#2121ff', W: '#2121ff', G: '#ffb8ae' };
const FRIGHT_FLASH_COLORS = { ...FRIGHT_COLORS, s: '#ffffff', W: '#ffffff', G: '#ff0000' };
const EYES_COLORS = { ...PIXEL_PALETTE, G: '#2121ff' };
const EYES_ART = ['................', '................', '................', '................', '................', '....WWW..WWW....', '...WWWWWWWWWW...', '...WWGGWWGGWW...', '....WGG..WGG....', '................', '................', '................', '................', '................', '................', '................'];
// First-board arcade schedule. Frightened time does not consume this clock.
const BUG_PHASES = [7000, 20000, 7000, 20000, 5000, 20000, 5000, Infinity];
const BUG_TURN_ORDER = ['up', 'left', 'down', 'right'];
let bugPhase = 0;
let bugPhaseMs = 0;
let map = [];
let cols = 0;
let rows = 0;
let dots = new Map();
let player;
let bugs = [];
let score = 0;
let lives = 3;
let totalDots = 0;
let collected = 0;
let powerTimer = 0;
let invincible = 0;
let elapsed = 0;
let mode = 'ready';
let lastTime = 0;
let accumulator = 0;
let frameRequested = false;
let drawRequested = false;
let view = { width: 1, height: 1, dpr: 1, cell: 1, x: 0, y: 0 };
const mazeLayer = document.createElement('canvas');
const mazeCtx = mazeLayer.getContext('2d', { alpha: false });
const spriteCache = new Map();
let powerDots = [];
let hudLives = -1;
const LEADERBOARD_KEY = 'prod-lotti-leaderboard-v1';
const MEME_NAMES = Object.freeze([
  'Сеньор Помидор.exe',
  'Джун Сноу НичегоНеЗнаю',
  '404: Зарплата не найдена',
  'Батон Ctrl+Z',
  'Деплойный Пельмень',
  'Мать Драконов и Багов',
  'Кот, нажавший rm -rf',
  'Лёша «У меня работает»',
  'Шаурма на TypeScript',
  'Пятничный Пушистый Пуш'
]);
let pendingResult = null;
let sessionRecords = [];
let storageUnavailable = false;
let resumeAfterLeaderboard = false;

function cleanName(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32);
}

function loadRecords() {
  try {
    const stored = JSON.parse(localStorage.getItem(LEADERBOARD_KEY) || '[]');
    if (!Array.isArray(stored)) return [];
    return stored.filter(item => item && typeof item.id === 'string' &&
      typeof item.name === 'string' && cleanName(item.name) &&
      Number.isSafeInteger(item.score) && item.score >= 0 &&
      Number.isSafeInteger(item.fixes) && item.fixes >= 0 &&
      Number.isSafeInteger(item.total) && item.total >= item.fixes &&
      ['won', 'lost', 'ended'].includes(item.outcome) &&
      typeof item.date === 'string' && Number.isFinite(Date.parse(item.date)))
      .map(item => ({ ...item, name: cleanName(item.name) }));
  } catch {
    storageUnavailable = true;
    return [];
  }
}

function allRecords() {
  const unique = new Map([...loadRecords(), ...sessionRecords].map(item => [item.id, item]));
  return [...unique.values()].sort((a, b) => b.score - a.score || b.fixes - a.fixes || a.date.localeCompare(b.date));
}

function renderLeaderboard() {
  const records = allRecords();
  const body = $('leaderboardBody');
  body.replaceChildren();
  const labels = { won: 'Релиз готов', lost: 'Баги взяли верх', ended: 'Спринт завершён досрочно' };
  records.forEach((entry, index) => {
    const row = document.createElement('tr');
    if (pendingResult && entry.id === pendingResult.id) row.classList.add('current-record');
    const rank = document.createElement('td');
    rank.textContent = String(index + 1).padStart(2, '0');
    const name = document.createElement('td');
    const nickname = document.createElement('strong');
    nickname.textContent = entry.name;
    const detail = document.createElement('span');
    detail.textContent = labels[entry.outcome];
    name.append(nickname, detail);
    const points = document.createElement('td');
    points.textContent = entry.score.toLocaleString('ru-RU');
    const fixes = document.createElement('td');
    fixes.textContent = entry.fixes + '/' + entry.total;
    const date = document.createElement('td');
    const moment = new Date(entry.date);
    date.textContent = moment.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
      + '\n' + moment.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', hour12: false });
    date.title = moment.toLocaleString('ru-RU');
    row.append(rank, name, points, fixes, date);
    body.append(row);
  });
  $('leaderboardEmpty').hidden = records.length > 0;
  $('leaderboardCount').textContent = 'Попыток: ' + records.length;
  $('storageNotice').textContent = storageUnavailable
    ? 'Браузер не дал доступ к сохранению. Новые результаты доступны только до закрытия этой страницы.'
    : 'Сохраняется на этом устройстве. Очистка данных сайта удалит рекорды.';
}

function openLeaderboard() {
  if ($('leaderboardDialog').open) return;
  resumeAfterLeaderboard = mode === 'running';
  if (resumeAfterLeaderboard) togglePause();
  renderLeaderboard();
  $('leaderboardDialog').showModal();
}

function chooseRandomName() {
  const options = MEME_NAMES.filter(name => name !== $('playerName').value);
  const name = options[Math.floor(Math.random() * options.length)];
  $('playerName').value = name;
  $('namePreview').textContent = name + ' уже готов войти в историю.';
}

function finishAttempt(outcome) {
  if (pendingResult || !['running', 'paused'].includes(mode)) return;
  mode = outcome;
  pendingResult = {
    id: crypto.randomUUID(), score, fixes: collected, total: totalDots,
    outcome, date: new Date().toISOString(), saved: false
  };
  pauseButton.disabled = true;
  const titles = { won: 'Можно в прод!', lost: 'Баги взяли верх.', ended: 'Спринт окончен.' };
  showOverlay(titles[outcome], 'Твой счёт: ' + score + '. Фиксы: ' + collected + ' из ' + totalDots + '.', 'Играть без записи');
  overlay.classList.add('result-mode');
  $('resultEntry').hidden = false;
  $('resultLeaderboardButton').hidden = false;
  $('scoreForm').hidden = false;
  $('saveFeedback').textContent = '';
  $('playerName').value = '';
  $('namePreview').textContent = 'Свой ник или одно из 10 мемных имён.';
  updateHud();
}

function saveResult(event) {
  event.preventDefault();
  if (!pendingResult || pendingResult.saved) return;
  const name = cleanName($('playerName').value);
  if (!name) { $('playerName').value = ''; $('playerName').reportValidity(); return; }
  const { saved, ...result } = pendingResult;
  const record = { ...result, name };
  const records = allRecords().filter(item => item.id !== record.id);
  records.push(record);
  sessionRecords.push(record);
  try {
    localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(records));
    storageUnavailable = false;
  } catch { storageUnavailable = true; }
  pendingResult.saved = true;
  $('scoreForm').hidden = true;
  $('saveFeedback').textContent = storageUnavailable
    ? 'Сохранено до закрытия страницы: браузер заблокировал постоянное хранение.'
    : 'Записано! ' + name + ' теперь в истории этого браузера.';
  $('overlayButtonText').textContent = 'Ещё попытка';
  renderLeaderboard();
}

function restartAttempt() {
  if (['running', 'paused'].includes(mode)) finishAttempt('ended');
  else if (pendingResult && !pendingResult.saved) $('playerName').focus();
  else resetGame();
}

const keyFor = (x, y) => x + ',' + y;
const isWall = (x, y) => y < 0 || y >= rows || x < 0 || x >= cols || map[y][x] === '#';
const canMove = (actor, dir) => !isWall(actor.x + DIRS[dir].x, actor.y + DIRS[dir].y);

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function createMaze() {
  const { width, height } = stage.getBoundingClientRect();
  const targetCell = Math.max(22, Math.min(44, Math.sqrt(width * height / 640)));
  cols = Math.max(9, Math.min(61, Math.floor(width / targetCell) | 1));
  rows = Math.max(9, Math.min(45, Math.floor(height / targetCell) | 1));
  map = Array.from({ length: rows }, () => Array(cols).fill('#'));
  // A connected maze with extra loops gives bugs more than one route to the player.
  const stack = [{ x: 1, y: 1 }];
  map[1][1] = '.';
  while (stack.length) {
    const current = stack[stack.length - 1];
    const choices = shuffle(Object.values(DIRS).slice()).filter(dir => {
      const x = current.x + dir.x * 2;
      const y = current.y + dir.y * 2;
      return x > 0 && x < cols - 1 && y > 0 && y < rows - 1 && map[y][x] === '#';
    });
    if (!choices.length) { stack.pop(); continue; }
    const dir = choices[0];
    const next = { x: current.x + dir.x * 2, y: current.y + dir.y * 2 };
    map[current.y + dir.y][current.x + dir.x] = '.';
    map[next.y][next.x] = '.';
    stack.push(next);
  }
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      if (map[y][x] !== '#' || Math.random() > .34) continue;
      const horizontal = map[y][x - 1] === '.' && map[y][x + 1] === '.';
      const vertical = map[y - 1][x] === '.' && map[y + 1][x] === '.';
      if (horizontal !== vertical) map[y][x] = '.';
    }
  }
  const centerX = Math.floor(cols / 2) | 1;
  const centerY = Math.floor(rows / 2) | 1;
  player = { x: centerX, y: centerY };
  dots.clear();
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      if (map[y][x] === '.' && (x !== centerX || y !== centerY)) {
        dots.set(keyFor(x, y), { x, y, power: false });
      }
    }
  }
  for (const [x, y] of [[1, 1], [cols - 2, 1], [1, rows - 2], [cols - 2, rows - 2]]) {
    const dot = dots.get(keyFor(x, y));
    if (dot) dot.power = true;
  }
  totalDots = dots.size;
  powerDots = [...dots.values()].filter(dot => dot.power);
}

function actor(x, y, direction) { return { x, y, fromX: x, fromY: y, direction, nextDirection: direction }; }

function resetActors() {
  player = actor(Math.floor(cols / 2) | 1, Math.floor(rows / 2) | 1, 'left');
  const homes = [[cols - 2, 1], [1, 1], [cols - 2, rows - 2], [1, rows - 2]];
  bugs = homes.map(([x, y], i) => ({ ...actor(x, y, x === 1 ? 'right' : 'left'), home: { x, y }, index: i,
    cooldown: 0, frightened: false, reversePending: false, returning: false, returnPath: [], returnStep: 0, speed: 0 }));
  bugPhase = 0;
  bugPhaseMs = 0;
}

function resetGame() {
  pendingResult = null;
  overlay.classList.remove('result-mode');
  $('resultEntry').hidden = true;
  $('resultLeaderboardButton').hidden = true;
  createMaze();
  resetActors();
  score = 0;
  lives = 3;
  collected = 0;
  powerTimer = 0;
  invincible = 0;
  elapsed = 0;
  accumulator = 0;
  mode = 'ready';
  pauseButton.disabled = true;
  setPauseLabel(false);
  overlayTitle.innerHTML = 'Лотти<br><span>против багов.</span>';
  overlayText.innerHTML = 'Собери все фиксы. Обходи багов.<br>Возьми чип отладки — и меняйтесь ролями.';
  $('overlayButtonText').textContent = 'Начать игру';
  overlay.classList.remove('hidden');
  updateHud();
  resizeCanvas();
}

function startGame() {
  if (['lost', 'won', 'ended'].includes(mode)) resetGame();
  mode = 'running';
  accumulator = 0;
  lastTime = 0;
  overlay.classList.add('hidden');
  pauseButton.disabled = false;
  setPauseLabel(false);
  canvas.focus({ preventScroll: true });
  updateHud();
  requestDraw();
}

function setPauseLabel(paused) {
  pauseButton.innerHTML = pixelIcon(paused ? 'play' : 'pause');
  pauseButton.setAttribute('aria-label', paused ? 'Продолжить' : 'Пауза');
  pauseButton.title = paused ? 'Продолжить · пробел' : 'Пауза · пробел';
}

function showOverlay(title, text, buttonText) {
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  $('overlayButtonText').textContent = buttonText;
  overlay.classList.remove('hidden');
  requestDraw();
}

function togglePause() {
  if (mode === 'running') {
    mode = 'paused';
    setPauseLabel(true);
    showOverlay('Пауза', 'Баги подождут. Продолжай, когда будешь готов.', 'Продолжить');
    updateHud();
  } else if (mode === 'paused') startGame();
}

function updateHud() {
  const setText = (id, value) => { if ($(id).textContent !== value) $(id).textContent = value; };
  setText('scoreValue', String(score).padStart(6, '0'));
  setText('fixValue', collected + ' / ' + totalDots);
  if (hudLives !== lives) {
    $('livesValue').innerHTML = Array.from({ length: 3 }, (_, i) => '<span class="pixel-heart' + (i < lives ? '' : ' empty') + '">' + pixelIcon('heart') + '</span>').join('');
    $('livesValue').setAttribute('aria-label', 'Осталось жизней: ' + lives);
    hudLives = lives;
  }
  const states = { ready: 'Готов к запуску', running: 'Релиз в работе', paused: 'Пауза', won: 'Релиз готов!', lost: 'Нужен ещё один фикс', ended: 'Спринт окончен' };
  const status = powerTimer > 0 && mode === 'running' ? 'Отладка активна' : states[mode];
  if ($('stateValue').textContent !== status) $('stateValue').textContent = status;
  $('debugIndicator').hidden = powerTimer <= 0 || mode !== 'running';
  setText('debugTime', (powerTimer * STEP_MS / 1000).toFixed(1));
}

function setDirection(direction) {
  if (!DIRS[direction] || ['lost', 'won', 'ended'].includes(mode) || $('leaderboardDialog').open) return;
  player.nextDirection = direction;
  if (mode === 'ready') startGame();
}

function movePlayer() {
  if (canMove(player, player.nextDirection)) player.direction = player.nextDirection;
  if (!canMove(player, player.direction)) return;
  player.x += DIRS[player.direction].x;
  player.y += DIRS[player.direction].y;
  const key = keyFor(player.x, player.y);
  const dot = dots.get(key);
  if (dot) {
    dots.delete(key);
    // Remove this fix from the cached board once, rather than redrawing all fixes.
    if (!dot.power) {
      mazeCtx.fillStyle = PALETTE.green;
      mazeCtx.fillRect(view.x + dot.x * view.cell, view.y + dot.y * view.cell, view.cell, view.cell);
    }
    collected++;
    score += dot.power ? 50 : 10;
    if (dot.power) frightenBugs();
  }
}

function frightenBugs() {
  powerTimer = Math.ceil(8000 / STEP_MS);
  for (const bug of bugs) {
    if (bug.returning) continue;
    bug.frightened = true;
    bug.reversePending = true;
  }
}

function advanceBugClock() {
  if (powerTimer > 0) {
    powerTimer--;
    if (powerTimer === 0) bugs.forEach(bug => { bug.frightened = false; });
    return;
  }
  bugPhaseMs += STEP_MS;
  if (bugPhaseMs >= BUG_PHASES[bugPhase]) {
    bugPhaseMs -= BUG_PHASES[bugPhase];
    bugPhase++;
    for (const bug of bugs) if (!bug.returning) bug.reversePending = true;
  }
}

function elroyStage() {
  // The arcade used 20 and 10 of 244 dots. Scale for our generated mazes.
  if (dots.size <= Math.max(1, Math.round(totalDots * 10 / 244))) return 2;
  if (dots.size <= Math.max(2, Math.round(totalDots * 20 / 244))) return 1;
  return 0;
}

function aheadOfPlayer(tiles) {
  const dir = DIRS[player.direction];
  // Preserve the original overflow quirk: aiming upward also aims left.
  return { x: player.x + dir.x * tiles - (player.direction === 'up' ? tiles : 0), y: player.y + dir.y * tiles };
}

function bugTarget(bug) {
  const corners = [{ x: cols - 1, y: -3 }, { x: 0, y: -3 }, { x: cols - 1, y: rows }, { x: 0, y: rows }];
  if (bugPhase % 2 === 0 && !(bug.index === 0 && elroyStage() > 0)) return corners[bug.index];
  if (bug.index === 0) return { x: player.x, y: player.y };
  if (bug.index === 1) return aheadOfPlayer(4);
  if (bug.index === 2) {
    const pivot = aheadOfPlayer(2);
    return { x: 2 * pivot.x - bugs[0].x, y: 2 * pivot.y - bugs[0].y };
  }
  const distanceSquared = (bug.x - player.x) ** 2 + (bug.y - player.y) ** 2;
  return distanceSquared >= 64 ? { x: player.x, y: player.y } : corners[3];
}

function chooseBugDirection(bug) {
  const reverse = OPPOSITE[bug.direction];
  const exits = BUG_TURN_ORDER.filter(dir => canMove(bug, dir));
  if (bug.reversePending) {
    bug.reversePending = false;
    if (exits.includes(reverse)) return reverse;
  }
  const forward = exits.filter(dir => dir !== reverse);
  const options = forward.length ? forward : exits; // Generated mazes may have dead ends.
  if (!options.length) return null;
  if (bug.frightened) return options[Math.floor(Math.random() * options.length)];
  const target = bugTarget(bug);
  let best = options[0];
  let bestDistance = Infinity;
  for (const dir of options) {
    const distance = (bug.x + DIRS[dir].x - target.x) ** 2 + (bug.y + DIRS[dir].y - target.y) ** 2;
    if (distance < bestDistance) { best = dir; bestDistance = distance; }
  }
  return best;
}

function returnBugHome(bug) {
  bug.returning = true;
  bug.frightened = false;
  bug.reversePending = false;
  bug.speed = 0;
  // Find a return route only when eaten. Chasing uses the arcade's cheap local rule.
  const queue = [{ x: bug.x, y: bug.y, parent: -1 }];
  const visited = new Set([keyFor(bug.x, bug.y)]);
  let found = -1;
  for (let i = 0; i < queue.length; i++) {
    const point = queue[i];
    if (point.x === bug.home.x && point.y === bug.home.y) { found = i; break; }
    for (const dir of BUG_TURN_ORDER) {
      const x = point.x + DIRS[dir].x;
      const y = point.y + DIRS[dir].y;
      const key = keyFor(x, y);
      if (isWall(x, y) || visited.has(key)) continue;
      visited.add(key);
      queue.push({ x, y, parent: i });
    }
  }
  bug.returnPath = [];
  for (let i = found; i > 0; i = queue[i].parent) bug.returnPath.push({ x: queue[i].x, y: queue[i].y });
  bug.returnPath.reverse();
  bug.returnStep = 0;
}

function moveBug(bug) {
  if (bug.returning) {
    const point = bug.returnPath[Math.min(bug.returnStep + 1, bug.returnPath.length - 1)];
    if (point) { bug.x = point.x; bug.y = point.y; bug.returnStep += 2; }
    if (bug.returnStep >= bug.returnPath.length) {
      bug.returning = false;
      bug.x = bug.home.x;
      bug.y = bug.home.y;
      bug.direction = bug.x === 1 ? 'right' : 'left';
      bug.cooldown = 1;
    }
    return;
  }
  if (bug.cooldown > 0) { bug.cooldown--; return; }
  const elroy = bug.index === 0 ? elroyStage() : 0;
  // First-board speeds relative to Pac-Man's 80%: 75%, frightened 50%, Elroy 80/85%.
  bug.speed += bug.frightened ? 50 / 80 : elroy === 2 ? 85 / 80 : elroy === 1 ? 1 : 75 / 80;
  while (bug.speed >= 1) {
    bug.speed--;
    const dir = chooseBugDirection(bug);
    if (!dir) return;
    bug.direction = dir;
    bug.x += DIRS[dir].x;
    bug.y += DIRS[dir].y;
    if (mode === 'running' && checkCollisions()) return;
    if (bug.returning) return;
  }
}

function checkCollisions() {
  if (invincible > 0) return false;
  for (const bug of bugs) {
    if (bug.cooldown > 0 || bug.returning) continue;
    const sameCell = bug.x === player.x && bug.y === player.y;
    const crossed = bug.fromX === player.x && bug.fromY === player.y && bug.x === player.fromX && bug.y === player.fromY;
    if (!sameCell && !crossed) continue;
    if (bug.frightened) {
      score += 200;
      returnBugHome(bug);
    } else {
      lives--;
      powerTimer = 0;
      if (lives <= 0) {
        finishAttempt('lost');
      } else {
        resetActors();
        invincible = 14;
      }
      return true;
    }
  }
  return false;
}

function tick() {
  elapsed++;
  advanceBugClock();
  if (invincible > 0) invincible--;
  [player, ...bugs].forEach(item => { item.fromX = item.x; item.fromY = item.y; });
  movePlayer();
  if (!checkCollisions() && mode === 'running') {
    const activeBugs = bugs;
    for (const bug of activeBugs) {
      moveBug(bug);
      if (bugs !== activeBugs || mode !== 'running') break;
    }
    checkCollisions();
  }
  if (dots.size === 0 && mode === 'running') {
    score += 500;
    finishAttempt('won');
  }
  updateHud();
}

// All artwork is painted as solid pixel blocks. No vector curves or filtering.
function pixelRect(g, x, y, width, height, color) {
  const dpr = view.dpr;
  const left = Math.round(x * dpr) / dpr;
  const top = Math.round(y * dpr) / dpr;
  const right = Math.round((x + width) * dpr) / dpr;
  const bottom = Math.round((y + height) * dpr) / dpr;
  g.fillStyle = color;
  g.fillRect(left, top, right - left, bottom - top);
}

function paintSprite(g, rows, centerX, centerY, size, colors = PIXEL_PALETTE, flip = false) {
  const unit = size / rows.length;
  const ox = centerX - size / 2;
  const oy = centerY - size / 2;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = colors[row[x]];
      if (color) pixelRect(g, ox + (flip ? row.length - 1 - x : x) * unit, oy + y * unit, unit, unit, color);
    }
  });
}

function drawSprite(key, rows, centerX, centerY, colors = PIXEL_PALETTE, flip = false) {
  let sprite = spriteCache.get(key);
  if (!sprite) {
    sprite = document.createElement('canvas');
    sprite.width = sprite.height = Math.round(view.cell * view.dpr);
    const g = sprite.getContext('2d');
    g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    paintSprite(g, rows, view.cell / 2, view.cell / 2, view.cell, colors, flip);
    spriteCache.set(key, sprite);
  }
  ctx.drawImage(sprite, Math.round(centerX - view.cell / 2), Math.round(centerY - view.cell / 2), view.cell, view.cell);
}

function rebuildMazeLayer() {
  const { width, height, dpr, cell, x: ox, y: oy } = view;
  mazeLayer.width = canvas.width;
  mazeLayer.height = canvas.height;
  const g = mazeCtx;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.imageSmoothingEnabled = false;
  g.fillStyle = PALETTE.green;
  g.fillRect(0, 0, width, height);
  const unit = cell / 16;
  // Dithered margins keep the board in one pixel language on every screen.
  g.fillStyle = '#064a3a';
  for (let y = 0; y < height; y += 8) {
    for (let x = (y / 8) % 2 ? 4 : 0; x < width; x += 8) g.fillRect(x, y, 1, 1);
  }
  pixelRect(g, ox, oy, cols * cell, rows * cell, PALETTE.green);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!isWall(x, y)) continue;
      const left = x > 0 && isWall(x - 1, y);
      const right = x < cols - 1 && isWall(x + 1, y);
      const top = y > 0 && isWall(x, y - 1);
      const bottom = y < rows - 1 && isWall(x, y + 1);
      const px = ox + x * cell;
      const py = oy + y * cell;
      const x1 = left ? 0 : 2;
      const x2 = right ? 16 : 14;
      const y1 = top ? 0 : 2;
      const y2 = bottom ? 16 : 14;
      const block = (bx, by, bw, bh, color) => pixelRect(g, px + bx * unit, py + by * unit, bw * unit, bh * unit, color);
      block(x1, y1, x2 - x1, y2 - y1, '#0a5b45');
      if (!top) { block(x1, y1, x2 - x1, 1, '#9bc9a9'); block(x1, y1 + 1, x2 - x1, 1, '#3f9167'); }
      if (!left) { block(x1, y1, 1, y2 - y1, '#6da783'); block(x1 + 1, y1, 1, y2 - y1, '#287553'); }
      if (!bottom) { block(x1, y2 - 2, x2 - x1, 1, '#00382d'); block(x1, y2 - 1, x2 - x1, 1, '#37815c'); }
      if (!right) { block(x2 - 2, y1, 1, y2 - y1, '#00382d'); block(x2 - 1, y1, 1, y2 - y1, '#37815c'); }
      // Bolt heads and sparse two-tone dithering resemble a retro circuit board.
      if ((x + y) % 5 === 0) {
        block(7, 7, 2, 2, '#004333'); block(7, 7, 1, 1, '#79aa83');
      } else if ((x * 3 + y) % 4 === 0) {
        block(6, 7, 1, 1, '#216b4d'); block(8, 9, 1, 1, '#216b4d');
      }
    }
  }
  // Fixes are static until collected, so bake them into the board.
  for (const dot of dots.values()) {
    if (dot.power) continue;
    const x = ox + (dot.x + .5) * cell;
    const y = oy + (dot.y + .5) * cell;
    pixelRect(g, x - unit, y - unit, 2 * unit, 2 * unit, '#ffad97');
    pixelRect(g, x - unit, y - unit, unit, unit, '#ffe7d5');
  }
}

function drawDots(time) {
  const { cell, x: ox, y: oy } = view;
  const blink = !reducedMotion && Math.floor(time / 280) % 2 === 1;
  for (const dot of powerDots) {
    if (!dots.has(keyFor(dot.x, dot.y))) continue;
    const x = ox + (dot.x + .5) * cell;
    const y = oy + (dot.y + .5) * cell;
    const key = 'chip/' + Number(blink);
    drawSprite(key, PIXEL_ART.chip[0], x, y, blink ? CHIP_FLASH_COLORS : PIXEL_PALETTE);
  }
}

function position(item, alpha) {
  const x = (item.fromX + (item.x - item.fromX) * alpha + .5) * view.cell;
  const y = (item.fromY + (item.y - item.fromY) * alpha + .5) * view.cell;
  return { x: view.x + x, y: view.y + y };
}

function drawLotti(alpha, time) {
  if (invincible > 0 && Math.floor(time / 100) % 2 === 0) return;
  const { x, y } = position(player, alpha);
  const moving = player.x !== player.fromX || player.y !== player.fromY;
  const frameIndex = !reducedMotion && mode === 'running' && moving ? Math.floor(time / 140) % 2 : 0;
  const flip = player.direction === 'left';
  const key = 'lotti/' + frameIndex + '/' + Number(powerTimer > 0) + '/' + Number(flip);
  const colors = powerTimer > 0 ? LOTTI_POWER_COLORS : PIXEL_PALETTE;
  drawSprite(key, PIXEL_ART.lotti[frameIndex], x, y, colors, flip);
}

function drawBug(bug, alpha, time) {
  if (bug.cooldown > 0) return;
  const { x, y } = position(bug, alpha);
  if (bug.returning) {
    drawSprite('eyes', EYES_ART, x, y, EYES_COLORS);
    return;
  }
  const vulnerable = bug.frightened;
  const flashing = vulnerable && powerTimer < 14 && Math.floor(time / 130) % 2 === 0;
  const frameIndex = !reducedMotion && mode === 'running' ? Math.floor(time / 150 + bug.index) % 2 : 0;
  const key = 'bug/' + bug.index + '/' + Number(vulnerable) + '/' + Number(flashing) + '/' + frameIndex;
  const colors = vulnerable ? flashing ? FRIGHT_FLASH_COLORS : FRIGHT_COLORS : BUG_COLORS[bug.index];
  drawSprite(key, vulnerable ? PIXEL_ART.fear[0] : PIXEL_ART.bug[frameIndex], x, y, colors, !vulnerable && bug.index > 1);
}

function draw(time = 0) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(mazeLayer, 0, 0);
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  const alpha = mode === 'running' && !reducedMotion ? Math.min(1, accumulator / STEP_MS) : 1;
  drawDots(time);
  bugs.forEach(bug => drawBug(bug, alpha, time));
  drawLotti(alpha, time);
}

function resizeCanvas() {
  const rect = stage.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  // Pixel art needs one backing pixel per CSS pixel; Retina quadrupled the fill work.
  const dpr = 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const padding = width < 600 ? 5 : 12;
  const cell = Math.max(1, Math.floor(Math.min((width - padding * 2) / cols, (height - padding * 2) / rows)));
  view = { width, height, dpr, cell, x: Math.floor((width - cols * cell) / 2), y: Math.floor((height - rows * cell) / 2) };
  spriteCache.clear();
  rebuildMazeLayer();
  draw();
}

function requestDraw() {
  drawRequested = true;
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame(frame);
}

function frame(time) {
  frameRequested = false;
  const delta = lastTime ? Math.max(0, Math.min(time - lastTime, STEP_MS * 2)) : 0;
  lastTime = mode === 'running' ? time : 0;
  if (mode === 'running') {
    accumulator += delta;
    while (accumulator >= STEP_MS && mode === 'running') { accumulator -= STEP_MS; tick(); }
  }
  if (mode === 'running' || drawRequested) draw(time);
  drawRequested = false;
  if (mode === 'running') requestDraw();
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
  } catch {
    fullscreenButton.title = 'Полноэкранный режим недоступен в этом браузере';
  }
}

if (!document.fullscreenEnabled) fullscreenButton.hidden = true;
fullscreenButton.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => {
  const active = Boolean(document.fullscreenElement);
  fullscreenButton.setAttribute('aria-pressed', String(active));
  fullscreenButton.setAttribute('aria-label', active ? 'Выйти из полноэкранного режима' : 'На весь экран');
  fullscreenButton.title = active ? 'Выйти из полноэкранного режима · F' : 'На весь экран · F';
});
overlayButton.addEventListener('click', startGame);
pauseButton.addEventListener('click', togglePause);
$('restartButton').addEventListener('click', restartAttempt);
$('leaderboardButton').addEventListener('click', openLeaderboard);
$('resultLeaderboardButton').addEventListener('click', openLeaderboard);
$('randomNameButton').addEventListener('click', chooseRandomName);
$('scoreForm').addEventListener('submit', saveResult);
$('closeLeaderboardButton').addEventListener('click', () => $('leaderboardDialog').close());
$('backToGameButton').addEventListener('click', () => $('leaderboardDialog').close());
$('leaderboardDialog').addEventListener('close', () => {
  if (resumeAfterLeaderboard && mode === 'paused' && !document.hidden) startGame();
  resumeAfterLeaderboard = false;
});
window.addEventListener('storage', event => {
  if (event.key === LEADERBOARD_KEY && $('leaderboardDialog').open) renderLeaderboard();
});
for (const button of document.querySelectorAll('[data-direction]')) {
  button.addEventListener('pointerdown', event => { event.preventDefault(); setDirection(button.dataset.direction); });
}
const keys = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
document.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if ($('leaderboardDialog').open) return;
  const onButton = event.target instanceof Element && event.target.closest('button, a');
  if (keys[event.code]) { event.preventDefault(); setDirection(keys[event.code]); }
  else if (event.code === 'Space' && !onButton) { event.preventDefault(); if (!event.repeat) togglePause(); }
  else if (event.code === 'Escape' && mode === 'running') togglePause();
  else if (event.code === 'Enter' && !onButton && mode !== 'running') { event.preventDefault(); startGame(); }
  else if (event.code === 'KeyR' && !event.repeat) restartAttempt();
  else if (event.code === 'KeyF' && !event.repeat) toggleFullscreen();
});
// Steer as soon as a swipe is recognised; the finger may stay on the screen
// and change direction again. Track one pointer so a second touch cannot steer.
let gesture = null;
const SWIPE_THRESHOLD = 14;
const SWIPE_AXIS_BIAS = 1.15;
function steerFromGesture(event) {
  if (!gesture || gesture.id !== event.pointerId) return;
  const dx = event.clientX - gesture.x;
  const dy = event.clientY - gesture.y;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < SWIPE_THRESHOLD) return;
  // Wait for a clear axis on diagonal movement instead of choosing at random.
  if (Math.max(ax, ay) < Math.min(ax, ay) * SWIPE_AXIS_BIAS) return;
  const direction = ax > ay ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  setDirection(direction);
  gesture.x = event.clientX;
  gesture.y = event.clientY;
  $('gestureHint').classList.add('dismissed');
}
canvas.addEventListener('pointerdown', event => {
  if (gesture || event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return;
  gesture = { id: event.pointerId, x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', steerFromGesture);
canvas.addEventListener('pointerup', event => {
  if (!gesture || gesture.id !== event.pointerId) return;
  steerFromGesture(event);
  gesture = null;
});
function cancelGesture(event) {
  if (gesture && gesture.id === event.pointerId) gesture = null;
}
canvas.addEventListener('pointercancel', cancelGesture);
canvas.addEventListener('lostpointercapture', cancelGesture);
document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'running') togglePause(); });
let resizeTimer;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (mode === 'ready') resetGame(); else resizeCanvas(); }, 60);
}).observe(stage);
resetGame();
