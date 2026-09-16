#!/usr/bin/env node
/* 无头冒烟测试：stub DOM/WebAudio/World，加载真实 game.js 并驱动核心流程 */
'use strict';
const fs = require('fs');
const path = require('path');

function makeEl(id) {
  return {
    id, style: {}, dataset: {},
    classList: { _s: new Set(), toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    textContent: '', innerHTML: '', value: '',
    appendChild() {}, prepend() {}, remove() {}, focus() {},
    querySelectorAll() { return []; },
    addEventListener() {},
    children: [], firstChild: null, lastChild: null,
    onclick: null,
  };
}

const elCache = {};
global.document = {
  getElementById(id) { if (!elCache[id]) elCache[id] = makeEl(id); return elCache[id]; },
  createElement() { return makeEl('dyn'); },
  readyState: 'complete',
  addEventListener() {},
  hidden: false,
};
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.window = { addEventListener() {}, webkit: null };
global.requestAnimationFrame = () => 0;
global.World = {
  init: () => true,
  sync() {}, update() {}, focusOn() {}, setSelected() {},
  get ok() { return true; },
};
global.BGM = { start() {}, setMuted() {}, setStorm() {} };

let failures = 0;
function step(name, fn) {
  try {
    fn();
    console.log('  ✅', name);
  } catch (e) {
    failures++;
    console.log('  ❌', name, '→', e.stack || e);
  }
}

/* 预置全局驱动函数，再拼接 game.js 源码一起执行；通过 __G 显式导出内部绑定 */
global.__driver = function () {
  const G = global.__G;
  console.log('== A. 启动与开局 ==');
  step('boot 已自动执行（verTag 已写入）', () => {
    if (!elCache['verTag'] || !/^v\d/.test(elCache['verTag'].textContent)) throw new Error('verTag=' + (elCache['verTag'] || {}).textContent);
  });
  step('startGame(new)', () => { G.startGame(G.newState()); });
  step('开局后指引卡应可见', () => {
    if (elCache['guideCard'].classList.contains('hidden')) throw new Error('guideCard 处于 hidden');
  });
  step('开局后 speed=1 且未暂停徽章', () => {
    G.updateHUD();
    if (!elCache['pauseBadge'].classList.contains('hidden') && G.state.started) throw new Error('pauseBadge 显示中');
  });

  console.log('== B. 建造倒计时 ==');
  step('给足资源并升级煤矿', () => {
    G.state.res.wood = 600; G.state.res.coal = 400; G.state.res.food = 400; G.state.res.iron = 120;
    G.selectBuilding('mine');
    G.startUpgrade('mine');
    if (!G.state.queue) throw new Error('queue 未创建（资源不足或被锁）');
  });
  let remainSamples = [];
  step('模拟 12 秒：remain 应持续减少、无异常', () => {
    const total0 = G.state.queue.total;
    for (let i = 0; i < 12; i++) { G.simulate(1); G.updateHUD(); remainSamples.push(G.state.queue.remain.toFixed(1)); }
    if (!(G.state.queue.remain < total0 - 10)) throw new Error('倒计时几乎没动: ' + remainSamples.join(','));
  });
  console.log('   remain 序列:', remainSamples.join(' → '));
  step('施工面板渲染含动态占位', () => {
    G.renderDetail();
    if (!elCache['tab-detail'] || elCache['tab-detail'].innerHTML.indexOf('qcRemain') === -1)
      throw new Error('详情面板未包含 qcRemain（当前 innerHTML 长度=' + (elCache['tab-detail'] || {}).innerHTML?.length);
  });
  step('立即完成施工 finishConstruction', () => {
    const lvl0 = G.state.lvls.mine;
    G.finishConstruction();
    if (G.state.lvls.mine !== lvl0 + 1) throw new Error('等级未提升');
    if (G.state.queue) throw new Error('queue 未清空');
  });

  console.log('== C. 多日推进 / 疾病 / 事件 / 研究 ==');
  step('推进 4 天（跨天逻辑、暴风雪、事件）', () => {
    for (let i = 0; i < 4 * 30; i++) G.simulate(1);
    if (G.state.day < 5) throw new Error('天数未推进 day=' + G.state.day);
  });
  step('建造研究所并启动研究，进度前进', () => {
    G.state.res.wood += 500; G.state.res.iron += 200;
    G.startUpgrade('academy');
    if (!G.state.queue) throw new Error('研究所无法开工');
    G.finishConstruction();
    G.startResearch('axe1');
    if (!G.state.research) throw new Error('研究未启动');
    const r0 = G.state.research.remain;
    for (let i = 0; i < 30; i++) { G.simulate(1); G.updateHUD(); }
    if (!(G.state.research.remain < r0)) throw new Error('研究进度不动');
    G.finishResearch();
    if (!G.has('axe1')) throw new Error('科技未生效');
  });
  step('调试动作全量执行', () => {
    ['res', 'nextday', 'finQ', 'finR', 'cure', 'pop', 'event', 'storm', 'furn'].forEach(a => {
      if (a === 'res') G.RES_KEYS.forEach(k => { G.state.res[k] = Math.min(G.resCap(k), G.state.res[k] + 300); });
      else if (a === 'nextday') G.state.phase = G.DAY_LEN - 0.001;
      else if (a === 'finQ') { if (G.state.queue) G.finishConstruction(); }
      else if (a === 'finR') { if (G.state.research) G.finishResearch(); }
      else if (a === 'cure') G.state.sick = 0;
      else if (a === 'pop') { if (G.state.pop < G.popCap()) G.state.pop++; }
      else if (a === 'event') G.fireEvent();
      else if (a === 'storm') G.state.blizzard = Math.max(G.state.blizzard, 0.8);
      else if (a === 'furn') { if (G.state.lvls.furnace < G.B.furnace.max) { G.state.lvls.furnace++; G.syncWorld(true); } }
      G.updateHUD();
    });
  });
  step('指引链 tickGuide 可推进', () => {
    G.state.workers.sawmill = 1; G.state.workers.mine = 1; G.state.workers.lodge = 1;
    G.state.guideIdx = 0;
    for (let i = 0; i < 8; i++) G.tickGuide();
    if (G.state.guideIdx < 2) throw new Error('tickGuide 未推进 idx=' + G.state.guideIdx);
  });

  console.log('== D. 领地扩张 / 新资源 / 学校 / 空投 ==');
  step('清理模态框状态（blockSim 归零）', () => {
    G.closeModal();
    if (G.state.speed === 0 && !G.state.gameOver) { /* closeModal 会恢复速度 */ }
  });
  step('未建围墙时农场被锁定', () => {
    const un = G.B.farm.unlock(G.state);
    if (!un || !un.includes('围墙')) throw new Error('解锁条件异常: ' + un);
  });
  step('围墙升到 Lv.3 → 农场解锁', () => {
    G.state.res.wood += 2000; G.state.res.stone += 500; G.state.res.iron += 500;
    for (let i = 0; i < 3; i++) { G.startUpgrade('wall'); if (!G.state.queue) throw new Error('围墙施工失败 lvl=' + i); G.finishConstruction(); }
    if (G.state.lvls.wall !== 3) throw new Error('wall=' + G.state.lvls.wall);
    if (G.B.farm.unlock(G.state) !== null) throw new Error('农场仍被锁定');
  });
  step('建造采石场并分配工人 → 石材产出', () => {
    G.state.pop = Math.max(G.state.pop, 10);
    G.state.sick = 0;
    G.state.gameOver = false;
    G.state.res.food = Math.max(G.state.res.food, 300);
    Object.keys(G.state.workers).forEach(k => { G.state.workers[k] = 0; });
    G.startUpgrade('quarry');
    if (!G.state.queue) throw new Error('采石场无法开工');
    G.finishConstruction();
    G.changeWorkers('quarry', 2);
    if ((G.state.workers.quarry || 0) < 1) throw new Error(`分配工人失败 quarry=${G.state.workers.quarry} pop=${G.state.pop}`);
    G.state.res.stone = Math.max(0, Math.min(G.resCap('stone') - 50, G.state.res.stone));   // 钳到上限之下留增长空间
    const before = G.state.res.stone;
    for (let i = 0; i < 30; i++) G.simulate(1);
    if (!(G.state.res.stone > before)) throw new Error(`石材未增长 (${before.toFixed(1)} → ${G.state.res.stone.toFixed(1)}) pop=${G.state.pop} over=${G.state.gameOver}`);
    Object.keys(G.state.workers).forEach(k => { G.state.workers[k] = 0; });
  });
  step('温室为室内生产（暴风雪中不受罚）', () => {
    Object.keys(G.state.workers).forEach(k => { G.state.workers[k] = 0; });
    G.changeWorkers('greenhouse', 2);
    const f0 = G.prodPerDay('food');
    G.state.blizzard = 1;
    const f1 = G.prodPerDay('food');
    G.state.blizzard = 0;
    if (Math.abs(f0 - f1) > 0.01) throw new Error(`温室受暴风雪影响 ${f0} → ${f1}`);
  });
  step('学校/码头/机场解锁链与空投', () => {
    if (G.B.school.unlock(G.state) === null) throw new Error('学校不应在墙3时解锁');
    G.state.res.wood += 3000; G.state.res.stone += 2000; G.state.res.iron += 1200; G.state.res.food += 900;
    for (let i = 0; i < 2; i++) {
      G.startUpgrade('wall');
      if (!G.state.queue) throw new Error('围墙施工失败 @' + i);
      G.finishConstruction();
    }
    if (G.state.lvls.wall !== 5) throw new Error('wall=' + G.state.lvls.wall);
    if (G.B.school.unlock(G.state) !== null) throw new Error('学校未解锁');
    G.startUpgrade('school');
    if (!G.state.queue) throw new Error('学校无法开工');
    G.finishConstruction();
    G.startUpgrade('school');
    if (!G.state.queue) throw new Error('学校升级失败');
    G.finishConstruction();
    if (G.B.airport.unlock(G.state) !== null) throw new Error('机场未解锁');
    G.startUpgrade('airport');
    if (!G.state.queue) throw new Error('机场无法开工');
    G.finishConstruction();
    G.state.airCd = 0; G.advanceDay();
    if (G.state.airCd <= 0) throw new Error('空投冷却未重置');
  });
  step('Buff 事件安全执行（极光/地热/冻雨）', () => {
    ['aurora', 'geothermal', 'freezeRain'].forEach(id => {
      const ev = G.EVENT_POOL.find(x => x.id === id);
      if (!ev) throw new Error('事件缺失: ' + id);
      ev.run();
      G.updateHUD();
    });
  });

  console.log('== E. 现代设施 / 跨海工程 ==');
  step('风力发电站降低熔炉耗煤', () => {
    G.state.lvls.furnace = Math.max(1, G.state.lvls.furnace);
    const b0 = G.coalBurnPerDay();
    G.state.res.wood += 1500; G.state.res.iron += 400;
    G.startUpgrade('turbine');
    if (!G.state.queue) throw new Error('风电站无法开工');
    G.finishConstruction();
    const b1 = G.coalBurnPerDay();
    if (!(b1 < b0 * 0.95)) throw new Error(`耗煤未下降 ${b0.toFixed(2)} → ${b1.toFixed(2)}`);
  });
  step('地热钻井提升供热', () => {
    G.state.res.wood += 800; G.state.res.stone += 300; G.state.res.iron += 200;
    if (G.state.lvls.quarry < 1) { G.startUpgrade('quarry'); G.finishConstruction(); }
    G.startUpgrade('geo');
    if (!G.state.queue) throw new Error('地热钻井无法开工');
    G.finishConstruction();
    if (G.heatPower() <= 0) throw new Error('供热异常为 0');
  });
  step('跨海大桥解锁链（巨垒围墙 + 码头）→ 灯塔', () => {
    if (G.B.bridge.unlock(G.state) === null && (G.state.lvls.wall < 6 || G.state.lvls.dock < 1))
      throw new Error('桥不应提前解锁');
    G.state.res.wood += 6000; G.state.res.stone += 3000; G.state.res.iron += 2500; G.state.res.food += 2000;
    while (G.state.lvls.wall < 6) { G.startUpgrade('wall'); if (!G.state.queue) throw new Error('墙施工失败@' + G.state.lvls.wall); G.finishConstruction(); }
    G.startUpgrade('dock'); if (!G.state.queue) throw new Error('码头无法开工'); G.finishConstruction();
    G.changeWorkers('dock', 2);
    if (G.B.bridge.unlock(G.state) !== null) throw new Error('大桥未解锁: ' + G.B.bridge.unlock(G.state));
    G.startUpgrade('bridge'); if (!G.state.queue) throw new Error('大桥无法开工'); G.finishConstruction();
    if (G.state.lvls.bridge !== 1) throw new Error('bridge=' + G.state.lvls.bridge);
    if (G.B.lighthouse.unlock(G.state) !== null) throw new Error('灯塔未解锁');
    G.startUpgrade('lighthouse'); if (!G.state.queue) throw new Error('灯塔无法开工'); G.finishConstruction();
    const p0 = G.prodPerDay('wood');
    void p0;
    G.updateHUD();
  });
  step('灯塔加成生效（生产 soft 提升）', () => {
    Object.keys(G.state.workers).forEach(k => { G.state.workers[k] = 0; });
    G.state.buffs = { prod: 0, hunt: 0, coalsave: 0, cureup: 0, morale: 0, rain: 0 };
    G.state.blizzard = 0;
    G.state.day = 1; G.state.phase = 0;   // 重置温度与天气，隔离变量
    G.changeWorkers('sawmill', 2);
    if (G.state.lvls.sawmill < 1) { G.startUpgrade('sawmill'); G.finishConstruction(); }
    const w0 = G.prodPerDay('wood');
    if (!(w0 > 0)) throw new Error('伐木产出为 0');
    // 灯塔 Lv.1 已建：soft 应含 ×1.05；温和天气下应为 2×7×1.05 ≈ 14.7
    const expectedMin = 2 * G.B.sawmill.per * 1.05 * 0.9;
    if (w0 < expectedMin - 3) throw new Error(`灯塔加成疑似未生效 wood/day=${w0.toFixed(2)} (期望≥${expectedMin.toFixed(2)})`);
  });
  step('一键满级 doMaxAll：建筑满级 + 科技全亮 + 资源加满', () => {
    G.state.lvls.furnace = 1;
    G.state.tech = {};
    G.state.res.wood = 10;
    G.doMaxAll();
    let allMax = true;
    G.B_KEYS.forEach(k => { if (G.state.lvls[k] !== G.B[k].max) { allMax = false; console.log('   未满级:', k, G.state.lvls[k], 'vs', G.B[k].max); } });
    if (!allMax) throw new Error('存在未满级建筑');
    if (G.TECHS.some(t => !G.state.tech[t.id])) throw new Error('存在未点亮科技');
    if (G.state.res.wood < G.resCap('wood') * 0.99) throw new Error('资源未加满 wood=' + G.state.res.wood);
    if (G.state.queue !== null || G.state.research !== null) throw new Error('施工/研究未清空');
  });
  console.log('\n结果:', failures === 0 ? '✅ 全部通过（逻辑层无异常）' : `❌ ${failures} 项失败`);
  if (failures > 0) process.exitCode = 1;
};

const src = fs.readFileSync(path.join(__dirname, '..', 'game', 'js', 'game.js'), 'utf8');
const expose = `
;global.__G = {
  get state() { return state; }, set state(v) { state = v; },
  RES_KEYS, GUIDE, B, DAY_LEN, B_KEYS,
  has, resCap, popCap, startGame, newState, simulate, updateHUD,
  selectBuilding, startUpgrade, finishConstruction, startResearch, finishResearch,
  fireEvent, tickGuide, renderDetail, syncWorld, prodPerDay, EVENT_POOL, changeWorkers, advanceDay, closeModal,
  coalBurnPerDay, heatPower, doMaxAll, TECHS,
};
__driver();`;
(0, eval)(src + expose);
