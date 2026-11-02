/* 贪吃蛇 · 渲染与交互（单人 / 双人同屏） */
(function () {
  'use strict';

  var Core = window.SnakeGame;
  var COLORS = { p1: '#1b1917', p2: '#b8432f', food: '#5f7d3a' };

  var SPEEDS = [
    { id: 'slow', label: '慢', tick: 175 },
    { id: 'normal', label: '中', tick: 125 },
    { id: 'fast', label: '快', tick: 90 }
  ];

  var BEST_KEY = 'snake.best.v1';

  var dom = {
    canvas: document.getElementById('game'),
    overlay: document.getElementById('overlay'),
    overlayInner: document.getElementById('overlayInner'),
    ledger: document.getElementById('ledger'),
    speeds: document.getElementById('speeds'),
    modes: document.getElementById('modes'),
    walls: document.getElementById('walls'),
    wallBlock: document.getElementById('wallBlock'),
    dpad: document.getElementById('dpad'),
    btnWrap: document.getElementById('btnWrap')
  };

  var cfg = { mode: 'solo', wrap: false, wallSeconds: 20 };
  var state = 'ready';                 // ready | playing | paused | over
  var G = null;
  var speed = SPEEDS[1];
  var pressed = Object.create(null);
  var particles = [];
  var ctx = null;
  var dpr = 1;
  var boxSize = 480;
  var acc = 0;
  var lastTs = 0;
  var clock = 0;
  var bests = loadBests();

  /* ================= 存档 ================= */

  function loadBests() {
    try { return JSON.parse(localStorage.getItem(BEST_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }

  function saveBests() {
    try { localStorage.setItem(BEST_KEY, JSON.stringify(bests)); } catch (e) { /* 忽略 */ }
  }

  /* ================= 画布 ================= */

  function resizeCanvas() {
    var rect = dom.canvas.getBoundingClientRect ? dom.canvas.getBoundingClientRect() : null;
    var w = (rect && rect.width) ? Math.round(rect.width) : 480;
    if (!w || w < 100) w = 480;
    w = Math.max(240, Math.min(700, w));
    boxSize = w;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    dom.canvas.width = Math.round(w * dpr);
    dom.canvas.height = Math.round(w * dpr);
  }

  function roundRect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function drawWall(cell, S) {
    if (!G || !G.wall.active) return;
    var wx = G.wall.x * cell;
    var half = cell * 0.22;

    ctx.save();
    ctx.beginPath();
    ctx.rect(wx - half, 0, half * 2, S);
    ctx.clip();
    ctx.strokeStyle = 'rgba(27, 25, 23, 0.40)';
    ctx.lineWidth = 1.5;
    for (var d = -S; d < S * 2; d += 11) {
      ctx.beginPath();
      ctx.moveTo(wx - S, d);
      ctx.lineTo(wx + S, d + S);
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = '#1b1917';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(wx - half, 0); ctx.lineTo(wx - half, S);
    ctx.moveTo(wx + half, 0); ctx.lineTo(wx + half, S);
    ctx.stroke();
  }

  function drawSnake(s, cell) {
    if (!s.alive) return;
    var color = s.id === 0 ? COLORS.p1 : COLORS.p2;
    var body = s.body;
    var n = body.length;

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, cell * 0.62);

    var prevX = 0, prevY = 0;
    ctx.beginPath();
    for (var i = n - 1; i >= 0; i--) {
      var sx = (body[i].x + 0.5) * cell;
      var sy = (body[i].y + 0.5) * cell;
      var jumped = i !== n - 1 &&
        (Math.abs(sx - prevX) > cell * 1.6 || Math.abs(sy - prevY) > cell * 1.6);
      if (i === n - 1 || jumped) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
      prevX = sx;
      prevY = sy;
    }
    if (n === 1) ctx.lineTo(prevX + 0.01, prevY);
    ctx.stroke();

    var hx = (body[0].x + 0.5) * cell;
    var hy = (body[0].y + 0.5) * cell;
    ctx.beginPath();
    ctx.arc(hx, hy, cell * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // P2 额外加一圈纸白描边：黑白打印或色弱时也能区分
    if (s.id === 1) {
      ctx.beginPath();
      ctx.arc(hx, hy, cell * 0.42, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(1.2, cell * 0.07);
      ctx.strokeStyle = '#f7f2e7';
      ctx.stroke();
    }

    var d = Core.DIRS[s.dir];
    var px = -d.y, py = d.x;
    var off = cell * 0.16;
    var eyeR = Math.max(1.3, cell * 0.08);
    var fwd = cell * 0.12;
    ctx.fillStyle = '#f7f2e7';
    for (var k = -1; k <= 1; k += 2) {
      ctx.beginPath();
      ctx.arc(hx + d.x * fwd + px * off * k, hy + d.y * fwd + py * off * k, eyeR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function draw() {
    if (!ctx) return;
    var S = boxSize;
    var cell = S / G.cols;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);

    ctx.fillStyle = '#f7f2e7';
    ctx.fillRect(0, 0, S, S);

    // 极淡格点
    ctx.fillStyle = 'rgba(27, 25, 23, 0.18)';
    for (var gy = 0; gy <= G.rows; gy++) {
      for (var gx = 0; gx <= G.cols; gx++) {
        ctx.fillRect(gx * cell - 0.5, gy * cell - 0.5, 1, 1);
      }
    }

    drawWall(cell, S);

    // 果实
    for (var i = 0; i < G.foods.length; i++) {
      var f = G.foods[i];
      var fx = (f.x + 0.5) * cell;
      var fy = (f.y + 0.5) * cell;
      var r = cell * 0.3;
      ctx.beginPath();
      ctx.arc(fx, fy, r, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.food;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#1b1917';
      ctx.stroke();
    }

    for (var s = 0; s < G.snakes.length; s++) drawSnake(G.snakes[s], cell);

    for (var p = 0; p < particles.length; p++) {
      var q = particles[p];
      ctx.globalAlpha = Math.max(0, q.life / q.max);
      ctx.fillStyle = q.color;
      ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
    }
    ctx.globalAlpha = 1;
  }

  /* ================= 粒子 ================= */

  function burst(x, y, color) {
    for (var i = 0; i < 20; i++) {
      var a = (Math.PI * 2 * i) / 20 + Math.random() * 0.5;
      var sp = 90 + Math.random() * 240;
      particles.push({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 60,
        life: 0.55 + Math.random() * 0.35,
        max: 0.9,
        size: 2 + Math.random() * 3,
        color: color
      });
    }
    if (particles.length > 300) particles.splice(0, particles.length - 300);
  }

  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var q = particles[i];
      q.life -= dt;
      if (q.life <= 0) { particles.splice(i, 1); continue; }
      q.vy += 900 * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
    }
  }

  function consumeEvents() {
    if (!G || !G.events.length) return;
    var cell = boxSize / G.cols;
    for (var i = 0; i < G.events.length; i++) {
      var ev = G.events[i];
      if (ev.type === 'death') {
        burst((ev.x + 0.5) * cell, (ev.y + 0.5) * cell, ev.id === 0 ? COLORS.p1 : COLORS.p2);
      }
      if (ev.type === 'over') endGame();
    }
    G.events.length = 0;
  }

  /* ================= HUD ================= */

  var LEDGER_SOLO = [
    { label: 'Score', role: 'score' },
    { label: 'Best', role: 'best' },
    { label: 'Mode', role: 'mode' }
  ];
  var LEDGER_DUEL = [
    { label: 'P1 · WASD', role: 'p1' },
    { label: 'P2 · 方向键', role: 'p2' },
    { label: '围墙', role: 'wall' }
  ];

  var LEDGER_DUEL = [
    { label: 'P1 · WASD', role: 'p1', dot: '#1b1917' },
    { label: 'P2 · 方向键', role: 'p2', dot: '#b8432f' },
    { label: '围墙', role: 'wall' }
  ];

  function buildLedger() {
    var cells = cfg.mode === 'duel' ? LEDGER_DUEL : LEDGER_SOLO;
    var html = '';
    for (var i = 0; i < cells.length; i++) {
      var dot = cells[i].dot ? '<i class="dot" style="background:' + cells[i].dot + '"></i>' : '';
      html += '<div class="cell"><span>' + dot + cells[i].label + '</span>' +
        '<b data-role="' + cells[i].role + '">0</b></div>';
    }
    dom.ledger.innerHTML = html;
  }

  function setRole(role, text) {
    var el = dom.ledger.querySelector('[data-role="' + role + '"]');
    if (el) el.textContent = text;
  }

  function updateHud() {
    if (!G) return;
    if (cfg.mode === 'duel') {
      var s1 = G.snakes[0];
      var s2 = G.snakes[1];
      setRole('p1', s1.alive ? String(s1.score) : '出局');
      setRole('p2', s2.alive ? String(s2.score) : '出局');
      var wallText;
      if (G.wall.total <= 0) wallText = '无墙';
      else if (G.wall.active) wallText = Math.max(0, Math.ceil(G.wall.remaining)) + 's';
      else wallText = '已开';
      setRole('wall', wallText);
    } else {
      setRole('score', String(G.snakes[0].score));
      setRole('best', String(bests[speed.id] || 0));
      setRole('mode', speed.label);
    }
  }

  /* ================= 菜单 ================= */

  function buildMenu() {
    var modeHtml = '';
    [{ id: 'solo', label: '单人' }, { id: 'duel', label: '双人' }].forEach(function (m) {
      modeHtml += '<button class="seg" data-mode="' + m.id + '">' + m.label + '</button>';
    });
    dom.modes.innerHTML = modeHtml;
    dom.modes.addEventListener('click', function (e) {
      var b = e.target.closest('[data-mode]');
      if (!b) return;
      cfg.mode = b.getAttribute('data-mode');
      syncMode();
      toReady();
    });

    var speedHtml = '';
    for (var i = 0; i < SPEEDS.length; i++) {
      speedHtml += '<button class="seg" data-speed="' + SPEEDS[i].id + '">' + SPEEDS[i].label + '</button>';
    }
    dom.speeds.innerHTML = speedHtml;
    dom.speeds.addEventListener('click', function (e) {
      var b = e.target.closest('[data-speed]');
      if (!b) return;
      var id = b.getAttribute('data-speed');
      for (var k = 0; k < SPEEDS.length; k++) {
        if (SPEEDS[k].id === id) speed = SPEEDS[k];
      }
      syncSpeed();
      updateHud();
    });

    syncMode();
    syncSpeed();
    buildWalls();
  }

  var WALL_OPTIONS = [
    { value: 10, label: '10s' },
    { value: 20, label: '20s' },
    { value: 30, label: '30s' },
    { value: 0, label: '无' }
  ];

  function buildWalls() {
    var html = '';
    for (var i = 0; i < WALL_OPTIONS.length; i++) {
      html += '<button class="seg" data-wall="' + WALL_OPTIONS[i].value + '">' +
        WALL_OPTIONS[i].label + '</button>';
    }
    dom.walls.innerHTML = html;
    dom.walls.addEventListener('click', function (e) {
      var b = e.target.closest('[data-wall]');
      if (!b) return;
      cfg.wallSeconds = Number(b.getAttribute('data-wall'));
      syncWalls();
      toReady();
    });
    syncWalls();
  }

  function syncWalls() {
    var btns = dom.walls.querySelectorAll('[data-wall]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active',
        Number(btns[i].getAttribute('data-wall')) === cfg.wallSeconds);
    }
  }

  function syncMode() {
    var btns = dom.modes.querySelectorAll('[data-mode]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-mode') === cfg.mode);
    }
    // 围墙只在双人模式有意义
    if (dom.wallBlock) dom.wallBlock.style.display = cfg.mode === 'duel' ? '' : 'none';
  }

  function syncSpeed() {
    var btns = dom.speeds.querySelectorAll('[data-speed]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-speed') === speed.id);
    }
  }

  /* ================= 流程 ================= */

  function newGame() {
    G = Core.createGame({ mode: cfg.mode, wrap: cfg.wrap, wallSeconds: cfg.wallSeconds });
    particles = [];
    acc = 0;
    buildLedger();
    updateHud();
  }

  function toReady() {
    state = 'ready';
    newGame();
    showOverlay('ready');
  }

  function startGame() {
    state = 'playing';
    newGame();
    hideOverlay();
    lastTs = 0;
  }

  function pauseGame() {
    if (state !== 'playing') return;
    state = 'paused';
    showOverlay('paused');
  }

  function resumeGame() {
    if (state !== 'paused') return;
    state = 'playing';
    hideOverlay();
    lastTs = 0;
    acc = 0;
  }

  function endGame() {
    if (state === 'over') return;
    state = 'over';
    if (cfg.mode === 'solo') {
      var sc = G.snakes[0].score;
      if (sc > (bests[speed.id] || 0)) { bests[speed.id] = sc; saveBests(); }
    }
    showOverlay('over');
    updateHud();
  }

  /* ================= 遮罩 ================= */

  function showOverlay(kind) {
    var html = '';
    if (kind === 'ready') {
      var duel = cfg.mode === 'duel';
      html = '<div class="card">' +
        '<div class="kicker">' + (duel ? '2 PLAYERS · 同屏对战' : '1 PLAYER · 经典') + '</div>' +
        '<h2>' + (duel ? '双人对战' : '贪吃蛇') + '</h2>' +
        '<p class="sub">' + (duel
          ? '<b>P1 墨黑</b> · <b>P2 朱红</b><br>' +
            (cfg.wallSeconds > 0
              ? '前 ' + cfg.wallSeconds + ' 秒中间有围墙，撞墙即负；之后围墙打开，抢果实并躲开两条蛇。'
              : '本局不开围墙，直接全场对拼。')
          : '方向键 / WASD 转向 · 空格暂停 · R 重开') + '</p>' +
        '<button class="btn primary" data-act="start">开始游戏</button>' +
        '</div>';
    } else if (kind === 'paused') {
      html = '<div class="card">' +
        '<div class="kicker">PAUSED</div>' +
        '<h2>已暂停</h2>' +
        '<p class="sub">空格继续 · R 重开</p>' +
        '<button class="btn primary" data-act="start">继续</button>' +
        '</div>';
    } else {
      var title;
      if (cfg.mode === 'duel') {
        title = G.winner === 0 ? 'P1 获胜' : (G.winner === 1 ? 'P2 获胜' : '平局');
      } else {
        title = '撞到了';
      }
      var rows = '';
      if (cfg.mode === 'duel') {
        for (var i = 0; i < G.snakes.length; i++) {
          var s = G.snakes[i];
          var why = s.cause === 'wall' ? '撞墙' : (s.cause === 'body' ? '撞身体' : '');
          rows += '<div><span>' + (i === 0 ? 'P1' : 'P2') + '</span><b>' +
            s.score + ' 分' + (why ? ' · ' + why : '') + '</b></div>';
        }
      } else {
        rows = '<div><span>得分</span><b>' + G.snakes[0].score + '</b></div>' +
          '<div><span>最高</span><b>' + (bests[speed.id] || 0) + '</b></div>';
      }
      html = '<div class="card">' +
        '<div class="kicker">GAME OVER</div>' +
        '<h2>' + title + '</h2>' +
        '<div class="rows">' + rows + '</div>' +
        '<button class="btn primary" data-act="restart">再来一局 · R</button>' +
        '</div>';
    }
    dom.overlayInner.innerHTML = html;
    dom.overlay.classList.remove('hidden');
  }

  function hideOverlay() {
    dom.overlay.classList.add('hidden');
  }

  /* ================= 输入 ================= */

  var KEYS_SOLO = {
    KeyW: 'up', KeyA: 'left', KeyS: 'down', KeyD: 'right',
    ArrowUp: 'up', ArrowLeft: 'left', ArrowDown: 'down', ArrowRight: 'right'
  };
  var KEYS_P1 = { KeyW: 'up', KeyA: 'left', KeyS: 'down', KeyD: 'right' };
  var KEYS_P2 = { ArrowUp: 'up', ArrowLeft: 'left', ArrowDown: 'down', ArrowRight: 'right' };

  function turn(dir, player) {
    if (state === 'ready' || state === 'over') startGame();
    if (state !== 'playing' || !G) return;
    Core.setDirection(G, player || 0, dir);
  }

  function bindKeys() {
    window.addEventListener('keydown', function (e) {
      var code = e.code;

      if (code === 'Space' || code === 'Enter') {
        e.preventDefault();
        if (state === 'ready' || state === 'over') startGame();
        else if (state === 'playing') pauseGame();
        else if (state === 'paused') resumeGame();
        return;
      }
      if (code === 'KeyR') { e.preventDefault(); startGame(); return; }
      if (code === 'Escape') { e.preventDefault(); toReady(); return; }

      var handled = false;
      if (cfg.mode === 'duel') {
        if (KEYS_P1[code]) { turn(KEYS_P1[code], 0); handled = true; }
        else if (KEYS_P2[code]) { turn(KEYS_P2[code], 1); handled = true; }
      } else if (KEYS_SOLO[code]) {
        turn(KEYS_SOLO[code], 0);
        handled = true;
      }
      if (handled) e.preventDefault();
      pressed[code] = true;
    });

    window.addEventListener('keyup', function (e) { pressed[e.code] = false; });
    window.addEventListener('blur', function () {
      pressed = Object.create(null);
      pauseGame();
    });

    dom.dpad.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-dir]');
      if (b) turn(b.getAttribute('data-dir'), 0);
    });

    dom.overlay.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.getAttribute('data-act') === 'start') {
        if (state === 'paused') resumeGame(); else startGame();
      } else {
        startGame();
      }
    });

    dom.btnWrap.addEventListener('click', function () {
      cfg.wrap = !cfg.wrap;
      dom.btnWrap.textContent = cfg.wrap ? '穿墙：开' : '穿墙：关';
      dom.btnWrap.classList.toggle('active', cfg.wrap);
      if (G) G.wrap = cfg.wrap;
    });
  }

  /* ================= 主循环 ================= */

  function tickSeconds() {
    var eaten = G ? G.snakes[0].score / 10 : 0;
    var base = speed.tick;
    var ms = Math.max(base * 0.55, base - eaten * 3);
    return ms / 1000;
  }

  function frame(ts) {
    requestAnimationFrame(frame);

    if (!lastTs) lastTs = ts;
    var dt = Math.min((ts - lastTs) / 1000, 0.1);
    lastTs = ts;
    clock += dt;

    if (state === 'playing' && G && G.phase === 'playing') {
      acc += dt;
      var stepDt = tickSeconds();
      var guard = 0;
      while (acc >= stepDt && state === 'playing' && guard++ < 8) {
        acc -= stepDt;
        Core.step(G, stepDt);
        if (G.phase === 'over') break;
      }
    }

    consumeEvents();
    updateParticles(dt);
    if (G) { draw(); updateHud(); }
  }

  /* ================= 启动 ================= */

  function init() {
    ctx = dom.canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', function () { resizeCanvas(); draw(); });
    buildMenu();
    bindKeys();
    toReady();
    requestAnimationFrame(frame);
  }

  // 调试钩子（自动化测试用）
  window.SnakeDebug = {
    get game() { return G; },
    get state() { return state; },
    get cfg() { return cfg; },
    turn: turn,
    start: startGame
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
