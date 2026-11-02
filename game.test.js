/* 逻辑测试：node game.test.js
 * 覆盖：场地尺寸 / 单人 / 双人围墙 / 独立速度 / 四种果实 / 障碍 / 预警 / 三局两胜
 * 坐标相关用例统一用 20×20、tick=0.1 的小场地，便于精确摆放 */
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
  if (opts.tick == null) opts.tick = 0.1;
  return G.createGame(opts);
}

function setBody(snake, cells, dir) {
  snake.body = cells.map(function (c) { return { x: c[0], y: c[1] }; });
  snake.dir = dir || snake.dir;
  snake.nextDir = dir || snake.nextDir;
}

/* ================= 场地 ================= */

console.log('0) 默认场地与速度');
var def = G.createGame({ rng: seedRng(0) });
ok(def.cols === 32 && def.rows === 32, '默认 32×32（实际 ' + def.cols + '×' + def.rows + '）');
ok(def.baseTick === 0.125, '默认每步 0.125 秒');
ok(def.wall.x === 16, '32 宽时围墙在 x=16');

/* ================= 单人 ================= */

console.log('1) 单人开局与移动');
var g = mk({ rng: seedRng(1) });
ok(g.mode === 'solo', '模式是单人');
ok(g.snakes.length === 1, '只有一条蛇');
ok(g.snakes[0].body.length === 3, '初始长度 3');
ok(g.foods.length === 1, '只有一个果实');
ok(g.wall.active === false, '单人没有围墙');
ok(g.obstacles.length === 0, '默认没有障碍');

var head0 = { x: g.snakes[0].body[0].x, y: g.snakes[0].body[0].y };
G.step(g, 0.1);
ok(g.snakes[0].body[0].x === head0.x + 1, '向右移动一格');
ok(g.snakes[0].body.length === 3, '没吃时长度不变');

console.log('2) 吃普通果实');
g = mk({ rng: seedRng(2) });
setBody(g.snakes[0], [[5, 5], [4, 5], [3, 5]], 'right');
g.foods = [{ x: 6, y: 5, type: 'normal', ttl: null }];
G.step(g, 0.1);
ok(g.snakes[0].score === 10, '普通果实 +10（实际 ' + g.snakes[0].score + '）');
ok(g.snakes[0].body.length === 4, '长度 +1');
ok(g.snakes[0].eaten === 1, '吃过计数 +1');
ok(g.foods.length === 1, '补回一个果实');

console.log('3) 禁止 180° 掉头');
g = mk({ rng: seedRng(3) });
ok(G.setDirection(g, 0, 'left') === false, '向右时不能直接向左');
ok(G.setDirection(g, 0, 'up') === true, '可以向上');
ok(G.setDirection(g, 0, 'down') === false, '一拍内不能连转两次');

console.log('4) 撞墙 / 撞自己 / 尾巴格');
g = mk({ rng: seedRng(4) });
setBody(g.snakes[0], [[19, 5], [18, 5], [17, 5]], 'right');
G.step(g, 0.1);
ok(g.snakes[0].alive === false && g.snakes[0].cause === 'wall', '撞边界死亡');
ok(g.phase === 'over', '比赛结束');

g = mk({ rng: seedRng(5) });
setBody(g.snakes[0], [[5, 5], [5, 6], [4, 6], [4, 5], [4, 4]], 'left');
g.foods = [];
G.step(g, 0.1);
ok(g.snakes[0].alive === false && g.snakes[0].cause === 'body', '撞自己身体死亡');

g = mk({ rng: seedRng(6) });
setBody(g.snakes[0], [[5, 5], [5, 6], [4, 6], [4, 5]], 'left');
g.foods = [];
G.step(g, 0.1);
ok(g.snakes[0].alive === true, '进入即将离开的尾巴格不算死');

/* ================= 双人 ================= */

console.log('5) 双人开局');
g = mk({ mode: 'duel', rng: seedRng(10) });
ok(g.snakes.length === 2, '两条蛇');
ok(g.wall.active === true, '开局有围墙');
ok(g.wall.remaining === 20, '围墙 20 秒');
ok(g.snakes[0].body[0].x < 10 && g.snakes[1].body[0].x > 10, '两人分处左右半场');
ok(g.snakes[0].dir === 'up' && g.snakes[1].dir === 'up', '开局都朝上');

var left = g.foods.filter(function (f) { return f.x < 10; }).length;
var right = g.foods.length - left;
ok(left === 2 && right === 2, '两侧果实等量（左 ' + left + ' / 右 ' + right + '）');
ok(g.foods.every(function (f) { return f.type === 'normal'; }), '围墙期只出普通果实');

console.log('6) 围墙不可穿越');
g = mk({ mode: 'duel', rng: seedRng(11) });
setBody(g.snakes[0], [[9, 5], [8, 5], [7, 5]], 'right');
setBody(g.snakes[1], [[17, 12], [18, 12], [19, 12]], 'down');
G.step(g, 0.1);
ok(g.snakes[0].alive === false && g.snakes[0].cause === 'wall', 'P1 撞中墙死亡');
ok(g.winner === 1, 'P2 获胜');

console.log('7) 围墙期环绕只在本半场');
g = mk({ mode: 'duel', wrap: true, rng: seedRng(12) });
setBody(g.snakes[0], [[0, 5], [1, 5], [2, 5]], 'left');
setBody(g.snakes[1], [[15, 12], [14, 12], [13, 12]], 'right');
G.step(g, 0.1);
ok(g.snakes[0].alive === true, '环绕不会撞墙死亡');
ok(g.snakes[0].body[0].x === 9, '绕回自己半场最右格（x=' + g.snakes[0].body[0].x + '）');

console.log('8) 围墙打开');
g = mk({ mode: 'duel', wallSeconds: 0.3, rng: seedRng(13) });
setBody(g.snakes[0], [[4, 4], [3, 4], [2, 4]], 'up');
setBody(g.snakes[1], [[15, 4], [16, 4], [17, 4]], 'up');
G.step(g, 0.4);
ok(g.wall.active === false, '到时墙体消失');
ok(g.foods.length === 1, '果实回到 1 个');
ok(g.phase === 'playing', '比赛继续');

console.log('9) 围墙最后 3 秒预警');
g = mk({ mode: 'duel', wallSeconds: 5, rng: seedRng(14) });
setBody(g.snakes[0], [[4, 4], [3, 4], [2, 4]], 'up');
setBody(g.snakes[1], [[15, 4], [16, 4], [17, 4]], 'up');
G.step(g, 1);
ok(!g.events.some(function (e) { return e.type === 'wall-warning'; }), '剩余 4 秒时还不预警');
G.step(g, 1.2);
ok(g.events.some(function (e) { return e.type === 'wall-warning'; }), '跌破 3 秒时发出预警');

console.log('10) 撞对方身体 / 同时出局');
g = mk({ mode: 'duel', rng: seedRng(15) });
setBody(g.snakes[0], [[5, 5], [4, 5], [3, 5]], 'right');
setBody(g.snakes[1], [[6, 5], [8, 5], [9, 5]], 'down');
g.foods = [];
G.step(g, 0.1);
ok(g.snakes[0].alive === false && g.snakes[0].cause === 'body', 'P1 撞到 P2 身体');
ok(g.winner === 1, 'P2 获胜');

g = mk({ mode: 'duel', rng: seedRng(16) });
setBody(g.snakes[0], [[9, 5], [8, 5], [7, 5]], 'right');
setBody(g.snakes[1], [[10, 5], [11, 5], [12, 5]], 'left');
g.foods = [];
G.step(g, 0.1);
ok(g.winner === null && g.phase === 'over', '同时出局判平局');

/* ================= 独立速度 ================= */

console.log('11) 每条蛇速度独立');
g = mk({ mode: 'duel', rng: seedRng(20) });
var s1 = g.snakes[0], s2 = g.snakes[1];
var base1 = G.intervalOf(g, s1);
var base2 = G.intervalOf(g, s2);
ok(Math.abs(base1 - base2) < 1e-9, '开局两人速度一致');
s1.eaten = 5;
ok(G.intervalOf(g, s1) < base1, 'P1 吃得多会加速');
ok(G.intervalOf(g, s2) === base2, 'P2 速度不受 P1 影响');

/* ================= 特殊果实 ================= */

console.log('12) 冰霜果实：对手减速');
g = mk({ mode: 'duel', rng: seedRng(21) });
s1 = g.snakes[0]; s2 = g.snakes[1];
setBody(s1, [[5, 5], [4, 5], [3, 5]], 'right');
setBody(s2, [[15, 15], [16, 15], [17, 15]], 'up');
g.foods = [{ x: 6, y: 5, type: 'frost', ttl: null }];
var before2 = G.intervalOf(g, s2);
G.step(g, 0.1);
ok(s2.slow > 0, 'P2 进入减速状态（slow=' + s2.slow.toFixed(2) + '）');
ok(G.intervalOf(g, s2) > before2, 'P2 每步耗时变长');
ok(s1.slow === 0, 'P1 自己不受影响');

console.log('13) 炸弹果实：扣分并缩短');
g = mk({ rng: seedRng(22) });
s1 = g.snakes[0];
setBody(s1, [[5, 5], [4, 5], [3, 5], [2, 5], [1, 5], [0, 5]], 'right');
s1.score = 50;
g.foods = [{ x: 6, y: 5, type: 'bomb', ttl: null }];
G.step(g, 0.1);
ok(s1.score === 30, '炸弹扣 20 分（实际 ' + s1.score + '）');
ok(s1.body.length === 4, '缩短 2 节（实际 ' + s1.body.length + '）');
ok(s1.alive === true, '吃到炸弹不会直接死');

g = mk({ rng: seedRng(23) });
s1 = g.snakes[0];
setBody(s1, [[5, 5], [4, 5], [3, 5]], 'right');
s1.score = 10;
g.foods = [{ x: 6, y: 5, type: 'bomb', ttl: null }];
G.step(g, 0.1);
ok(s1.score === 0, '分数不会扣成负数');
ok(s1.body.length === 3, '最短保留 3 节');

console.log('14) 金果实：高分 + 限时消失');
g = mk({ rng: seedRng(24) });
s1 = g.snakes[0];
setBody(s1, [[5, 5], [4, 5], [3, 5]], 'right');
g.foods = [{ x: 6, y: 5, type: 'gold', ttl: null }];
G.step(g, 0.1);
ok(s1.score === 30, '金果实 +30（实际 ' + s1.score + '）');

g = mk({ rng: seedRng(25) });
setBody(g.snakes[0], [[5, 5], [4, 5], [3, 5]], 'up');
g.foods = [{ x: 15, y: 15, type: 'gold', ttl: 0.05 }];
G.step(g, 0.1);
ok(g.foods.every(function (f) { return !(f.x === 15 && f.y === 15); }), '金果实到期后消失');
ok(g.foods.length === 1, '消失后补上新果实');

/* ================= 障碍 ================= */

console.log('15) 静态障碍');
g = G.createGame({ obstacles: true, rng: seedRng(30) });
ok(g.obstacles.length === 6, '32×32 下 6 块障碍（实际 ' + g.obstacles.length + '）');
var mid = g.wall.x;
ok(g.obstacles.every(function (b) { return b.x + b.w <= mid || b.x >= mid; }), '没有障碍骑在围墙上');
var leftBlocks = g.obstacles.filter(function (b) { return b.x + b.w <= mid; });
var rightBlocks = g.obstacles.filter(function (b) { return b.x >= mid; });
ok(leftBlocks.length === rightBlocks.length, '左右数量相同');
var mirroredOk = leftBlocks.every(function (b) {
  return rightBlocks.some(function (m) {
    return m.x === g.cols - b.x - b.w && m.y === b.y && m.w === b.w && m.h === b.h;
  });
});
ok(mirroredOk, '右侧是左侧的镜像');

g = mk({ obstacles: true, rng: seedRng(31) });
var block = g.obstacles[0];
setBody(g.snakes[0], [[block.x - 1, block.y], [block.x - 2, block.y], [block.x - 3, block.y]], 'right');
g.foods = [];
G.step(g, 0.1);
ok(g.snakes[0].alive === false && g.snakes[0].cause === 'obstacle', '撞到障碍物判负');

g = mk({ obstacles: true, rng: seedRng(32) });
var inBlock = false;
for (var i = 0; i < g.foods.length; i++) {
  if (g.blocked[g.foods[i].x + ',' + g.foods[i].y]) inBlock = true;
}
ok(!inBlock, '果实不会生成在障碍里');

/* ================= 三局两胜 ================= */

console.log('16) 三局两胜');
var ms = G.createMatchState();
ok(ms.roundsToWin === 2, '先赢两局获胜');
ok(ms.wins[0] === 0 && ms.wins[1] === 0 && ms.round === 1, '初始 0:0 第 1 局');

G.recordRound(ms, 0);
ok(ms.wins[0] === 1 && ms.wins[1] === 0, 'P1 拿下一局');
ok(ms.over === false && ms.round === 2, '比赛继续，进入第 2 局');

G.recordRound(ms, 1);
ok(ms.wins[0] === 1 && ms.wins[1] === 1, 'P2 扳平');
ok(ms.over === false, '1:1 时继续');

G.recordRound(ms, 0);
ok(ms.over === true && ms.champion === 0, 'P1 2:1 赢下比赛');

var ms2 = G.createMatchState();
G.recordRound(ms2, null);
ok(ms2.wins[0] === 0 && ms2.wins[1] === 0, '平局不计分');
ok(ms2.round === 2, '平局也算过了一局');

/* ================= 回归 ================= */

console.log('17) 单人穿墙仍然有效');
g = mk({ wrap: true, rng: seedRng(40) });
setBody(g.snakes[0], [[0, 5], [1, 5], [2, 5]], 'left');
g.foods = [{ x: 10, y: 10, type: 'normal', ttl: null }];
G.step(g, 0.1);
ok(g.snakes[0].alive === true, '开穿墙不撞死');
ok(g.snakes[0].body[0].x === 19, '从左边界穿到右边');

console.log('18) 围墙时长自定义');
g = mk({ mode: 'duel', wallSeconds: 10, rng: seedRng(41) });
ok(g.wall.total === 10 && g.wall.remaining === 10, '可指定 10 秒');
g = mk({ mode: 'duel', wallSeconds: 0, rng: seedRng(42) });
ok(g.wall.active === false, '设为 0 时开局无墙');
setBody(g.snakes[0], [[9, 5], [8, 5], [7, 5]], 'right');
setBody(g.snakes[1], [[17, 12], [18, 12], [19, 12]], 'down');
g.foods = [];
G.step(g, 0.1);
ok(g.snakes[0].alive === true && g.snakes[0].body[0].x === 10, '无墙时可以穿过中线');

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
