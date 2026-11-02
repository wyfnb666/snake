/* 逻辑测试：node game.test.js
 * 覆盖单人回归 + 双人（围墙期 / 打开后 / 胜负判定）
 * 坐标相关的用例统一用 20×20 的小场地，便于精确摆放；默认场地另有断言 */
'use strict';

var G = require('./game.js');

var pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; console.log('  ✗ ' + msg); }
}

function seedRng(seed) {
  var s = seed;
  return function () {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function mk(opts) {
  opts = opts || {};
  if (opts.cols == null) opts.cols = 20;
  if (opts.rows == null) opts.rows = 20;
  return G.createGame(opts);
}

function setBody(snake, cells, dir) {
  snake.body = cells.map(function (c) { return { x: c[0], y: c[1] }; });
  snake.dir = dir || snake.dir;
  snake.nextDir = dir || snake.nextDir;
}

/* ================= 默认场地 ================= */

console.log('0) 默认场地尺寸');
var def = G.createGame({ rng: seedRng(0) });
ok(def.cols === 24 && def.rows === 24, '默认 24×24（实际 ' + def.cols + '×' + def.rows + '）');

/* ================= 单人 ================= */

console.log('1) 单人开局');
var g = mk({ rng: seedRng(1) });
ok(g.mode === 'solo', '模式是单人');
ok(g.snakes.length === 1, '只有一条蛇');
ok(g.snakes[0].body.length === 3, '初始长度 3');
ok(g.foods.length === 1, '只有一个果实');
ok(g.wall.active === false, '单人没有围墙');
ok(g.snakes[0].body.every(function (p) {
  return !(p.x === g.foods[0].x && p.y === g.foods[0].y);
}), '果实不在蛇身上');

console.log('2) 单人移动与吃食');
g = mk({ rng: seedRng(2) });
var head0 = { x: g.snakes[0].body[0].x, y: g.snakes[0].body[0].y };
G.step(g, 0.1);
ok(g.snakes[0].body[0].x === head0.x + 1, '向右移动一格');
ok(g.snakes[0].body.length === 3, '没吃时长度不变');

g = mk({ rng: seedRng(3) });
var s0 = g.snakes[0];
s0.body = [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }];
s0.dir = 'right'; s0.nextDir = 'right';
g.foods = [{ x: 6, y: 5 }];
G.step(g, 0.1);
ok(s0.score === 10, '吃掉果实得 10 分');
ok(s0.body.length === 4, '长度 +1');
ok(g.foods.length === 1, '补回一个果实');

console.log('3) 禁止 180° 掉头');
g = mk({ rng: seedRng(4) });
ok(G.setDirection(g, 0, 'left') === false, '向右时不能直接向左');
ok(G.setDirection(g, 0, 'up') === true, '可以向上');
ok(G.setDirection(g, 0, 'down') === false, '一拍内不能连转两次');

console.log('4) 撞墙 / 撞自己 / 尾巴格');
g = mk({ rng: seedRng(5) });
setBody(g.snakes[0], [[19, 5], [18, 5], [17, 5]], 'right');
G.step(g, 0.1);
ok(g.snakes[0].alive === false, '撞边界死亡');
ok(g.snakes[0].cause === 'wall', '死因是 wall');
ok(g.phase === 'over', '比赛结束');

g = mk({ rng: seedRng(6) });
setBody(g.snakes[0], [[5, 5], [5, 6], [4, 6], [4, 5], [4, 4]], 'left');
g.foods = [{ x: 0, y: 0 }];
G.step(g, 0.1);
ok(g.snakes[0].alive === false && g.snakes[0].cause === 'body', '撞自己身体死亡');

g = mk({ rng: seedRng(7) });
setBody(g.snakes[0], [[5, 5], [5, 6], [4, 6], [4, 5]], 'left');
g.foods = [{ x: 0, y: 0 }];
G.step(g, 0.1);
ok(g.snakes[0].alive === true, '进入即将离开的尾巴格不算死');

/* ================= 双人 ================= */

console.log('5) 双人开局');
g = mk({ mode: 'duel', rng: seedRng(10) });
ok(g.snakes.length === 2, '两条蛇');
ok(g.wall.active === true, '开局有围墙');
ok(g.wall.remaining === 20, '围墙持续 20 秒（实际 ' + g.wall.remaining + '）');
ok(g.wall.x === 10, '围墙在正中 x=10');
ok(g.snakes[0].body[0].x < 10, 'P1 在左半场');
ok(g.snakes[1].body[0].x > 10, 'P2 在右半场');
ok(g.snakes[0].dir === 'up' && g.snakes[1].dir === 'up', '开局都朝上，留出反应时间');

var left = g.foods.filter(function (f) { return f.x < 10; }).length;
var right = g.foods.length - left;
ok(left === 2 && right === 2, '两侧果实数量相同（左 ' + left + ' / 右 ' + right + '）');

console.log('6) 围墙不可穿越');
g = mk({ mode: 'duel', rng: seedRng(11) });
setBody(g.snakes[0], [[9, 5], [8, 5], [7, 5]], 'right');
setBody(g.snakes[1], [[17, 12], [18, 12], [19, 12]], 'down');
G.step(g, 0.1);
ok(g.snakes[0].alive === false, 'P1 撞中墙死亡');
ok(g.snakes[0].cause === 'wall', '死因是撞墙');
ok(g.phase === 'over' && g.winner === 1, 'P2 获胜');

console.log('7) 围墙期环绕只在本半场');
g = mk({ mode: 'duel', wrap: true, rng: seedRng(12) });
setBody(g.snakes[0], [[0, 5], [1, 5], [2, 5]], 'left');
setBody(g.snakes[1], [[15, 12], [14, 12], [13, 12]], 'right');
G.step(g, 0.1);
ok(g.snakes[0].alive === true, '环绕不会撞墙死亡');
ok(g.snakes[0].body[0].x === 9, '从左边界绕回左半场最右格（实际 x=' + g.snakes[0].body[0].x + '）');

console.log('8) 20 秒后围墙打开');
g = mk({ mode: 'duel', wallSeconds: 0.3, rng: seedRng(13) });
setBody(g.snakes[0], [[4, 4], [3, 4], [2, 4]], 'up');
setBody(g.snakes[1], [[15, 4], [16, 4], [17, 4]], 'up');
ok(g.wall.active === true, '打开前有墙');
G.step(g, 0.4);
ok(g.wall.active === false, '到时墙体消失');
ok(g.foods.length === 1, '果实回到单人规则（1 个，实际 ' + g.foods.length + '）');
ok(g.phase === 'playing', '比赛继续');

console.log('9) 撞对方身体');
g = mk({ mode: 'duel', rng: seedRng(14) });
setBody(g.snakes[0], [[5, 5], [4, 5], [3, 5]], 'right');
setBody(g.snakes[1], [[6, 5], [8, 5], [9, 5]], 'down');
g.foods = [];
G.step(g, 0.1);
ok(g.snakes[0].alive === false, 'P1 撞到 P2 身体');
ok(g.snakes[0].cause === 'body', '死因是身体碰撞');
ok(g.winner === 1, 'P2 获胜');

console.log('10) 同时出局 = 平局');
g = mk({ mode: 'duel', rng: seedRng(15) });
setBody(g.snakes[0], [[9, 5], [8, 5], [7, 5]], 'right');
setBody(g.snakes[1], [[10, 5], [11, 5], [12, 5]], 'left');
g.foods = [];
G.step(g, 0.1);
ok(g.snakes[0].alive === false && g.snakes[1].alive === false, '两条蛇同时出局');
ok(g.phase === 'over' && g.winner === null, '判为平局');

console.log('11) 双人吃果实与双方计分');
g = mk({ mode: 'duel', rng: seedRng(16) });
setBody(g.snakes[0], [[5, 5], [4, 5], [3, 5]], 'right');
setBody(g.snakes[1], [[15, 15], [16, 15], [17, 15]], 'left');
g.foods = [{ x: 6, y: 5 }, { x: 2, y: 2 }, { x: 15, y: 3 }, { x: 17, y: 3 }];
G.step(g, 0.1);
ok(g.snakes[0].score === 10, 'P1 计分 +10');
ok(g.snakes[1].score === 0, 'P2 不受影响');
left = g.foods.filter(function (f) { return f.x < 10; }).length;
right = g.foods.length - left;
ok(left === 2 && right === 2, '吃掉后两侧仍各 2 个（左 ' + left + ' / 右 ' + right + '）');

console.log('12) 单人穿墙仍然有效');
g = mk({ wrap: true, rng: seedRng(17) });
setBody(g.snakes[0], [[0, 5], [1, 5], [2, 5]], 'left');
g.foods = [{ x: 10, y: 10 }];
G.step(g, 0.1);
ok(g.snakes[0].alive === true, '单人开穿墙不撞死');
ok(g.snakes[0].body[0].x === 19, '从左边界穿到右边');

console.log('13) 大场地也能正常开局');
g = G.createGame({ mode: 'duel', rng: seedRng(18) });
ok(g.wall.x === 12, '24 宽时围墙落在 x=12');
ok(g.snakes[0].body[0].x < 12 && g.snakes[1].body[0].x > 12, '两人分处左右半场');
left = g.foods.filter(function (f) { return f.x < 12; }).length;
right = g.foods.length - left;
ok(left === 2 && right === 2, '大场地两侧果实同样等量（左 ' + left + ' / 右 ' + right + '）');

console.log('14) 围墙时长可自定义');
g = mk({ mode: 'duel', wallSeconds: 10, rng: seedRng(19) });
ok(g.wall.total === 10 && g.wall.remaining === 10, '可指定 10 秒（实际 ' + g.wall.remaining + '）');
ok(g.wall.active === true, '10 秒时开局有墙');

g = mk({ mode: 'duel', wallSeconds: 0, rng: seedRng(20) });
ok(g.wall.active === false, '设为 0 时开局没有墙');
ok(g.wall.total === 0, '总时长记为 0');
setBody(g.snakes[0], [[9, 5], [8, 5], [7, 5]], 'right');
setBody(g.snakes[1], [[17, 12], [18, 12], [19, 12]], 'down');
g.foods = [];
G.step(g, 0.1);
ok(g.snakes[0].alive === true, '无墙时可以正常穿过中线');
ok(g.snakes[0].body[0].x === 10, 'P1 走到了右半场（x=' + g.snakes[0].body[0].x + '）');

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
