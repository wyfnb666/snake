/* 贪吃蛇核心逻辑：单人 / 双人同屏
 * 纯数据，不碰 DOM。浏览器挂 window.SnakeGame，Node 下可 require 测试。
 *
 * 双人规则：
 *  - 开局有一段“围墙期”：竖墙把场地平分左右，两侧各自生成等量果实
 *  - 围墙期内任何穿越中墙的行为立即判负（环绕也不例外，只能在自己半场内环绕）
 *  - 最后 3 秒会发 wall-warning 事件，供界面预警
 *  - 围墙期结束后墙体消失，果实改回单人规则（全场 1 个，可能带特殊效果）
 *  - 撞自己身体、对方身体、障碍物、场地边界都判负
 *  - 一方出局另一方获胜；同时出局为平局（本局不计分）
 *
 * 速度：每条蛇各自计时，速度只受自己吃到的果实数量影响（互不干扰）；
 *       吃到冰霜果实会让对手减速 2.5 秒（每步耗时翻倍）。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SnakeGame = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 }
  };

  var DEFAULTS = {
    cols: 32,
    rows: 32,
    wrap: false,
    tick: 0.125,         // 每步耗时（秒），由应用层的速度档决定
    wallSeconds: 20,     // 围墙存在时长
    foodsPerSide: 2,     // 围墙期每侧果实数
    foodsAfterOpen: 1,   // 围墙消失后的果实数
    obstacles: false,    // 是否启用静态障碍
    roundsToWin: 2       // 三局两胜
  };

  var FOOD = { NORMAL: 'normal', GOLD: 'gold', FROST: 'frost', BOMB: 'bomb' };
  var FOOD_SCORE = { normal: 10, gold: 30, frost: 10, bomb: -20 };
  var GOLD_TTL = 6;
  var FROST_SLOW = 2.5;

  function key(x, y) { return x + ',' + y; }

  function makeSnake(id, body, dir) {
    return {
      id: id,
      body: body,
      dir: dir,
      nextDir: dir,
      score: 0,
      eaten: 0,
      alive: true,
      cause: null,
      timer: 0,
      slow: 0
    };
  }

  /* ---------------- 障碍 ---------------- */

  function buildObstacles(cols, rows) {
    var mid = Math.floor(cols / 2);
    var left = [
      { x: 4, y: 6, w: 2, h: 6 },
      { x: 9, y: 13, w: 4, h: 2 },
      { x: 5, y: 22, w: 3, h: 3 }
    ];

    // 按实际尺寸等比缩放（基准 32×32）
    var sx = cols / 32;
    var sy = rows / 32;
    var blocks = [];
    for (var i = 0; i < left.length; i++) {
      var b = left[i];
      var r = {
        x: Math.round(b.x * sx),
        y: Math.round(b.y * sy),
        w: Math.max(1, Math.round(b.w * sx)),
        h: Math.max(1, Math.round(b.h * sy))
      };
      if (r.x + r.w <= mid - 1) blocks.push(r);
    }
    // 镜像到右半场，保证两边完全对称
    var mirrored = [];
    for (var j = 0; j < blocks.length; j++) {
      var m = blocks[j];
      mirrored.push({ x: cols - m.x - m.w, y: m.y, w: m.w, h: m.h });
    }
    return blocks.concat(mirrored);
  }

  function obstacleSet(g) {
    var set = Object.create(null);
    for (var i = 0; i < g.obstacles.length; i++) {
      var b = g.obstacles[i];
      for (var y = b.y; y < b.y + b.h; y++) {
        for (var x = b.x; x < b.x + b.w; x++) set[key(x, y)] = true;
      }
    }
    return set;
  }

  /* ---------------- 生成 ---------------- */

  function createGame(opts) {
    opts = opts || {};
    var cols = opts.cols || DEFAULTS.cols;
    var rows = opts.rows || DEFAULTS.rows;
    var mode = opts.mode === 'duel' ? 'duel' : 'solo';
    var rng = opts.rng || Math.random;
    var mid = Math.floor(cols / 2);
    var wallSeconds = opts.wallSeconds != null ? opts.wallSeconds : DEFAULTS.wallSeconds;

    var snakes = [];
    if (mode === 'duel') {
      var ry = rows - 4;
      snakes.push(makeSnake(0, [
        { x: mid - 4, y: ry },
        { x: mid - 4, y: ry + 1 },
        { x: mid - 4, y: ry + 2 }
      ], 'up'));
      snakes.push(makeSnake(1, [
        { x: mid + 3, y: ry },
        { x: mid + 3, y: ry + 1 },
        { x: mid + 3, y: ry + 2 }
      ], 'up'));
    } else {
      snakes.push(makeSnake(0, [
        { x: mid, y: Math.floor(rows / 2) },
        { x: mid - 1, y: Math.floor(rows / 2) },
        { x: mid - 2, y: Math.floor(rows / 2) }
      ], 'right'));
    }

    var g = {
      mode: mode,
      cols: cols,
      rows: rows,
      wrap: !!opts.wrap,
      rng: rng,
      baseTick: opts.tick || DEFAULTS.tick,
      obstacles: opts.obstacles ? buildObstacles(cols, rows) : [],
      snakes: snakes,
      foods: [],
      events: [],
      phase: 'playing',
      time: 0,
      winner: null,
      wall: {
        active: mode === 'duel' && wallSeconds > 0,
        x: mid,
        total: wallSeconds,
        remaining: wallSeconds
      }
    };

    g.blocked = obstacleSet(g);
    topUpFoods(g);
    return g;
  }

  /* ---------------- 食物 ---------------- */

  function occupied(g) {
    var taken = Object.create(null);
    for (var i = 0; i < g.snakes.length; i++) {
      var body = g.snakes[i].body;
      for (var j = 0; j < body.length; j++) taken[key(body[j].x, body[j].y)] = true;
    }
    for (var k = 0; k < g.foods.length; k++) taken[key(g.foods[k].x, g.foods[k].y)] = true;
    for (var b in g.blocked) taken[b] = true;
    return taken;
  }

  function pickType(g) {
    var r = g.rng();
    if (r < 0.16) return FOOD.GOLD;
    if (r < 0.28) return FOOD.FROST;
    if (r < 0.40) return FOOD.BOMB;
    return FOOD.NORMAL;
  }

  function spawnFood(g, side, type) {
    var taken = occupied(g);
    var mid = g.wall.x;
    var free = [];
    for (var y = 0; y < g.rows; y++) {
      for (var x = 0; x < g.cols; x++) {
        if (taken[key(x, y)]) continue;
        if (side === 'left' && x >= mid) continue;
        if (side === 'right' && x < mid) continue;
        free.push({ x: x, y: y });
      }
    }
    if (!free.length) return false;
    var c = free[Math.floor(g.rng() * free.length)];
    var t = type || FOOD.NORMAL;
    g.foods.push({ x: c.x, y: c.y, type: t, ttl: t === FOOD.GOLD ? GOLD_TTL : null });
    return true;
  }

  function countSide(g, left) {
    var mid = g.wall.x;
    var n = 0;
    for (var i = 0; i < g.foods.length; i++) {
      if ((g.foods[i].x < mid) === left) n++;
    }
    return n;
  }

  function topUpFoods(g) {
    // 围墙期：两侧等量、都是普通果实，保证公平
    if (g.mode === 'duel' && g.wall.active) {
      var perSide = DEFAULTS.foodsPerSide;
      var gl = 0, gr = 0;
      while (countSide(g, true) < perSide && gl++ < 50) {
        if (!spawnFood(g, 'left', FOOD.NORMAL)) break;
      }
      while (countSide(g, false) < perSide && gr++ < 50) {
        if (!spawnFood(g, 'right', FOOD.NORMAL)) break;
      }
      return;
    }

    var guard = 0;
    while (g.foods.length < 1 && guard++ < 50) {
      if (!spawnFood(g, 'any', pickType(g))) break;
    }
  }

  function foodIndexAt(g, x, y) {
    for (var i = 0; i < g.foods.length; i++) {
      if (g.foods[i].x === x && g.foods[i].y === y) return i;
    }
    return -1;
  }

  /* ---------------- 方向 ---------------- */

  function setDirection(g, player, dir) {
    var s = g.snakes[player];
    if (!s || !s.alive) return false;
    var nd = DIRS[dir];
    if (!nd) return false;
    var cur = DIRS[s.dir];
    if (nd.x === -cur.x && nd.y === -cur.y) return false;
    var queued = DIRS[s.nextDir];
    if (nd.x === -queued.x && nd.y === -queued.y) return false;
    s.nextDir = dir;
    return true;
  }

  /* ---------------- 死亡与胜负 ---------------- */

  function kill(g, s, cause) {
    if (!s.alive) return;
    s.alive = false;
    s.cause = cause;
    var head = s.body[0];
    g.events.push({ type: 'death', id: s.id, cause: cause, x: head.x, y: head.y });
  }

  function resolveWinner(g) {
    if (g.phase === 'over') return;
    var alive = [];
    for (var i = 0; i < g.snakes.length; i++) {
      if (g.snakes[i].alive) alive.push(g.snakes[i]);
    }
    if (alive.length === g.snakes.length) return;

    g.phase = 'over';
    g.winner = alive.length === 1 ? alive[0].id : null;
    g.events.push({ type: 'over', winner: g.winner });
  }

  /* ---------------- 速度 ---------------- */

  function intervalOf(g, s) {
    var ramp = Math.min(s.eaten * 0.004, g.baseTick * 0.45);
    var base = Math.max(g.baseTick * 0.55, g.baseTick - ramp);
    return s.slow > 0 ? base * 2 : base;
  }

  /* ---------------- 单条蛇推进 ---------------- */

  function advance(g, s) {
    if (!s.alive) return 'skip';

    var d = DIRS[s.nextDir];
    s.dir = s.nextDir;

    var head = s.body[0];
    var nx = head.x + d.x;
    var ny = head.y + d.y;
    var mid = g.wall.x;

    if (g.wall.active) {
      var wasLeft = head.x < mid;
      var crossing = wasLeft ? nx >= mid : nx < mid;
      if (crossing) {
        kill(g, s, 'wall');
        return 'wall';
      }
    }

    if (g.wrap) {
      if (g.wall.active) {
        if (head.x < mid) {
          if (nx < 0) nx = mid - 1;
          else if (nx >= mid) nx = 0;
        } else {
          if (nx >= g.cols) nx = mid;
          else if (nx < mid) nx = g.cols - 1;
        }
      } else {
        if (nx < 0) nx = g.cols - 1;
        else if (nx >= g.cols) nx = 0;
      }
      if (ny < 0) ny = g.rows - 1;
      else if (ny >= g.rows) ny = 0;
    } else if (nx < 0 || ny < 0 || nx >= g.cols || ny >= g.rows) {
      kill(g, s, 'wall');
      return 'wall';
    }

    if (g.blocked[key(nx, ny)]) {
      kill(g, s, 'obstacle');
      return 'obstacle';
    }

    var foodIdx = foodIndexAt(g, nx, ny);
    var eats = foodIdx >= 0;
    var food = eats ? g.foods[foodIdx] : null;

    var hit = false;
    for (var i = 0; i < g.snakes.length && !hit; i++) {
      var cells = g.snakes[i].body;
      var limit = cells.length;
      if (!eats && limit > 1) limit -= 1;
      for (var j = 0; j < limit; j++) {
        if (cells[j].x === nx && cells[j].y === ny) { hit = true; break; }
      }
    }
    if (hit) {
      kill(g, s, 'body');
      return 'body';
    }

    s.body.unshift({ x: nx, y: ny });

    if (!eats) {
      s.body.pop();
      return 'move';
    }

    g.foods.splice(foodIdx, 1);

    if (food.type === FOOD.BOMB) {
      s.score = Math.max(0, s.score + FOOD_SCORE.bomb);
      // 头部刚前进了一格，要净缩短 2 节，所以这里弹 3 次（下限 3 节）
      var shrink = 0;
      while (s.body.length > 3 && shrink < 3) { s.body.pop(); shrink++; }
      g.events.push({ type: 'eat', id: s.id, kind: 'bomb', x: nx, y: ny });
      return 'eat';
    }

    s.score += FOOD_SCORE[food.type] || 10;
    s.eaten++;

    if (food.type === FOOD.FROST) {
      var other = g.snakes[1 - s.id];
      if (other && other.alive) other.slow = FROST_SLOW;
    }
    g.events.push({ type: 'eat', id: s.id, kind: food.type, x: nx, y: ny });
    return 'eat';
  }

  /* ---------------- 主推进 ---------------- */

  function step(g, dt) {
    if (g.phase === 'over') return 'over';
    dt = dt || 0.016;

    g.time += dt;

    if (g.wall.active) {
      var before = g.wall.remaining;
      g.wall.remaining -= dt;
      if (before > 3 && g.wall.remaining <= 3) g.events.push({ type: 'wall-warning' });
      if (g.wall.remaining <= 0) {
        g.wall.active = false;
        g.wall.remaining = 0;
        g.foods = [];
        g.events.push({ type: 'wall-open' });
      }
    }

    // 金果实会过期
    for (var f = g.foods.length - 1; f >= 0; f--) {
      var it = g.foods[f];
      if (it.ttl != null) {
        it.ttl -= dt;
        if (it.ttl <= 0) g.foods.splice(f, 1);
      }
    }

    var result = 'move';
    for (var i = 0; i < g.snakes.length; i++) {
      var s = g.snakes[i];
      if (!s.alive) continue;

      s.timer += dt;
      var guard = 0;
      while (s.alive && s.timer >= intervalOf(g, s) && guard++ < 4) {
        s.timer -= intervalOf(g, s);
        var r = advance(g, s);
        if (r === 'wall' || r === 'body' || r === 'obstacle') result = 'die';
      }
      if (s.slow > 0) s.slow = Math.max(0, s.slow - dt);
    }

    topUpFoods(g);
    resolveWinner(g);
    if (g.phase === 'over') return 'over';
    return result;
  }

  /* ---------------- 三局两胜 ---------------- */

  function createMatchState(opts) {
    opts = opts || {};
    return {
      roundsToWin: opts.roundsToWin || DEFAULTS.roundsToWin,
      wins: [0, 0],
      round: 1,
      over: false,
      champion: null
    };
  }

  function recordRound(ms, winnerId) {
    if (winnerId === 0 || winnerId === 1) ms.wins[winnerId]++;
    if (ms.wins[0] >= ms.roundsToWin) { ms.over = true; ms.champion = 0; }
    else if (ms.wins[1] >= ms.roundsToWin) { ms.over = true; ms.champion = 1; }
    if (!ms.over) ms.round++;
    return ms;
  }

  return {
    DIRS: DIRS,
    DEFAULTS: DEFAULTS,
    FOOD: FOOD,
    FOOD_SCORE: FOOD_SCORE,
    GOLD_TTL: GOLD_TTL,
    FROST_SLOW: FROST_SLOW,
    createGame: createGame,
    step: step,
    setDirection: setDirection,
    topUpFoods: topUpFoods,
    spawnFood: spawnFood,
    buildObstacles: buildObstacles,
    intervalOf: intervalOf,
    createMatchState: createMatchState,
    recordRound: recordRound
  };
});
