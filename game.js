/* 贪吃蛇核心逻辑：单人 / 双人同屏
 * 纯数据，不碰 DOM。浏览器挂 window.SnakeGame，Node 下可 require 测试。
 *
 * 双人规则：
 *  - 开局前 20 秒是“围墙期”：竖墙把场地平分左右，两侧各自生成等量果实
 *  - 围墙期内任何穿越中墙的行为立即判负（环绕也不例外，只能在自己半场内环绕）
 *  - 20 秒后墙体消失，果实改回单人规则（全场 1 个）
 *  - 撞自己身体、对方身体、场地边界（未开穿墙时）都判负
 *  - 一方出局另一方获胜；同时出局为平局
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
    cols: 24,
    rows: 24,
    wrap: false,
    wallSeconds: 20,     // 围墙存在时长（秒）
    foodsPerSide: 2,     // 围墙期每侧果实数
    foodsAfterOpen: 1    // 围墙消失后的果实数（单人规则）
  };

  function key(x, y) { return x + ',' + y; }

  function makeSnake(id, body, dir) {
    return {
      id: id,
      body: body,
      dir: dir,
      nextDir: dir,
      score: 0,
      alive: true,
      cause: null
    };
  }

  /* ---------------- 生成 ---------------- */

  function createGame(opts) {
    opts = opts || {};
    var cols = opts.cols || DEFAULTS.cols;
    var rows = opts.rows || DEFAULTS.rows;
    var mode = opts.mode === 'duel' ? 'duel' : 'solo';
    var rng = opts.rng || Math.random;
    var mid = Math.floor(cols / 2);

    var snakes = [];
    if (mode === 'duel') {
      // 开局朝上、靠下摆放：给玩家留出反应时间，不会一开局就撞中墙
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
      var cy = Math.floor(rows / 2);
      snakes.push(makeSnake(0, [
        { x: mid, y: cy },
        { x: mid - 1, y: cy },
        { x: mid - 2, y: cy }
      ], 'right'));
    }

    var wallSeconds = opts.wallSeconds != null ? opts.wallSeconds : DEFAULTS.wallSeconds;

    var g = {
      mode: mode,
      cols: cols,
      rows: rows,
      wrap: !!opts.wrap,
      rng: rng,
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
    return taken;
  }

  function spawnFood(g, side) {
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
    g.foods.push({ x: c.x, y: c.y });
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

  /* 把果实补到当前阶段应有的数量 */
  function topUpFoods(g) {
    if (g.mode === 'solo' || !g.wall.active) {
      var target = g.mode === 'duel' ? DEFAULTS.foodsAfterOpen : 1;
      var guard = 0;
      while (g.foods.length < target && guard++ < 50) {
        if (!spawnFood(g, 'any')) break;
      }
      return;
    }

    var perSide = DEFAULTS.foodsPerSide;
    var guardL = 0;
    while (countSide(g, true) < perSide && guardL++ < 50) {
      if (!spawnFood(g, 'left')) break;
    }
    var guardR = 0;
    while (countSide(g, false) < perSide && guardR++ < 50) {
      if (!spawnFood(g, 'right')) break;
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

  /* ---------------- 单条蛇推进 ---------------- */

  function advance(g, s) {
    if (!s.alive) return 'skip';

    var d = DIRS[s.nextDir];
    s.dir = s.nextDir;

    var head = s.body[0];
    var nx = head.x + d.x;
    var ny = head.y + d.y;
    var mid = g.wall.x;

    // 围墙期：跨越中线即撞墙
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
        // 只在自己半场内环绕，不许借环绕穿墙
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

    var foodIdx = foodIndexAt(g, nx, ny);
    var eats = foodIdx >= 0;

    // 撞身体：不吃果实时尾巴会移开，所以尾巴格不算
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
    if (eats) {
      s.score += 10;
      g.foods.splice(foodIdx, 1);
      g.events.push({ type: 'eat', id: s.id, x: nx, y: ny });
      return 'eat';
    }
    s.body.pop();
    return 'move';
  }

  /* ---------------- 主推进 ---------------- */

  function step(g, dt) {
    if (g.phase === 'over') return 'over';
    dt = dt || 0.1;

    g.time += dt;
    if (g.wall.active) {
      g.wall.remaining -= dt;
      if (g.wall.remaining <= 0) {
        g.wall.active = false;
        g.wall.remaining = 0;
        g.foods = [];
        g.events.push({ type: 'wall-open' });
      }
    }

    var result = 'move';
    for (var i = 0; i < g.snakes.length; i++) {
      var r = advance(g, g.snakes[i]);
      if (r === 'wall' || r === 'body') result = 'die';
    }

    topUpFoods(g);
    resolveWinner(g);
    if (g.phase === 'over') return 'over';
    return result;
  }

  return {
    DIRS: DIRS,
    DEFAULTS: DEFAULTS,
    createGame: createGame,
    step: step,
    setDirection: setDirection,
    topUpFoods: topUpFoods,
    spawnFood: spawnFood
  };
});
