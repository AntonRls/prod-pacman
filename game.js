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
const ALT_BUG_COLORS = { ...PIXEL_PALETTE, h: '#ff785f', c: '#ffad97' };
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
  const homes = [[1, 1], [cols - 2, 1], [1, rows - 2], [cols - 2, rows - 2]];
  bugs = homes.map(([x, y], i) => ({ ...actor(x, y, x === 1 ? 'right' : 'left'), home: { x, y }, index: i, cooldown: 0 }));
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
    if (dot.power) powerTimer = Math.ceil(8000 / STEP_MS);
  }
}

function moveBug(bug) {
  if (bug.cooldown > 0) { bug.cooldown--; return; }
  if ((elapsed + bug.index) % (powerTimer > 0 ? 2 : 5) === 0) return;
  let options = Object.keys(DIRS).filter(dir => canMove(bug, dir));
  if (options.length > 1) options = options.filter(dir => dir !== OPPOSITE[bug.direction]);
  const distance = dir => Math.abs(bug.x + DIRS[dir].x - player.x) + Math.abs(bug.y + DIRS[dir].y - player.y);
  options.sort((a, b) => powerTimer > 0 ? distance(b) - distance(a) : distance(a) - distance(b));
  if (!options.length) return;
  bug.direction = (elapsed + bug.index * 3) % 8 === 0 && options.length > 1 ? options[1] : options[0];
  bug.x += DIRS[bug.direction].x;
  bug.y += DIRS[bug.direction].y;
}

function checkCollisions() {
  if (invincible > 0) return false;
  for (const bug of bugs) {
    if (bug.cooldown > 0) continue;
    const sameCell = bug.x === player.x && bug.y === player.y;
    const crossed = bug.fromX === player.x && bug.fromY === player.y && bug.x === player.fromX && bug.y === player.fromY;
    if (!sameCell && !crossed) continue;
    if (powerTimer > 0) {
      score += 200;
      bug.x = bug.fromX = bug.home.x;
      bug.y = bug.fromY = bug.home.y;
      bug.cooldown = 18;
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
  if (powerTimer > 0) powerTimer--;
  if (invincible > 0) invincible--;
  [player, ...bugs].forEach(item => { item.fromX = item.x; item.fromY = item.y; });
  movePlayer();
  if (!checkCollisions() && mode === 'running') {
    bugs.forEach(moveBug);
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
  const vulnerable = powerTimer > 0;
  const flashing = vulnerable && powerTimer < 14 && Math.floor(time / 130) % 2 === 0;
  const frameIndex = !reducedMotion && mode === 'running' ? Math.floor(time / 150 + bug.index) % 2 : 0;
  const fear = vulnerable && !flashing;
  const key = 'bug/' + bug.index + '/' + Number(fear) + '/' + frameIndex;
  // Distinct markings keep the four bugs recognisable within the PROD palette.
  const colors = bug.index % 2 === 1 ? ALT_BUG_COLORS : PIXEL_PALETTE;
  drawSprite(key, fear ? PIXEL_ART.fear[0] : PIXEL_ART.bug[frameIndex], x, y, colors, !fear && bug.index > 1);
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
