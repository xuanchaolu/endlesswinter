/* ============================================================
 * 无尽冬日 · 游戏逻辑与 UI
 * 生存模拟：资源/温度/疾病/暴风雪/事件/研究/建造
 * ============================================================ */
'use strict';

const VERSION = 'v2.6.2';   // 海域修复+城门对桥

/* 早期错误上报：任何 JS 异常通过原生桥输出到系统日志，便于诊断 */
(function () {
  function report(msg) {
    try {
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.bridge)
        window.webkit.messageHandlers.bridge.postMessage(JSON.stringify(Object.assign({ type: 'jsError' }, msg)));
      else console.error('[JS]', JSON.stringify(msg));
    } catch (_) {}
  }
  window.addEventListener('error', function (e) {
    report({ msg: String((e && e.message) || (e && e.error) || 'unknown'),
             src: String((e && e.filename) || '').split('/').pop(), line: (e && e.lineno) || 0 });
  });
  window.addEventListener('unhandledrejection', function (e) {
    report({ msg: 'Promise: ' + String((e && e.reason) || 'unknown'), src: '', line: 0 });
  });
})();

/* ================= 基础数据 ================= */
const DAY_LEN = 30;                 // 一天的现实秒数（1x）
const RES_KEYS = ['wood', 'coal', 'food', 'iron', 'stone'];
const R_META = {
  wood: { name: '木材', icon: '🪵' },
  coal: { name: '煤炭', icon: '🪨' },
  food: { name: '食物', icon: '🍖' },
  iron: { name: '铁锭', icon: '🔩' },
  stone: { name: '石材', icon: '🧱' },
};
const B_KEYS = ['wall', 'furnace', 'shelter', 'sawmill', 'mine', 'lodge', 'ironmine', 'warehouse', 'infirmary', 'academy',
  'farm', 'greenhouse', 'garden', 'quarry', 'workshop', 'school', 'dock', 'airport',
  'turbine', 'radio', 'geo', 'bridge', 'lighthouse', 'heatStation'];
const PRODUCERS = ['sawmill', 'mine', 'lodge', 'ironmine', 'farm', 'greenhouse', 'quarry', 'dock'];

function r(base, f, k) { return Math.round(base * Math.pow(f, Math.max(0, k))); }

const B = {
  wall: {
    name: '围墙', icon: '🧱', max: 6,
    desc: '家园的边界。Lv.1-2 为木栅栏；Lv.3 升级为石墙并开拓外环土地（农场/温室/花圃/采石场/工坊）；Lv.5 筑成城墙，解锁远郊（学校/码头/机场）。每级还能为熔炉挡风：供热效果 +4%。',
    unlock: () => null,
    cost: l => l === 0 ? { wood: 120 } : { wood: r(90, 1.45, l - 1), stone: l >= 3 ? r(60, 1.5, l - 3) : 0 },
    time: l => 16 + 8 * l,
    territory: l => l >= 5 ? '城墙 · 远郊已开拓' : l >= 3 ? '石墙 · 外环已开拓' : l >= 1 ? '木栅栏' : '—',
  },
  furnace: {
    name: '熔炉', icon: '🔥', max: 10,
    desc: '家园的心脏。持续燃烧煤炭为居民供暖，等级越高供热量越大。一旦熄灭，寒冬将吞噬一切。',
    unlock: () => null,
    cost: l => ({ wood: r(60, 1.75, l - 1), iron: l >= 3 ? r(20, 1.6, l - 3) : 0 }),
    time: l => 14 + 9 * l,
  },
  shelter: {
    name: '居民区', icon: '🏠', max: 10,
    desc: '幸存者的居所。每级容纳更多居民：人口上限 4 + 2×等级。',
    cap: l => 4 + 2 * l,
    unlock: () => null,
    cost: l => ({ wood: r(45, 1.55, l) }),
    time: l => 10 + 5 * l,
  },
  sawmill: {
    name: '伐木场', icon: '🪵', max: 8,
    desc: '砍伐寒带林木。每名工人每天产出 7 木材，岗位 2×等级。',
    slots: l => 2 * l, outRes: 'wood', per: 7,
    unlock: () => null,
    cost: l => ({ wood: r(40, 1.5, l) }),
    time: l => 9 + 4 * l,
  },
  mine: {
    name: '煤矿', icon: '⛏️', max: 8,
    desc: '开采浅层煤。每名工人每天产出 6 煤炭，是熔炉的命脉。',
    slots: l => 2 * l, outRes: 'coal', per: 6,
    unlock: () => null,
    cost: l => ({ wood: r(50, 1.5, l), iron: l >= 4 ? r(10, 1.5, l - 4) : 0 }),
    time: l => 11 + 5 * l,
  },
  lodge: {
    name: '猎人小屋', icon: '🏹', max: 8,
    desc: '冰原狩猎与采集。每名工人每天产出 6 食物，喂饱整个家园。',
    slots: l => 2 * l, outRes: 'food', per: 6,
    unlock: () => null,
    cost: l => ({ wood: r(35, 1.5, l) }),
    time: l => 9 + 4 * l,
  },
  ironmine: {
    name: '铁矿场', icon: '🔩', max: 6,
    desc: '开采冻土下的铁矿，用于高级建造与研究。每名工人每天 3 铁锭。',
    slots: l => 2 * l, outRes: 'iron', per: 3,
    unlock: st => st.lvls.furnace >= 3 ? null : '需要熔炉达到 3 级',
    cost: l => ({ wood: l === 0 ? 90 : r(70, 1.5, l), iron: l === 0 ? 0 : r(15, 1.5, l - 1) }),
    time: l => 15 + 7 * l,
  },
  warehouse: {
    name: '仓库', icon: '📦', max: 8,
    desc: '扩容储备。每级使所有资源储存上限 +450。',
    unlock: () => null,
    cost: l => ({ wood: r(60, 1.55, l) }),
    time: l => 9 + 4 * l,
  },
  infirmary: {
    name: '医务室', icon: '⚕️', max: 6,
    desc: '救治患病居民。每级提供 2 张病床，病床上的患者每天有较大概率痊愈。',
    beds: l => 2 * l,
    unlock: st => st.lvls.shelter >= 3 ? null : '需要居民区达到 3 级',
    cost: l => ({ wood: r(80, 1.55, l), iron: l >= 2 ? r(10, 1.5, l - 2) : 0 }),
    time: l => 13 + 5 * l,
  },
  academy: {
    name: '研究所', icon: '🔬', max: 4,
    desc: '解锁科技研究。等级越高研究速度越快（每级 +25%）。学校每级再 +10% 研究速度。',
    unlock: st => st.day >= 4 || st.lvls.furnace >= 3 ? null : '第 4 天后解锁',
    cost: l => ({ wood: l === 0 ? 120 : r(90, 1.6, l), iron: l === 0 ? 15 : r(25, 1.5, l - 1) }),
    time: l => 18 + 8 * l,
  },
  farm: {
    name: '农场', icon: '🌾', max: 8,
    desc: '外环·冻土农田。每名工人每天产出 9 食物，是比狩猎更稳定的口粮来源。',
    slots: l => 2 * l, outRes: 'food', per: 9,
    unlock: st => st.lvls.wall >= 3 ? null : '需要围墙达到 3 级（开拓外环）',
    cost: l => ({ wood: l === 0 ? 110 : r(70, 1.5, l), iron: l >= 3 ? r(12, 1.5, l - 3) : 0 }),
    time: l => 14 + 5 * l,
  },
  greenhouse: {
    name: '温室', icon: '🍅', max: 6,
    desc: '室内水培种植：每名工人每天产出 8 食物，且完全不受严寒与暴风雪影响。',
    slots: l => 2 * l, outRes: 'food', per: 8, indoor: true,
    unlock: st => st.lvls.wall >= 3 ? null : '需要围墙达到 3 级（开拓外环）',
    cost: l => ({ wood: l === 0 ? 140 : r(80, 1.5, l), iron: l === 0 ? 25 : r(18, 1.5, l - 1), stone: l >= 2 ? r(20, 1.5, l - 2) : 0 }),
    time: l => 18 + 6 * l,
  },
  garden: {
    name: '花圃', icon: '🌷', max: 4,
    desc: '冰原上的一抹春色。安抚人心：全体居民患病几率每级 -12%（无需工人）。',
    unlock: st => st.lvls.wall >= 3 ? null : '需要围墙达到 3 级（开拓外环）',
    cost: l => ({ wood: r(60, 1.45, l), stone: l >= 2 ? r(15, 1.5, l - 2) : 0 }),
    time: l => 10 + 4 * l,
  },
  quarry: {
    name: '采石场', icon: '🗻', max: 6,
    desc: '开采花岗岩。每名工人每天产出 3 石材，是石墙与大型建筑的原料。',
    slots: l => 2 * l, outRes: 'stone', per: 3,
    unlock: st => st.lvls.wall >= 3 ? null : '需要围墙达到 3 级（开拓外环）',
    cost: l => ({ wood: l === 0 ? 130 : r(75, 1.5, l), iron: l === 0 ? 20 : r(15, 1.5, l - 1) }),
    time: l => 16 + 6 * l,
  },
  workshop: {
    name: '工坊', icon: '🔧', max: 5,
    desc: '打造工具与机械，全体生产效率每级 +6%（无需工人）。',
    unlock: st => st.lvls.wall >= 3 ? null : '需要围墙达到 3 级（开拓外环）',
    cost: l => ({ wood: r(120, 1.5, l), iron: l === 0 ? 30 : r(25, 1.5, l - 1), stone: l >= 2 ? r(30, 1.5, l - 2) : 0 }),
    time: l => 16 + 7 * l,
  },
  school: {
    name: '学校', icon: '🏫', max: 5,
    desc: '让幸存者成为学者：每级提供 3 个教育名额，并使研究速度 +10%。码头、机场等高级场所需要受过教育的居民。',
    eduCap: l => 3 * l,
    unlock: st => st.lvls.wall >= 5 ? null : '需要城墙达到 5 级（开拓远郊）',
    cost: l => ({ wood: r(160, 1.5, l), iron: l === 0 ? 40 : r(30, 1.5, l - 1), stone: l === 0 ? 60 : r(40, 1.5, l - 1) }),
    time: l => 20 + 8 * l,
  },
  dock: {
    name: '码头', icon: '⚓', max: 6,
    desc: '冰海渔港：栈桥伸入封冻的大海，每名工人每天凿冰捕鱼 6 食物、打捞沉船遗物 1.5 铁锭。需要学校。',
    slots: l => 2 * l, outRes: 'food', per: 6, secOut: 'iron', secPer: 1.5,
    unlock: st => (st.lvls.wall >= 5 ? (st.lvls.school >= 1 ? null : '需要学校（受教育居民）') : '需要城墙达到 5 级（开拓远郊）'),
    cost: l => ({ wood: l === 0 ? 180 : r(90, 1.5, l), iron: l === 0 ? 35 : r(25, 1.5, l - 1), stone: l >= 1 ? r(30, 1.5, l - 1) : 0 }),
    time: l => 20 + 7 * l,
  },
  airport: {
    name: '机场', icon: '✈️', max: 3,
    desc: '远征者的骄傲。定期有补给航班空投物资（间隔随等级缩短，数量随等级增长）。需要学校 Lv.2。',
    unlock: st => (st.lvls.wall >= 5 ? (st.lvls.school >= 2 ? null : '需要学校达到 2 级') : '需要城墙达到 5 级（开拓远郊）'),
    cost: l => ({ wood: r(260, 1.55, l), iron: l === 0 ? 80 : r(60, 1.5, l - 1), stone: l === 0 ? 120 : r(70, 1.5, l - 1) }),
    time: l => 26 + 10 * l,
  },
  turbine: {
    name: '风力发电站', icon: '⚡', max: 5,
    desc: '现代设施：巨大的风机阵列为熔炉辅助供电，耗煤每级 -6%（无需工人）。',
    unlock: st => st.lvls.wall >= 3 ? null : '需要围墙达到 3 级',
    cost: l => ({ wood: r(140, 1.5, l), iron: l === 0 ? 35 : r(28, 1.5, l - 1) }),
    time: l => 15 + 6 * l,
  },
  radio: {
    name: '通讯塔', icon: '📡', max: 3,
    desc: '现代设施：全天候气象广播与心理支持热线，居民患病几率每级 -8%。',
    unlock: st => st.lvls.wall >= 3 ? null : '需要围墙达到 3 级',
    cost: l => ({ wood: r(120, 1.5, l), iron: l === 0 ? 40 : r(30, 1.5, l - 1), stone: l >= 1 ? r(20, 1.5, l - 1) : 0 }),
    time: l => 14 + 5 * l,
  },
  geo: {
    name: '地热钻井', icon: '♨️', max: 4,
    desc: '现代设施：钻探冻土之下的地热田，为供暖管网直接增温 —— 供热效果每级 +6%。需要采石场。',
    unlock: st => (st.lvls.wall >= 3 ? (st.lvls.quarry >= 1 ? null : '需要采石场') : '需要围墙达到 3 级'),
    cost: l => ({ wood: r(150, 1.5, l), iron: l === 0 ? 45 : r(32, 1.5, l - 1), stone: l === 0 ? 50 : r(36, 1.5, l - 1) }),
    time: l => 16 + 6 * l,
  },
  bridge: {
    name: '跨海大桥', icon: '🌉', max: 1,
    desc: '工程奇迹：跨越冰海直抵神秘小岛。建成后可在岛上建造灯塔。需要巨垒级围墙（Lv.6）与码头。',
    unlock: st => (st.lvls.wall >= 6 ? (st.lvls.dock >= 1 ? null : '需要码头') : '需要巨垒级围墙（Lv.6）'),
    cost: () => ({ wood: 900, stone: 550, iron: 260 }),
    time: () => 55,
  },
  lighthouse: {
    name: '灯塔', icon: '🗼', max: 3,
    desc: '岛上的希望之光：旋转光束指引航路，全体生产每级 +5%，随机事件间隔每级 +0.4 天。需要跨海大桥。',
    unlock: st => (st.lvls.bridge >= 1 ? null : '需要跨海大桥'),
    cost: l => ({ wood: r(220, 1.5, l), iron: r(70, 1.4, l), stone: r(160, 1.45, l) }),
    time: l => 24 + 8 * l,
  },
  heatStation: {
    name: '供暖站', icon: '🌡️', max: 4,
    desc: '石墙时代的标配：沿城墙分布的供暖岗楼，把热水送进千家万户 —— 寒冷时段室外作业惩罚每级减轻，夜间室内目标温度 +0.8°/级。需要石墙（围墙 Lv.3）。',
    unlock: st => st.lvls.wall >= 3 ? null : '需要石墙（围墙 Lv.3）',
    cost: l => ({ wood: r(130, 1.45, l), stone: l === 0 ? 60 : r(45, 1.5, l - 1), iron: l >= 2 ? r(20, 1.5, l - 2) : 0 }),
    time: l => 14 + 5 * l,
  },
};

const TECHS = [
  { id: 'axe1', name: '精钢斧刃', desc: '伐木效率 +15%', cost: { wood: 110, iron: 5 }, days: 1.2 },
  { id: 'axe2', name: '双人拉锯', desc: '伐木效率再 +20%', req: 'axe1', cost: { wood: 240, iron: 30 }, days: 2.2 },
  { id: 'coal1', name: '坑道支护', desc: '采煤效率 +15%', cost: { wood: 120, iron: 8 }, days: 1.4 },
  { id: 'coal2', name: '深井开采', desc: '采煤效率再 +20%', req: 'coal1', cost: { wood: 260, iron: 40 }, days: 2.4 },
  { id: 'hunt1', name: '陷阱网具', desc: '食物获取 +15%', cost: { wood: 100 }, days: 1.2 },
  { id: 'hunt2', name: '雪地围猎', desc: '食物获取再 +20%', req: 'hunt1', cost: { wood: 220, food: 80 }, days: 2.2 },
  { id: 'drill', name: '淬火钻头', desc: '铁矿石开采 +30%', cost: { wood: 180, iron: 20 }, days: 1.8 },
  { id: 'warm', name: '絮絮冬衣', desc: '熔炉供热效果 +25%', cost: { wood: 150, food: 60 }, days: 1.6 },
  { id: 'med', name: '战地医术', desc: '治愈率大幅提升，病亡率减半', cost: { wood: 200, iron: 25 }, days: 2 },
  { id: 'store', name: '高架仓储', desc: '所有资源上限 +250', cost: { wood: 260 }, days: 1.8 },
  { id: 'tents', name: '双层帐壁', desc: '居住上限 +4', cost: { wood: 200, iron: 10 }, days: 1.5 },
  { id: 'steam', name: '蒸汽机关', desc: '全部生产 +10%（需要坑道支护）', req: 'coal1', cost: { wood: 320, iron: 60 }, days: 3 },
];

const INTENSITIES = [
  { v: 0.55, label: '小火' },
  { v: 1.0, label: '标准' },
  { v: 1.55, label: '全功率' },
];
const RATIONS = [
  { v: 1.3, label: '充足配给' },
  { v: 1.0, label: '标准配给' },
  { v: 0.7, label: '节约口粮' },
];

/* ================= 新手目标指引 ================= */
const GUIDE = [
  { text: '为伐木场、煤矿、猎人小屋分配工人：点击场景中的建筑（或底部图标），按 ＋ 增派人手',
    check: () => state.workers.sawmill > 0 && state.workers.mine > 0 && state.workers.lodge > 0 },
  { text: '升级 🔥 熔炉至 Lv.2：夜晚会越来越冷，供热必须跟上',
    check: () => state.lvls.furnace >= 2, rw: { wood: 40 } },
  { text: '升级 🏠 居民区至 Lv.2：人口上限提升后，会有新幸存者加入',
    check: () => state.lvls.shelter >= 2, rw: { food: 40 } },
  { text: '储备过冬物资：让木材 ≥140 且煤炭 ≥100（暴风雪时耗煤激增）',
    check: () => state.res.wood >= 140 && state.res.coal >= 100 },
  { text: '第 4 天后建造 🔬 研究所，解锁科技研究',
    check: () => state.lvls.academy >= 1, rw: { iron: 15 } },
  { text: '在研究所启动任意一项研究',
    check: () => !!state.research || Object.keys(state.tech).length > 0 },
  { text: '把居民区升至 Lv.3 后建造 ⚕️ 医务室，抵御疾病',
    check: () => state.lvls.infirmary >= 1 },
  { text: '存活到第 6 天 —— 之后，风雪就是你的日常',
    check: () => state.day >= 6 },
];
function guideCurrent() { return state.guideIdx < GUIDE.length ? GUIDE[state.guideIdx] : null; }
function renderGuide() {
  const g = guideCurrent();
  if (!g || state.guideDone || !state.started) { el.guideCard.classList.add('hidden'); return; }
  el.guideCard.classList.remove('hidden');
  el.gcStep.textContent = `目标 ${state.guideIdx + 1}/${GUIDE.length}`;
  el.gcText.textContent = g.text;
}
function tickGuide() {
  if (!state.started || state.gameOver || state.guideDone) return;
  const g = guideCurrent();
  if (!g || !g.check()) return;
  let rwTxt = '';
  if (g.rw) {
    Object.entries(g.rw).forEach(([k, v]) => { state.res[k] = Math.min(resCap(k), state.res[k] + v); });
    rwTxt = ' 奖励 ' + Object.entries(g.rw).map(([k, v]) => R_META[k].icon + '+' + v).join(' ');
  }
  addLog(`🎯 目标达成${rwTxt}`, 'good');
  toast(`🎯 目标达成！${rwTxt}`, 'good', 4200);
  SFX.tech();
  state.guideIdx++;
  if (state.guideIdx >= GUIDE.length) {
    state.guideDone = true;
    addLog('🎉 你已掌握生存的要领。祝你好运，领袖。', 'evt');
    toast('🎉 引导完成！接下来由你书写这座家园的命运', 'good', 5000);
  }
  renderGuide();
  doSave();
}

/* ================= 状态 ================= */
function newState() {
  return {
    ver: 1, started: false, gameOver: false,
    day: 1, phase: 6, speed: 1,
    res: { wood: 140, coal: 90, food: 110, iron: 0, stone: 0 },
    lvls: { wall: 0, furnace: 1, shelter: 1, sawmill: 1, mine: 1, lodge: 1, ironmine: 0, warehouse: 0, infirmary: 0, academy: 0,
      farm: 0, greenhouse: 0, garden: 0, quarry: 0, workshop: 0, school: 0, dock: 0, airport: 0,
      turbine: 0, radio: 0, geo: 0, bridge: 0, lighthouse: 0, heatStation: 0 },
    workers: { sawmill: 2, mine: 2, lodge: 2, ironmine: 0, farm: 0, greenhouse: 0, quarry: 0, dock: 0 },
    pop: 6, sick: 0, starving: false,
    furnIntIdx: 1, rationIdx: 1,
    tech: {}, research: null,          // {id, remain(天)}
    queue: null,                       // {key, toLvl, remain(秒), total(秒)}
    blizzard: 0, blizzWarned: false, boostMine: 0,
    buffs: { prod: 0, hunt: 0, coalsave: 0, cureup: 0, morale: 0, rain: 0 },
    airCd: 4, eventIn: 1.6, muted: false,
    guideIdx: 0, guideDone: false, warns: {},
    stats: { arrivals: 0, deaths: 0, built: 0, peakPop: 6 },
  };
}

let state = newState();
let selectedKey = null;
let blockSim = 0;            // 模态框暂停计数
let prevSpeedBeforeBlock = 1;
let blzVis = 0;
let saveTimer = 0, hudTimer = 0;
let pendingSaveJSON = null;
let logUnread = false, researchFlash = false;
let lastStormSent = -1;

/* ================= 存档桥接（原生 App 或浏览器 localStorage） ================= */
const IS_NATIVE = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.bridge);
const Native = {
  save(json) {
    try {
      if (IS_NATIVE) window.webkit.messageHandlers.bridge.postMessage(JSON.stringify({ type: 'save', payload: json }));
      else localStorage.setItem('ew_save_v1', json);
    } catch (e) { /* ignore */ }
  },
  notify(payload) {
    try {
      if (IS_NATIVE) window.webkit.messageHandlers.bridge.postMessage(JSON.stringify(payload));
    } catch (e) { /* ignore */ }
  },
  log(payload) { this.notify(payload); },
  requestLoad() {
    if (IS_NATIVE) window.webkit.messageHandlers.bridge.postMessage(JSON.stringify({ type: 'load' }));
    else setTimeout(() => onLoadResult(localStorage.getItem('ew_save_v1')), 60);
  },
};
window.NativeBridge = {
  _receive(json) { onLoadResult(json); },
};
function doSave() {
  if (!state.started || state.gameOver) return;
  Native.save(JSON.stringify(state));
}
function mergeState(parsed) {
  const s = newState();
  if (!parsed || typeof parsed !== 'object') return s;
  ['res', 'lvls', 'workers', 'stats', 'tech', 'buffs'].forEach(k => Object.assign(s[k], parsed[k] || {}));
  ['ver', 'started', 'gameOver', 'day', 'phase', 'speed', 'pop', 'sick', 'starving',
   'furnIntIdx', 'rationIdx', 'blizzard', 'boostMine', 'eventIn', 'muted',
   'guideIdx', 'guideDone', 'airCd'].forEach(k => {
    if (parsed[k] !== undefined) s[k] = parsed[k];
  });
  if (parsed.warns && typeof parsed.warns === 'object') Object.assign(s.warns, parsed.warns);
  if (parsed.research && parsed.research.id) s.research = parsed.research;
  if (parsed.queue && parsed.queue.key) s.queue = parsed.queue;
  s.gameOver = false; s.started = true;
  return s;
}
function onLoadResult(json) {
  if (json) {
    try {
      pendingSaveJSON = JSON.parse(json);
      Native.log({ type: 'jsLoaded' });   // 全链路送达证据（原生层打日志）
    } catch (e) {
      pendingSaveJSON = null;
      reportError(e, 'onLoadResult');
    }
  } else {
    pendingSaveJSON = null;
  }
  showStartModal();
}

/* ================= 音效（WebAudio 合成，无外部文件） ================= */
let actx = null;
function audio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  return actx;
}
function beep(freq, dur, delay, type, vol) {
  const c = audio(); if (!c || state.muted) return;
  const t0 = c.currentTime + (delay || 0);
  const o = c.createOscillator(), g = c.createGain();
  o.type = type || 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(vol || 0.05, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
}
const SFX = {
  click() { beep(660, 0.06, 0, 'triangle', 0.03); },
  build() { beep(392, 0.12, 0, 'triangle', 0.06); beep(523, 0.14, 0.1, 'triangle', 0.06); beep(659, 0.2, 0.22, 'triangle', 0.06); },
  event() { beep(880, 0.15, 0, 'sine', 0.05); beep(660, 0.2, 0.12, 'sine', 0.05); },
  bad() { beep(196, 0.3, 0, 'sawtooth', 0.045); beep(147, 0.4, 0.18, 'sawtooth', 0.045); },
  tech() { beep(523, 0.1, 0, 'sine', 0.05); beep(659, 0.1, 0.09, 'sine', 0.05); beep(784, 0.16, 0.18, 'sine', 0.05); beep(1047, 0.24, 0.28, 'sine', 0.05); },
  over() { beep(330, 0.5, 0, 'sine', 0.06); beep(262, 0.6, 0.4, 'sine', 0.06); beep(196, 0.9, 0.85, 'sine', 0.06); },
};

/* ================= 数值计算 ================= */
function has(id) { return !!state.tech[id]; }
function popCap() { return (B.shelter.cap(state.lvls.shelter) || 0) + (has('tents') ? 4 : 0); }
function resCap(res) {
  let c = 500 + 450 * (state.lvls.warehouse || 0);
  if (has('store')) c += 250;
  return c;
}
function slotsOf(k) { return B[k].slots ? B[k].slots(state.lvls[k]) : 0; }
function usedWorkers() { return PRODUCERS.reduce((s, k) => s + (state.workers[k] || 0), 0); }
function freePop() { return state.pop - usedWorkers(); }
function intensityMul() { return INTENSITIES[state.furnIntIdx].v; }
function rationMul() { return RATIONS[state.rationIdx].v; }

function outdoorTemp() {
  const p = state.phase / DAY_LEN;
  const base = Math.max(-65, -(5 + state.day * 0.75 + Math.max(0, state.day - 10) * 0.45));
  const nf = p > 0.6 ? (p - 0.6) / 0.4 : (p < 0.15 ? (0.15 - p) / 0.15 : 0);
  const wobble = Math.sin(state.day * 2.7) * 2.2;
  return base - 6 * nf + wobble - (state.blizzard > 0 ? 17 : 0);
}
function tonightTemp() {
  const base = Math.max(-65, -(5 + state.day * 0.75 + Math.max(0, state.day - 10) * 0.45));
  return Math.round(base - 6 + Math.sin(state.day * 2.7) * 2.2 - (state.blizzard > 0 ? 17 : 0));
}
function heatPower() {
  if (state.res.coal <= 0) return 0;
  return 14 * Math.sqrt(state.lvls.furnace) * intensityMul()
    * (has('warm') ? 1.25 : 1)
    * (1 + 0.04 * (state.lvls.wall || 0))    // 围墙挡风
    * (1 + 0.06 * (state.lvls.geo || 0));    // 地热钻井增温
}
function coalBurnPerDay() {
  let base = (3 + 2.2 * state.lvls.furnace) * intensityMul() * (state.blizzard > 0 ? 1.25 : 1);
  base *= (1 - 0.06 * (state.lvls.turbine || 0));   // 风电辅助供暖
  if (state.buffs && state.buffs.coalsave > 0) base *= 0.7;
  return Math.max(0.5, base);
}
function coldWorkMul(outT) {
  const relief = Math.min(0.24, 0.06 * (state.lvls.heatStation || 0));   // 供暖站减轻寒冷惩罚
  const m = outT < -35 ? 0.65 : outT < -22 ? 0.8 : 1;
  return m < 1 ? Math.min(1, m + relief) : m;
}

function prodPerDay(res) {
  const outT = outdoorTemp();
  let total = 0;
  const soft = (has('steam') ? 1.1 : 1)
    * (1 + 0.06 * (state.lvls.workshop || 0))
    * (1 + 0.05 * (state.lvls.lighthouse || 0))
    * (state.buffs && state.buffs.prod > 0 ? 1.1 : 1)
    * (state.starving ? 0.7 : 1)
    * (rationMul() < 1 ? 0.94 : 1);
  const outdoorPen = coldWorkMul(outT)
    * (state.blizzard > 0 ? 0.65 : 1)
    * (state.buffs && state.buffs.rain > 0 ? 0.75 : 1);
  const map = {
    wood: () => (has('axe1') ? 1.15 : 1) * (has('axe2') ? 1.2 : 1),
    coal: () => (has('coal1') ? 1.15 : 1) * (has('coal2') ? 1.2 : 1) * (state.boostMine > 0 ? 1.5 : 1),
    food: () => (has('hunt1') ? 1.15 : 1) * (has('hunt2') ? 1.2 : 1) * (state.buffs && state.buffs.hunt > 0 ? 1.3 : 1),
    iron: () => (has('drill') ? 1.3 : 1),
    stone: () => 1,
  };
  PRODUCERS.forEach(k => {
    const w = state.workers[k] || 0;
    if (w <= 0) return;
    const pen = B[k].indoor ? 1 : outdoorPen;
    if (B[k].outRes === res) total += w * B[k].per * map[res](k) * soft * pen;
    if (B[k].secOut === res) total += w * B[k].secPer * soft * pen;
  });
  return total;
}
function foodEatPerDay() { return state.pop * 1.2 * rationMul(); }
function netPerDay(res) {
  let v = prodPerDay(res);
  if (res === 'food') v -= foodEatPerDay();
  if (res === 'coal') v -= coalBurnPerDay();
  return v;
}

/* ================= 模拟主循环 ================= */
let indoorTemp = 8;

function simulate(gdt) {   // gdt: 游戏秒
  const prevDay = state.day;
  state.phase += gdt;
  while (state.phase >= DAY_LEN && !state.gameOver) { state.phase -= DAY_LEN; advanceDay(); }
  if (state.gameOver) return;

  /* 生产（连续结算，含石材） */
  RES_KEYS.forEach(res => {
    const cap = resCap(res);
    state.res[res] = Math.max(0, Math.min(cap, state.res[res] + prodPerDay(res) / DAY_LEN * gdt));
  });
  state.res.food = Math.max(0, Math.min(resCap('food'), state.res.food - foodEatPerDay() / DAY_LEN * gdt));
  const burn = Math.min(state.res.coal, coalBurnPerDay() / DAY_LEN * gdt);
  state.res.coal = Math.max(0, state.res.coal - burn);

  state.starving = state.res.food <= 0.01;

  /* 室内温度平滑趋近（供暖站夜间额外 +0.8°/级） */
  const isNight = (state.phase > DAY_LEN * 0.55 || state.phase < DAY_LEN * 0.12);
  const nightBonus = (isNight ? 1 : 0) * 0.8 * (state.lvls.heatStation || 0);
  const target = outdoorTemp() + heatPower() + nightBonus;
  indoorTemp += (target - indoorTemp) * Math.min(1, gdt * 0.35);

  /* 研究 */
  if (state.research) {
    state.research.remain -= gdt / DAY_LEN;
    if (state.research.remain <= 0) finishResearch();
  }
  /* 建造 */
  if (state.queue) {
    state.queue.remain -= gdt;
    if (state.queue.remain <= 0) finishConstruction();
  }

  state.eventIn -= gdt / DAY_LEN;
  if (state.eventIn <= 0) { fireEvent(); state.eventIn = 1.5 + Math.random() * 2.2 + 0.4 * (state.lvls.lighthouse || 0); }

  saveTimer += gdt;
  if (saveTimer > 8) { saveTimer = 0; doSave(); }
}

function advanceDay() {
  state.day++;
  state.stats.peakPop = Math.max(state.stats.peakPop, state.pop);

  /* 新增患病 */
  let stress = 0;
  if (indoorTemp < 4) stress += (4 - indoorTemp) * 0.006;
  if (state.blizzard > 0) stress += 0.05;
  if (state.starving) stress += 0.07;
  if (rationMul() < 1) stress += 0.02;
  let mult = 1;
  if (rationMul() > 1) mult = 0.75;
  mult *= Math.pow(0.88, state.lvls.garden || 0);            // 花圃安抚
  mult *= (1 - 0.08 * (state.lvls.radio || 0));               // 通讯塔心理支持
  if (state.buffs.morale > 0) mult *= 0.7;                    // 士气高昂
  const healthy = Math.max(0, state.pop - state.sick);
  const expNew = healthy * stress * mult;
  let newSick = Math.floor(expNew);
  if (Math.random() < expNew - newSick) newSick++;
  newSick = Math.min(newSick, healthy);
  if (newSick > 0) {
    state.sick += newSick;
    addLog(`风寒侵袭，${newSick} 名居民病倒了`, 'bad');
    toast(`🤒 ${newSick} 名居民患病`, 'warn');
    SFX.bad();
  }

  /* 医务室治疗 */
  const beds = B.infirmary.beds(state.lvls.infirmary);
  if (state.lvls.infirmary > 0 && state.sick > 0) {
    const treating = Math.min(state.sick, beds);
    const rate = 0.5 + (has('med') ? 0.3 : 0) + (state.buffs.cureup > 0 ? 0.25 : 0);
    const expCure = treating * rate;
    let cured = Math.floor(expCure);
    if (Math.random() < expCure - cured) cured++;
    if (cured > 0) {
      state.sick -= cured;
      addLog(`医务室治愈了 ${cured} 名患者`, 'good');
    }
  }
  /* 病亡 */
  const dieP = has('med') ? 0.035 : 0.08;
  const expDie = state.sick * dieP;
  let died = Math.floor(expDie);
  if (Math.random() < expDie - died) died++;
  if (died > 0) {
    state.sick = Math.max(0, state.sick - died);
    state.pop = Math.max(0, state.pop - died);
    state.stats.deaths += died;
    addLog(`❄ ${died} 名居民没能熬过这个冬天…`, 'bad');
    toast(`💀 ${died} 名居民离世`, 'bad');
    SFX.bad();
  }

  /* 人口增长 */
  if (!state.gameOver && state.pop > 0 && state.pop < popCap() && !state.starving &&
      state.res.food > state.pop * 3 && Math.random() < 0.45) {
    const n = 1 + (Math.random() < 0.2 ? 1 : 0);
    const real = Math.min(n, popCap() - state.pop);
    state.pop += real;
    state.stats.arrivals += real;
    addLog(`✨ ${real} 位新的幸存者抵达家园`, 'good');
    toast(`👥 ${real} 位新幸存者加入`, 'good');
  }

  /* 暴风雪推进 */
  if (state.blizzard > 0) {
    state.blizzard--;
    if (state.blizzard <= 0) addLog('🌀 暴风雪终于过去了', 'good');
  } else if (Math.random() < Math.min(0.06 + state.day * 0.005, 0.22)) {
    state.blizzard = 0.6 + Math.random() * 0.7;
    addLog('🌀 暴风雪来袭！室外作业减产，耗煤激增', 'bad');
    toast('🌀 暴风雪来袭！', 'bad');
    SFX.bad();
  }
  if (state.boostMine > 0) state.boostMine--;

  /* 增益/减益 Buff 结算 */
  Object.keys(state.buffs).forEach(k => { if (state.buffs[k] > 0) state.buffs[k]--; });

  /* 机场定期空投 */
  if ((state.lvls.airport || 0) > 0 && !state.gameOver) {
    state.airCd--;
    if (state.airCd <= 0) {
      const lvl = state.lvls.airport;
      const pool = ['wood', 'coal', 'food', 'iron', 'stone'];
      const a = pool[Math.floor(Math.random() * pool.length)];
      let b = pool[Math.floor(Math.random() * pool.length)];
      if (b === a) b = pool[(pool.indexOf(a) + 1) % pool.length];
      const amt = 40 + 25 * lvl;
      [a, b].forEach(k => { state.res[k] = Math.min(resCap(k), state.res[k] + amt); });
      addLog(`✈️ 补给航班抵达：${R_META[a].icon}+${amt} ${R_META[b].icon}+${amt}`, 'good');
      toast(`✈️ 机场空投！${R_META[a].icon}+${amt} ${R_META[b].icon}+${amt}`, 'good');
      SFX.tech();
      state.airCd = Math.max(3, 7 - lvl);
    }
  }

  /* 每 10 天寒潮告示 */
  if ((state.day - 1) % 10 === 0 && state.day > 1) {
    addLog('🌡️ 又一轮寒潮南下，气温进一步下降…', 'evt');
    toast('🌡️ 寒潮加剧，注意供暖与物资！', 'warn');
  }
  if (state.day === 4 && state.lvls.academy === 0) {
    toast('🔬 研究所已解锁，可以开始科技研究了', 'good');
  }

  trimWorkers();
  doSave();
  checkGameOver();
}

function trimWorkers() {
  PRODUCERS.forEach(k => {
    state.workers[k] = Math.min(state.workers[k] || 0, slotsOf(k));
  });
  let over = usedWorkers() - state.pop;
  for (const k of PRODUCERS) {
    if (over <= 0) break;
    const cut = Math.min(over, state.workers[k]);
    state.workers[k] -= cut; over -= cut;
  }
}

function checkGameOver() {
  if (state.pop <= 0 && !state.gameOver) {
    state.gameOver = true;
    doSaveFinal();
    SFX.over();
    showGameOver();
  }
}
function doSaveFinal() {
  try { Native.save(JSON.stringify(Object.assign({}, state, { gameOver: true }))); } catch (e) {}
}

/* ================= 建造与升级 ================= */
function canAfford(cost) {
  return Object.entries(cost).every(([k, v]) => state.res[k] >= v);
}
function startUpgrade(key) {
  const def = B[key];
  const cur = state.lvls[key];
  if (cur >= def.max) return;
  if (state.queue) { toast('⚠️ 已有工程在进行中', 'warn'); return; }
  const un = def.unlock(state);
  if (un) { toast('🔒 ' + un, 'warn'); return; }
  const cost = def.cost(cur);
  if (!canAfford(cost)) { toast('⚠️ 资源不足', 'warn'); SFX.bad(); return; }
  Object.entries(cost).forEach(([k, v]) => { state.res[k] -= v; });
  state.queue = { key, toLvl: cur + 1, remain: def.time(cur), total: def.time(cur) };
  addLog(`🔨 开始${cur === 0 ? '建造' : '升级'} ${def.name} → Lv.${cur + 1}`, 'evt');
  SFX.click();
  syncWorld(true);
  refreshAll();
}
function finishConstruction() {
  const q = state.queue; state.queue = null;
  state.lvls[q.key] = q.toLvl;
  state.stats.built++;
  trimWorkers();
  addLog(`✅ ${B[q.key].name} 达到了 Lv.${q.toLvl}`, 'good');
  toast(`✅ ${B[q.key].icon} ${B[q.key].name} Lv.${q.toLvl} 完成`, 'good');
  SFX.build();
  syncWorld(true);
  refreshAll();
}

/* ================= 工人分配 ================= */
function changeWorkers(key, delta) {
  const cur = state.workers[key] || 0;
  const max = Math.min(slotsOf(key), cur + freePop());
  const nv = Math.max(0, Math.min(max, cur + delta));
  if (nv === cur) return;
  state.workers[key] = nv;
  SFX.click();
  refreshAll();
}

/* ================= 研究 ================= */
function techState(t) {
  if (state.tech[t.id]) return 'done';
  if (t.req && !state.tech[t.req]) return 'lock';
  return 'avail';
}
function startResearch(id) {
  if (state.lvls.academy <= 0) return;
  if (state.research) { toast('⚠️ 已有研究正在进行', 'warn'); return; }
  const t = TECHS.find(x => x.id === id);
  if (!t || techState(t) !== 'avail') return;
  if (!canAfford(t.cost)) { toast('⚠️ 资源不足', 'warn'); SFX.bad(); return; }
  Object.entries(t.cost).forEach(([k, v]) => { state.res[k] -= v; });
  const speedBonus = 1 + 0.25 * (state.lvls.academy - 1);
  state.research = { id, remain: t.days / speedBonus };
  addLog(`🔬 开始研究「${t.name}」`, 'evt');
  SFX.click();
  refreshAll();
}
function finishResearch() {
  const t = TECHS.find(x => x.id === state.research.id);
  state.tech[t.id] = true;
  state.research = null;
  addLog(`📚 研究完成：「${t.name}」—— ${t.desc}`, 'good');
  toast(`📚 「${t.name}」研究完成！`, 'good');
  SFX.tech();
  researchFlash = true;
  syncWorld(true);
  refreshAll();
}

/* ================= 事件系统 ================= */
function fireEvent() {
  if (blockSim > 0 || state.gameOver) return;
  const pool = [];
  EVENT_POOL.forEach(e => { if (!e.cond || e.cond()) pool.push(e); });
  const totalW = pool.reduce((s, e) => s + e.w, 0);
  let roll = Math.random() * totalW;
  let ev = pool[pool.length - 1];
  for (const e of pool) { roll -= e.w; if (roll <= 0) { ev = e; break; } }
  ev.run();
}

const EVENT_POOL = [
  {
    id: 'refugee', w: 3,
    run() {
      const n = 1 + (Math.random() < 0.35 ? 1 : 0);
      const cost = 20 * n;
      choiceEvent('🚶 迷途的旅人',
        `风雪中有 ${n} 位旅人敲响了家门。他们饥寒交迫，恳请加入你的家园。`,
        [
          { t: `接纳他们（消耗 ${cost} 食物）`, sub: `+${n} 人口`, can: () => state.res.food >= cost && state.pop + n <= popCap(),
            fn() { state.res.food -= cost; state.pop += n; state.stats.arrivals += n; addLog(`✨ 接纳了 ${n} 位旅人`, 'good'); } },
          { t: '分发少量干粮后送别', sub: '消耗 8 食物，心安理得', can: () => state.res.food >= 8,
            fn() { state.res.food -= 8; addLog('送走了旅人，留下了一点温暖', 'evt'); } },
          { t: '闭门不开', sub: '自保要紧', fn() { addLog('拒绝了旅人的请求', 'evt'); } },
        ]);
    },
  },
  {
    id: 'merchant', w: 3,
    run() {
      const offers = [
        { give: ['wood', 50], get: ['coal', 30], label: '用 50 木材 换 30 煤炭' },
        { give: ['food', 35], get: ['wood', 55], label: '用 35 食物 换 55 木材' },
        { give: ['wood', 70], get: ['iron', 22], label: '用 70 木材 换 22 铁锭' },
        { give: ['coal', 45], get: ['food', 50], label: '用 45 煤炭 换 50 食物' },
      ];
      const picked = offers.sort(() => Math.random() - 0.5).slice(0, 2);
      const html = `
        <h2>🛷 流浪商队</h2>
        <p>一队裹满皮草的商人在暴风雪间隙抵达，摊开了他们的货物。</p>
        <div class="choices" id="merchOffers"></div>
        <div class="choices"><button class="choiceBtn" id="merchClose">商队离去</button></div>`;
      blockBegin(); openModal(html);
      const wrap = document.getElementById('merchOffers');
      const renderOffers = () => {
        wrap.innerHTML = '';
        picked.forEach((o, i) => {
          const ok = state.res[o.give[0]] >= o.give[1];
          const b = document.createElement('button');
          b.className = 'choiceBtn'; b.disabled = !ok;
          b.innerHTML = `${o.label}${ok ? '' : '<em>资源不足</em>'}`;
          b.onclick = () => {
            state.res[o.give[0]] -= o.give[1];
            state.res[o.get[0]] = Math.min(resCap(o.get[0]), state.res[o.get[0]] + o.get[1]);
            addLog(`🛷 与商队交易：${R_META[o.give[0]].name}${o.give[1]} → ${R_META[o.get[0]].name}${o.get[1]}`, 'good');
            SFX.click(); refreshAll(); renderOffers();
          };
          wrap.appendChild(b);
        });
      };
      renderOffers();
      document.getElementById('merchClose').onclick = () => { closeModal(); };
    },
  },
  {
    id: 'salvage', w: 4,
    run() {
      const table = [['wood', 45, 90], ['coal', 30, 70], ['food', 35, 65], ['iron', 8, 20]];
      const pick = table[Math.floor(Math.random() * table.length)];
      const amt = Math.round(pick[1] + Math.random() * (pick[2] - pick[1]));
      state.res[pick[0]] = Math.min(resCap(pick[0]), state.res[pick[0]] + amt);
      const flavor = ['拾荒队在废弃村落有了收获', '冰层下发现了一艘沉船的残骸', '猎人在雪原深处找到一处补给点'][Math.floor(Math.random() * 3)];
      addLog(`${flavor}：+${amt} ${R_META[pick[0]].name}`, 'good');
      toast(`${flavor}<br>+${amt} ${R_META[pick[0]].icon} ${R_META[pick[0]].name}`, 'good');
    },
  },
  {
    id: 'wolves', w: 2,
    run() {
      const loss = Math.max(15, Math.round(state.res.food * 0.18));
      choiceEvent('🐺 狼群环伺',
        '饥饿的狼群在营地外围徘徊，绿油油的眼睛在夜色里闪烁。',
        [
          { t: '点火驱赶', sub: `损失约 ${loss} 食物（被叼走）`, can: () => true,
            fn() { state.res.food = Math.max(0, state.res.food - loss); addLog(`狼群叼走了 ${loss} 食物`, 'bad'); } },
          { t: '组织猎队正面回击', sub: '1 人受伤（患病），保住食物', can: () => state.pop - state.sick > 1,
            fn() { state.sick = Math.min(state.pop, state.sick + 1); addLog('猎队击退狼群，1 人负伤', 'evt'); } },
        ]);
    },
  },
  {
    id: 'storm', w: 2,
    run() {
      state.blizzard = Math.max(state.blizzard, 0.9 + Math.random() * 0.5);
      addLog('🌬️ 气压骤降——特大暴风雪正在逼近！', 'bad');
      toast('🌬️ 特大暴风雪逼近，囤好煤炭！', 'bad');
      SFX.bad();
    },
  },
  {
    id: 'vein', w: 2,
    run() {
      state.boostMine = 2;
      addLog('⛏️ 发现富煤层！两天内煤矿产量 +50%', 'good');
      toast('⛏️ 富煤层！煤矿产量 +50%（2 天）', 'good');
    },
  },
  {
    id: 'outbreak', w: 1.5,
    run() {
      const healthy = state.pop - state.sick;
      const n = Math.min(2, healthy);
      if (n <= 0) { addLog('疫病流行，但幸运地无人感染', 'evt'); return; }
      state.sick += n;
      addLog(`🤒 疫病爆发，${n} 名居民病倒`, 'bad');
      toast(`🤒 疫病爆发！${n} 人患病`, 'bad');
      SFX.bad();
    },
  },
  {
    id: 'doggo', w: 2,
    run() {
      choiceEvent('🐕 雪橇犬', '一只瘦骨嶙峋的雪橇犬拖着破旧的雪橇出现在营地边，雪橇上似乎绑着什么。',
        [
          { t: '收留它', sub: '获得雪橇上的补给：+30 食物', can: () => true,
            fn() { state.res.food = Math.min(resCap('food'), state.res.food + 30); addLog('🐕 收留了雪橇犬，还得到 30 食物', 'good'); } },
          { t: '只取物资，不收留', sub: '+15 食物', can: () => true,
            fn() { state.res.food = Math.min(resCap('food'), state.res.food + 15); addLog('取走了雪橇上的物资', 'evt'); } },
        ]);
    },
  },
  {
    id: 'aurora', w: 2,
    run() {
      state.buffs.cureup = Math.max(state.buffs.cureup, 1);
      state.buffs.morale = Math.max(state.buffs.morale, 1);
      addLog('🌌 极光铺满夜空，病患的病情竟有所好转，人心也安定下来（明天：治愈率↑ 患病↓）', 'good');
      toast('🌌 极光之夜 —— 全体士气高昂！', 'good');
    },
  },
  {
    id: 'fishrun', w: 2, cond: () => state.lvls.lodge > 0 || state.lvls.dock > 0,
    run() {
      state.buffs.hunt = 2;
      const amt = 40;
      state.res.food = Math.min(resCap('food'), state.res.food + amt);
      addLog(`🎣 冰层下鱼群涌动！两天内食物获取 +30%，另外收获 ${amt} 食物`, 'good');
      toast('🎣 冰下渔汛！食物获取 +30%（2 天）', 'good');
    },
  },
  {
    id: 'avalanche', w: 2, cond: () => state.day > 8,
    run() {
      const loss = Math.min(state.res.wood, 60);
      state.res.wood -= loss;
      let hurt = '';
      if (state.pop - state.sick > 1 && Math.random() < 0.6) { state.sick++; hurt = '，1 名居民被埋受伤'; }
      addLog(`🏔️ 雪崩冲毁了外缘的木堆：-${Math.round(loss)} 木材${hurt}`, 'bad');
      toast(`🏔️ 雪崩！-${Math.round(loss)} 木材${hurt}`, 'bad'); SFX.bad();
    },
  },
  {
    id: 'freezeRain', w: 2, cond: () => state.day > 5,
    run() {
      state.buffs.rain = 1;
      addLog('🌧️❄️ 冻雨把一切冻进冰壳：明天室外作业 -25%', 'bad');
      toast('🌧️ 冻雨来袭！明日室外作业 -25%', 'warn'); SFX.bad();
    },
  },
  {
    id: 'geothermal', w: 1.5,
    run() {
      state.buffs.coalsave = 2;
      addLog('♨️ 地热裂缝在营地附近张开：两天内熔炉耗煤 -30%', 'good');
      toast('♨️ 地热裂隙！耗煤 -30%（2 天）', 'good');
    },
  },
  {
    id: 'oldhunter', w: 1.5, cond: () => (state.workers.lodge || 0) > 0,
    run() {
      state.buffs.hunt = 2;
      addLog('🦌 老猎人传授了祖传的追踪术：两天内食物获取 +30%', 'good');
      toast('🦌 猎人的诀窍！食物获取 +30%（2 天）', 'good');
    },
  },
  {
    id: 'scavengers', w: 2, cond: () => state.day > 6,
    run() {
      choiceEvent('🗡️ 拾荒者团伙', '一群带着铁钩与撬棍的家伙围住了粮仓，笑得并不友善。',
        [
          { t: '交出保护费（40 食物）', sub: '破财免灾', can: () => state.res.food >= 40,
            fn() { state.res.food -= 40; addLog('向拾荒者支付了 40 食物', 'evt'); } },
          { t: '组织居民把他们赶走', sub: '混乱中损失 30 铁锭（或等值木材）', can: () => true,
            fn() {
              if (state.res.iron >= 30) state.res.iron -= 30; else state.res.wood = Math.max(0, state.res.wood - 30);
              addLog('赶走了拾荒者，但场面一度失控', 'bad'); SFX.bad();
            } },
        ]);
    },
  },
  {
    id: 'kidsSnowman', w: 1.5, cond: () => state.pop >= 8,
    run() {
      choiceEvent('⛄ 孩子们的雪人节', '孩子们想在广场上堆一百个雪人，还向你发出了裁判邀请。',
        [
          { t: '批准节日，分发热饮（15 食物）', sub: '明天全员士气高涨：治愈率↑ 患病↓',
            can: () => state.res.food >= 15,
            fn() { state.res.food -= 15; state.buffs.morale = 1; state.buffs.cureup = 1; addLog('⛄ 雪人节圆满举行，家园充满笑声', 'good'); } },
          { t: '婉拒，眼下不是玩乐的时候', sub: '无事发生',
            fn() { addLog('孩子们悻悻散去', 'evt'); } },
        ]);
    },
  },
  {
    id: 'minerAccident', w: 1.2, cond: () => (state.workers.mine || 0) > 0 && state.lvls.mine >= 3,
    run() {
      state.res.coal = Math.max(0, state.res.coal - 20);
      if (state.pop - state.sick >= 1) state.sick++;
      addLog('💥 矿道塌方！损失 20 煤炭，1 名矿工被救出后卧床不起', 'bad');
      toast('💥 矿道塌方！-20 煤炭，+1 病患', 'bad'); SFX.bad();
    },
  },
  {
    id: 'blackMarket', w: 1.5, cond: () => state.lvls.wall >= 3,
    run() {
      choiceEvent('🕶️ 黑市商人', '一个兜帽商人掀开货箱——里面是罕见的石材与钢材，「价钱好说」。',
        [
          { t: '买下石材（80 木材 → 50 石材）', can: () => state.res.wood >= 80,
            fn() { state.res.wood -= 80; state.res.stone = Math.min(resCap('stone'), state.res.stone + 50); addLog('从黑市购入 50 石材', 'good'); } },
          { t: '买下钢材（60 石材 → 45 铁锭）', can: () => state.res.stone >= 60,
            fn() { state.res.stone -= 60; state.res.iron = Math.min(resCap('iron'), state.res.iron + 45); addLog('从黑市购入 45 铁锭', 'good'); } },
          { t: '谨慎地送客', fn() { addLog('拒绝了黑市商人的交易', 'evt'); } },
        ]);
    },
  },
];

/* ================= UI：通用组件 ================= */
const $ = id => document.getElementById(id);
const el = {
  dayNum: $('dayNum'), phaseLabel: $('phaseLabel'), outTemp: $('outTemp'), inTemp: $('inTemp'),
  weatherBadge: $('weatherBadge'), btnPause: $('btnPause'), btnPlay: $('btnPlay'), btnFast: $('btnFast'),
  btnPolicy: $('btnPolicy'), btnHelp: $('btnHelp'), btnMute: $('btnMute'),
  resWood: $('resWood'), resCoal: $('resCoal'), resFood: $('resFood'), resIron: $('resIron'), resStone: $('resStone'),
  capWood: $('capWood'), capCoal: $('capCoal'), capFood: $('capFood'), capIron: $('capIron'), capStone: $('capStone'),
  rateWood: $('rateWood'), rateCoal: $('rateCoal'), rateFood: $('rateFood'), rateIron: $('rateIron'), rateStone: $('rateStone'),
  resBoxWood: $('resBoxWood'), resBoxCoal: $('resBoxCoal'), resBoxFood: $('resBoxFood'), resBoxIron: $('resBoxIron'), resBoxStone: $('resBoxStone'),
  popVal: $('popVal'), popCapTxt: $('popCapTxt'), sickChip: $('sickChip'), sickVal: $('sickVal'),
  dockItems: $('dockItems'), tabs: $('tabs'),
  tabDetail: $('tab-detail'), tabLog: $('tab-log'), tabResearch: $('tab-research'),
  logList: $('logList'), logDot: $('logDot'), researchDot: $('researchDot'),
  researchNow: $('researchNow'), techList: $('techList'),
  toasts: $('toasts'), modalRoot: $('modalRoot'), frost: $('frost'), scene: $('scene'),
  fcTemp: $('fcTemp'), pauseBadge: $('pauseBadge'),
  guideCard: $('guideCard'), gcStep: $('gcStep'), gcText: $('gcText'), gcSkip: $('gcSkip'),
};

function toast(html, type, dur) {
  const d = document.createElement('div');
  d.className = 'toast' + (type ? ' ' + type : '');
  d.innerHTML = html;
  el.toasts.appendChild(d);
  setTimeout(() => { d.classList.add('fadeout'); setTimeout(() => d.remove(), 450); }, dur || 3400);
  while (el.toasts.children.length > 4) el.toasts.firstChild.remove();
}
function addLog(msg, cls) {
  const li = document.createElement('li');
  if (cls) li.className = cls;
  li.innerHTML = `<time>第${state.day}天</time>${msg}`;
  el.logList.prepend(li);
  while (el.logList.children.length > 80) el.logList.lastChild.remove();
  if (el.tabLog.classList.contains('hidden')) { logUnread = true; el.logDot.classList.remove('hidden'); }
}
function openModal(html) {
  el.modalRoot.classList.remove('hidden');
  el.modalRoot.innerHTML = `<div class="modal">${html}</div>`;
}
function blockBegin() { blockSim++; if (blockSim === 1) { prevSpeedBeforeBlock = state.speed; state.speed = 0; syncSpeedBtns(); } }
function blockEnd() {
  blockSim = Math.max(0, blockSim - 1);
  if (blockSim === 0) { state.speed = prevSpeedBeforeBlock || 1; syncSpeedBtns(); }
}
function closeModal() {
  el.modalRoot.classList.add('hidden');
  el.modalRoot.innerHTML = '';
  while (blockSim > 0) blockEnd();
}
function choiceEvent(title, text, choices) {
  blockBegin();
  const html = `<h2>${title}</h2><p>${text}</p><div class="choices" id="evChoices"></div>`;
  openModal(html);
  const wrap = $('evChoices');
  choices.forEach(c => {
    const b = document.createElement('button');
    b.className = 'choiceBtn';
    const usable = !c.can || c.can();
    b.disabled = !usable;
    b.innerHTML = c.t + (c.sub ? `<em>${c.sub}</em>` : '');
    b.onclick = () => { c.fn(); closeModal(); refreshAll(); };
    wrap.appendChild(b);
  });
  SFX.event();
}

/* ================= UI：HUD ================= */
function phaseName(p) {
  if (p < 0.12) return '清晨';
  if (p < 0.32) return '上午';
  if (p < 0.48) return '下午';
  if (p < 0.62) return '黄昏';
  return '夜晚';
}
function tempClass(t) { return t >= 10 ? 'lv-ok' : t >= 0 ? 'lv-chill' : t > -12 ? 'lv-cold' : 'lv-freeze'; }

function updateHUD() {
  const p = state.phase / DAY_LEN;
  el.dayNum.textContent = state.day;
  el.phaseLabel.textContent = phaseName(p);
  const ot = outdoorTemp(), it = indoorTemp;
  el.outTemp.textContent = Math.round(ot) + '°';
  el.inTemp.textContent = Math.round(it) + '°';
  el.inTemp.className = tempClass(it);
  el.weatherBadge.classList.toggle('hidden', state.blizzard <= 0);
  el.frost.classList.toggle('on', state.started && !state.gameOver && it < -6);

  [['Wood', 'wood'], ['Coal', 'coal'], ['Food', 'food'], ['Iron', 'iron'], ['Stone', 'stone']].forEach(([S, res]) => {
    el['res' + S].textContent = Math.floor(state.res[res]);
    el['cap' + S].textContent = '/' + resCap(res);
    const net = netPerDay(res);
    const rr = el['rate' + S];
    rr.textContent = (net >= 0 ? '+' : '') + net.toFixed(1);
    rr.className = 'rr ' + (net > 0.05 ? 'plus' : net < -0.05 ? 'minus' : 'zero');
    let low = false;
    if (res === 'food') low = state.res.food < foodEatPerDay();
    if (res === 'coal') low = state.res.coal < coalBurnPerDay();
    el['resBox' + S].classList.toggle('low', low && state.started && !state.gameOver);
  });

  el.popVal.textContent = state.pop;
  el.popCapTxt.textContent = '/' + popCap();
  el.sickChip.classList.toggle('hidden', state.sick <= 0);
  el.sickChip.classList.toggle('warn', state.sick > state.pop * 0.35);
  el.sickVal.textContent = state.sick;

  /* 今夜气温预报 */
  el.fcTemp.textContent = tonightTemp() + '°';
  /* 暂停徽章 */
  el.pauseBadge.classList.toggle('hidden',
    !(state.started && !state.gameOver && state.speed === 0 && blockSim === 0));

  /* 施工/研究进度实时刷新（不重建面板，避免打断点击） */
  const q = state.queue;
  if (q) {
    const pr = Math.max(0, Math.min(100, (1 - q.remain / q.total) * 100));
    const bar = $('qcBar'), rem = $('qcRemain');
    if (bar) bar.style.width = pr + '%';
    if (rem) rem.textContent = '剩余 ' + Math.ceil(Math.max(0, q.remain)) + ' 秒';
  }
  if (state.research && state.lvls.academy > 0) {
    const t = TECHS.find(x => x.id === state.research.id);
    const total = t.days / (1 + 0.25 * (state.lvls.academy - 1));
    const pr = Math.max(0, Math.min(100, (1 - state.research.remain / total) * 100));
    const bar = $('rscBar'), pct = $('rscPct');
    if (bar) bar.style.width = pr + '%';
    if (pct) pct.textContent = Math.round(pr) + '%';
  }

  /* 资源告急自动预警（每天每类只提醒一次） */
  if (state.started && !state.gameOver && blockSim === 0) {
    if (state.res.coal <= coalBurnPerDay() && state.warns.coal !== state.day) {
      state.warns.coal = state.day;
      addLog('⚠️ 煤炭即将烧尽，熔炉面临熄灭！', 'bad');
      toast('⚠️ 煤炭即将烧尽，熔炉面临熄灭！', 'bad'); SFX.bad();
    } else if (state.res.coal < coalBurnPerDay() * 1.5 && state.warns.coalHalf !== state.day) {
      state.warns.coalHalf = state.day;
      toast('🪨 煤炭不足两天消耗，建议增派矿工', 'warn');
    }
    if (state.res.food < foodEatPerDay() && state.warns.food !== state.day) {
      state.warns.food = state.day;
      addLog('⚠️ 食物见底，居民正在挨饿！', 'bad');
      toast('⚠️ 食物见底，居民正在挨饿！', 'bad'); SFX.bad();
    }
    if (indoorTemp < -8 && state.warns.cold !== state.day) {
      state.warns.cold = state.day;
      toast('❄ 室内温度过低，居民健康正在受损', 'bad');
    }
  }

  /* 目标指引心跳 */
  tickGuide();

  /* BGM 暴风雪联动（节流） */
  const stormNow = state.blizzard > 0 ? 1 : 0;
  if (window.BGM && stormNow !== lastStormSent) { lastStormSent = stormNow; BGM.setStorm(stormNow); }

  researchFlash = researchFlash && !el.tabResearch.classList.contains('hidden');
  el.researchDot.classList.toggle('hidden', !researchFlash);
}

/* ---------- 建筑坞 ---------- */
function renderDock() {
  el.dockItems.innerHTML = '';
  B_KEYS.forEach(key => {
    const def = B[key];
    const lvl = state.lvls[key];
    const b = document.createElement('button');
    b.className = 'dockBtn';
    const un = def.unlock(state);
    if (un) b.classList.add('locked');
    /* 未建造且买得起的关键建筑 → 绿光呼吸提示（当前仅围墙） */
    if (!un && lvl === 0 && key === 'wall') {
      const cost = def.cost(0);
      const afford = Object.keys(cost).every(k => state.res[k] >= cost[k]);
      if (afford) b.classList.add('glowNew');
    }
    if (selectedKey === key) b.classList.add('sel');
    if (state.queue && state.queue.key === key) b.classList.add('building');
    const badge = un ? '🔒' : (lvl > 0 ? `Lv.${lvl}` : '＋');
    b.innerHTML = `<span class="di">${def.icon}</span><span class="dn">${def.name}</span><span class="dl">${badge}</span>`;
    b.title = un ? un : def.desc;
    b.onclick = () => { selectBuilding(key); };
    el.dockItems.appendChild(b);
  });
}

/* ---------- 详情面板 ---------- */
function costHTML(cost) {
  return '<div class="costLine">' + Object.entries(cost).map(([k, v]) =>
    `<span class="cost ${state.res[k] < v ? 'no' : ''}">${R_META[k].icon} ${v}</span>`).join('') + '</div>';
}
function selectBuilding(key) {
  selectedKey = key;
  World.setSelected(key);
  World.focusOn(key);
  switchTab('detail');
  SFX.click();
  renderDock(); renderDetail();
}
function renderDetail() {
  const pane = el.tabDetail;
  if (!selectedKey) {
    pane.innerHTML = `
      <div class="d-title"><span class="big">🏔️</span> 冰原家园</div>
      <div class="d-desc">点击 3D 场景中的建筑，或点击底部的建筑图标查看详情。<br>
      维持<b style="color:#ffb35c">熔炉</b>燃烧、保障<b style="color:#ffb35c">食物</b>供给，是活下去的关键。</div>
      <div class="d-stats">
        <span class="chip">🔥 供热 ${heatPower().toFixed(0)} 点</span>
        <span class="chip">🪨 耗煤 ${coalBurnPerDay().toFixed(1)}/天</span>
        <span class="chip">🍖 用餐 ${foodEatPerDay().toFixed(1)}/天</span>
      </div>
      <div class="sect">工位总览</div>
      <div class="d-stats">
        ${PRODUCERS.map(k => `<span class="chip ${state.lvls[k] ? '' : 'w'}">${B[k].icon} ${(state.workers[k] || 0)}/${slotsOf(k)}</span>`).join('')}
      </div>`;
    return;
  }
  const def = B[selectedKey], lvl = state.lvls[selectedKey];
  const un = def.unlock(state);
  if (un && lvl === 0) {
    pane.innerHTML = `
      <div class="d-title"><span class="big">${def.icon}</span> ${def.name}</div>
      <div class="lockNote">🔒 解锁条件：${un}</div>
      <div class="d-desc" style="margin-top:10px">${def.desc}</div>
      ${costHTML(def.cost(0))}
      <button class="bigBtn primary" id="upBtn">建造（耗时 ${Math.round(def.time(0))} 秒）</button>`;
    const ub = $('upBtn'); if (ub) ub.onclick = () => startUpgrade(selectedKey);
    return;
  }
  let html = `<div class="d-title"><span class="big">${def.icon}</span> ${def.name} <span style="color:var(--warm)">Lv.${lvl}</span></div>
    <div class="d-desc">${def.desc}</div><div class="d-stats">`;

  if (PRODUCERS.includes(selectedKey)) {
    html += `<span class="chip">👷 工人 ${(state.workers[selectedKey] || 0)}/${slotsOf(selectedKey)}</span>`;
    const per = B[selectedKey].per *
      ({ wood: (has('axe1') ? 1.15 : 1) * (has('axe2') ? 1.2 : 1),
         coal: (has('coal1') ? 1.15 : 1) * (has('coal2') ? 1.2 : 1) * (state.boostMine > 0 ? 1.5 : 1),
         food: (has('hunt1') ? 1.15 : 1) * (has('hunt2') ? 1.2 : 1),
         iron: (has('drill') ? 1.3 : 1),
         stone: 1 }[B[selectedKey].outRes] || 1);
    html += `<span class="chip w">${R_META[B[selectedKey].outRes].icon} 单人 ${per.toFixed(1)}/天</span>`;
    if (B[selectedKey].secOut)
      html += `<span class="chip w">${R_META[B[selectedKey].secOut].icon} 单人 ${B[selectedKey].secPer.toFixed(1)}/天</span>`;
    if (B[selectedKey].indoor) html += `<span class="chip" style="color:#9dffb8">🏠 室内生产</span>`;
  }
  if (selectedKey === 'furnace')
    html += `<span class="chip w">🔥 供热 ${heatPower().toFixed(0)}</span><span class="chip">🪨 耗煤 ${coalBurnPerDay().toFixed(1)}/天</span>`;
  if (selectedKey === 'shelter') html += `<span class="chip">🏠 居住 ${state.pop}/${popCap()}</span>`;
  if (selectedKey === 'warehouse') html += `<span class="chip">📦 上限 ${resCap('wood')}</span>`;
  if (selectedKey === 'infirmary') html += `<span class="chip">⚕️ 病床 ${B.infirmary.beds(lvl)}</span><span class="chip">🤒 患者 ${state.sick}</span>`;
  if (selectedKey === 'academy') html += `<span class="chip">🔬 研究速度 ×${(1 + 0.25 * Math.max(0, lvl - 1)).toFixed(2)}</span>`;
  if (selectedKey === 'wall') {
    html += `<span class="chip w">${def.territory(lvl)}</span><span class="chip">🛡️ 供热效果 +${(4 * lvl)}%</span>`;
    if (lvl < def.max) html += `<span class="chip">🔓 下一级：${lvl === 2 ? '石墙·解锁外环' : lvl === 4 ? '城墙·解锁远郊' : '加固城防'}</span>`;
  }
  if (selectedKey === 'school') html += `<span class="chip">🎓 教育名额 ${def.eduCap(lvl)}</span><span class="chip">🔬 研究速度 +${10 * lvl}%</span>`;
  if (selectedKey === 'airport') html += `<span class="chip">✈️ 下次空投 ≈ ${state.airCd} 天后</span><span class="chip w">每次两样各 +${40 + 25 * lvl}</span>`;
  if (selectedKey === 'greenhouse') html += `<span class="chip" style="color:#9dffb8">🏠 室内 · 无视严寒与暴风雪</span>`;
  if (selectedKey === 'garden') html += `<span class="chip" style="color:#ffb3d9">🌷 患病几率 -${12 * lvl}%</span>`;
  if (selectedKey === 'workshop') html += `<span class="chip" style="color:#ffd23e">🔧 全体生产 +${6 * lvl}%</span>`;
  if (selectedKey === 'dock' && lvl > 0) html += `<span class="chip w">🔩 副产铁锭 ${(1.5 * (state.workers.dock || 0)).toFixed(1)}/天</span>`;
  if (selectedKey === 'turbine') html += `<span class="chip" style="color:#9dffb8">⚡ 熔炉耗煤 -${6 * lvl}%</span>`;
  if (selectedKey === 'radio') html += `<span class="chip" style="color:#9dffb8">📡 患病几率 -${8 * lvl}%</span>`;
  if (selectedKey === 'geo') html += `<span class="chip" style="color:#ffb35c">♨️ 供热效果 +${6 * lvl}%</span>`;
  if (selectedKey === 'bridge') html += `<span class="chip w">${lvl > 0 ? '✅ 已通航 · 可建灯塔' : '通往神秘小岛'}</span>`;
  if (selectedKey === 'lighthouse') {
    html += `<span class="chip" style="color:#ffd23e">🗼 全体生产 +${5 * lvl}%</span><span class="chip">🎲 事件间隔 +${(0.4 * lvl).toFixed(1)} 天</span>`;
  }
  html += '</div>';

  /* 工人分配 */
  if (PRODUCERS.includes(selectedKey) && lvl > 0) {
    html += `<div class="sect">工人分配</div>
      <div class="workerRow">
        <span class="wl">空闲人口：<b style="color:${freePop() > 0 ? 'var(--ok)' : 'var(--sub)'}">${freePop()}</b></span>
        <div class="wbtns">
          <button id="wMinus" ${state.workers[selectedKey] <= 0 ? 'disabled' : ''}>−</button>
          <span class="wval">${state.workers[selectedKey] || 0} <small>/ ${slotsOf(selectedKey)} 岗</small></span>
          <button id="wPlus" ${(state.workers[selectedKey] || 0) >= slotsOf(selectedKey) || freePop() <= 0 ? 'disabled' : ''}>＋</button>
        </div>
      </div>`;
  }
  /* 熔炉火力 */
  if (selectedKey === 'furnace') {
    html += `<div class="sect">炉火强度（影响供热与耗煤）</div><div class="seg" id="intSeg">` +
      INTENSITIES.map((it, i) => `<button data-i="${i}" class="${i === state.furnIntIdx ? 'on' : ''}">${it.label}</button>`).join('') + '</div>';
    if (state.res.coal <= 0) html += '<div class="lockNote" style="color:#ff6d6d;border-color:rgba(255,109,109,.5)">⚠️ 煤炭耗尽，熔炉已经熄灭！</div>';
  }
  /* 升级 */
  const q = state.queue;
  if (q && q.key === selectedKey) {
    const pr = Math.round((1 - q.remain / q.total) * 100);
    html += `<div class="sect">施工中</div>
      <div class="progressWrap"><div class="progressBar fire" id="qcBar" style="width:${pr}%"></div></div>
      <div style="font-size:12px;color:var(--sub)">Lv.${q.toLvl} · <span id="qcRemain">剩余 ${Math.ceil(q.remain)} 秒</span> · ${Math.round(pr)}%</div>`;
  } else if (lvl < def.max) {
    const cost = def.cost(lvl);
    const afford = canAfford(cost) && !(q);
    html += `<div class="sect">升级到 Lv.${lvl + 1}</div>${costHTML(cost)}
      <button class="bigBtn primary" id="upBtn" ${afford ? '' : 'disabled'}>
        ${q ? '已有其他工程进行中' : '升级 · ' + Math.round(def.time(lvl)) + ' 秒'}</button>`;
  } else {
    html += `<div class="sect"></div><div class="lockNote">已达最高等级。</div>`;
  }
  pane.innerHTML = html;

  const wm = $('wMinus'), wp = $('wPlus'), ub = $('upBtn');
  if (wm) wm.onclick = () => changeWorkers(selectedKey, -1);
  if (wp) wp.onclick = () => changeWorkers(selectedKey, +1);
  if (ub) ub.onclick = () => startUpgrade(selectedKey);
  const seg = $('intSeg');
  if (seg) seg.querySelectorAll('button').forEach(b => {
    b.onclick = () => { state.furnIntIdx = +b.dataset.i; SFX.click(); renderDetail(); };
  });
}

/* ---------- 日志 / 研究 ---------- */
function switchTab(name) {
  ['detail', 'log', 'research'].forEach(t => {
    $('tab-' + t).classList.toggle('hidden', t !== name);
  });
  el.tabs.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  if (name === 'log') { logUnread = false; el.logDot.classList.add('hidden'); }
  if (name === 'research') researchFlash = false;
  if (name === 'detail') renderDetail();
  if (name === 'research') renderResearch();
}
function renderResearch() {
  if (state.lvls.academy <= 0) {
    el.researchNow.innerHTML = '';
    el.techList.innerHTML = `<div class="lockNote">🔬 尚未建造<b>研究所</b>。<br>第 4 天或熔炉达到 3 级后即可建造，届时将解锁科技研究。</div>`;
    return;
  }
  let now = '';
  if (state.research) {
    const t = TECHS.find(x => x.id === state.research.id);
    const total = t.days / (1 + 0.25 * (state.lvls.academy - 1));
    const pr = Math.min(100, (1 - state.research.remain / total) * 100);
    now = `<div class="techCard"><h4>🔭 ${t.name}<span class="st avail" id="rscPct">${Math.round(pr)}%</span></h4>
      <div class="progressWrap"><div class="progressBar" id="rscBar" style="width:${pr}%"></div></div></div>`;
  } else {
    now = `<div style="font-size:12.5px;color:var(--sub);margin-bottom:10px">当前没有进行中的研究。</div>`;
  }
  el.researchNow.innerHTML = now;
  el.techList.innerHTML = TECHS.map(t => {
    const stt = techState(t);
    const afford = canAfford(t.cost);
    let btn = '';
    if (stt === 'done') btn = '<span class="st done">✔ 已掌握</span>';
    else if (stt === 'lock') btn = `<span class="st lock">需先研究「${TECHS.find(x => x.id === t.req).name}」</span>`;
    else btn = `<button data-id="${t.id}" ${(!state.research && afford) ? '' : 'disabled'}>
      ${state.research ? '研究进行中…' : afford ? '开始研究 · ' + t.days + ' 天' : '资源不足'}</button>`;
    return `<div class="techCard" style="${stt === 'done' ? 'opacity:.55' : ''}">
      <h4>${t.name}<span>${stt === 'done' ? btn : ''}</span></h4>
      <p>${t.desc} · 研究耗时 ${t.days} 天</p>
      ${costHTML(t.cost)}
      ${stt !== 'done' ? btn : ''}
    </div>`;
  }).join('');
  el.techList.querySelectorAll('button[data-id]').forEach(b => {
    b.onclick = () => startResearch(b.dataset.id);
  });
}

/* ---------- 总刷新 ---------- */
function refreshAll() {
  renderDock();
  renderDetail();
  renderResearch();
  renderGuide();
  updateHUD();
}
function syncWorld(full) {
  const names = {}, icons = {};
  B_KEYS.forEach(k => { names[k] = B[k].name; icons[k] = B[k].icon; });
  World.sync({ lvls: state.lvls, names, icons, queue: state.queue });
}

/* ================= 各类模态框 ================= */
function showStartModal() {
  blockBegin();
  const hasSave = !!pendingSaveJSON;
  const saveDay = hasSave && pendingSaveJSON.day !== undefined ? pendingSaveJSON.day : '?';
  const html = `
    <div class="startTitle">无尽冬日</div>
    <div class="startSub">— ENDLESS WINTER · 3D 冰原生存 · ${VERSION} —</div>
    ${hasSave ? `<div class="saveBanner">📀 检测到第 <b>${saveDay}</b> 天存档 · 请点击下方「📖 继续旅程」继续</div>` : ''}
    <p style="text-align:center">太阳变得黯淡，长冬吞没了世界。<br>你是一小群幸存者的领袖。守住那座<b style="color:var(--warm)">熔炉</b>，带领大家熬过无尽的寒冬。</p>
    <div class="choices">
      <button class="choiceBtn" id="btnNew" style="text-align:center;font-weight:700">🔥 开始新旅程<em>建立你的冰原家园</em></button>
      <button class="choiceBtn" id="btnContinue" style="text-align:center;font-weight:700" ${hasSave ? '' : 'disabled'}>📖 继续旅程<em>${hasSave ? `读取第 ${saveDay} 天存档` : '暂无存档'}</em></button>
      <button class="choiceBtn" id="btnHow" style="text-align:center">❓ 玩法说明<em>生存指南与操作方式</em></button>
    </div>`;
  openModal(html);
  let newGameArmed = false, newGameTimer = null;
  $('btnNew').onclick = () => {
    if (!hasSave) { startGame(newState()); return; }   // 没有旧档，直接开始
    /* 有旧档：二次确认，防止误触覆盖 */
    if (!newGameArmed) {
      newGameArmed = true;
      const btn = $('btnNew');
      btn.innerHTML = '⚠️ 再点一次确认新开局<em>将覆盖现有存档（第 ' + (pendingSaveJSON ? pendingSaveJSON.day : '?') + ' 天）</em>';
      btn.style.background = 'rgba(224,82,82,.35)';
      clearTimeout(newGameTimer);
      newGameTimer = setTimeout(() => {
        newGameArmed = false;
        btn.innerHTML = '🔥 开始新旅程<em>建立你的冰原家园</em>';
        btn.style.background = '';
      }, 3200);
      return;
    }
    newGameArmed = false;
    startGame(newState());
  };
  $('btnContinue').onclick = () => {
    if (!pendingSaveJSON) return;
    try { startGame(mergeState(pendingSaveJSON)); } catch (e) { reportError(e, 'continue'); startGame(newState()); }
  };
  $('btnHow').onclick = () => { showHelpModal(() => showStartModal()); };
}
function startGame(s) {
  s.started = true;
  s.gameOver = false;
  state = s;
  selectedKey = null;
  World.setSelected(null);
  indoorTemp = outdoorTemp() + heatPower();
  closeModal();
  syncWorld(true);
  refreshAll();
  addLog('🌅 家园在风雪中建立了。愿熔炉之火永不熄灭。', 'evt');
  addLog('🧱 提示：底部栏最左边的「围墙」是领地边界 —— 建造并升级它，可开拓外环与远郊的新土地', 'evt');
  if (window.BGM && !state.muted) BGM.start();   // 用户点击即手势，可安全启动音频
  if (state.day === 1 && state.pop === 6) {
    toast('💡 提示：拖动旋转视角，滚轮缩放，点击建筑管理一切', '', 5200);
    setTimeout(() => { if (state.started && !state.gameOver) toast('🧱 记得建造「围墙」扩张领地（底部栏第一位，绿光闪烁）', 'good', 5600); }, 6200);
  }
}
function showHelpModal(after) {
  blockBegin();
  const html = `
    <h2>❓ 生存指南</h2>
    <ul class="helpList">
      <li><b>🔥 熔炉</b>：家园核心。持续消耗煤炭维持室内温度；煤炭耗尽会熄灭，居民将陆续冻病。可调火力：小火省煤 / 全功率御寒。</li>
      <li><b>🌡️ 温度</b>：夜晚比白天更冷，且随天数不断下降（每 10 天一轮寒潮）。室内低于 4° 就有冻病风险。</li>
      <li><b>👷 工人</b>：选中伐木场 / 煤矿 / 猎人小屋 / 铁矿场，用 ＋− 分配工人。暴风雪时室外作业大幅减产。</li>
      <li><b>🍖 食物</b>：每人每天消耗口粮。断粮会陷入饥荒（减产 + 生病）。可在「政策」中调整配给。</li>
      <li><b>🤒 疾病</b>：寒冷与饥饿导致患病，未入医的病人可能死亡。建造医务室救治。</li>
      <li><b>🌀 暮风雪</b>：随机来袭，持续半天到一天：气温骤降、耗煤 +35%、室外减产。</li>
      <li><b>🔬 研究</b>：建造研究所后解锁 12 项科技，是中后期生存的关键。</li>
      <li><b>🎲 事件</b>：商队、难民、狼群……每次抉择都会改变命运。</li>
      <li><b>🎯 目标指引</b>：左下角的目标卡会一步步教你度过前期，完成有奖励。</li>
      <li><b>🌙 夜间预报</b>：顶栏「今夜」显示今晚最低气温，提前囤煤增温。</li>
      <li><b>⚠️ 自动预警</b>：煤炭/食物告急、室内过冷时会弹出提醒。</li>
      <li><b>🧱 领地扩张</b>：建造「围墙」—— Lv.1-2 木栅栏护家，<b>Lv.3 石墙开拓外环</b>（农场/温室/花圃/采石场/工坊），<b>Lv.5 城墙开拓远郊</b>（学校/码头/机场）。围墙还能为熔炉挡风。</li>
      <li><b>🧱 新资源石材</b>：采石场产出，用于石墙与大型建筑；温室为室内生产，无视严寒暴风雪；花圃降低患病；工坊提升全局产能。</li>
      <li><b>🎓 教育体系</b>：学校提供教育名额并加速研究；码头需要学校，机场需要学校 Lv.2，机场会定期空投补给。</li>
      <li><b>✨ 事件与增益</b>：极光、渔汛、地热等带来限时增益；雪崩、冻雨、塌方带来考验。事件种类随领地扩张而增加。</li>
    </ul>
    <div class="sect">操作</div>
    <p style="font-size:13px">左键拖动旋转视角 · 滚轮缩放 · 右键拖动 / WASD 平移<br>点击建筑或底部图标选中 · 空格暂停 · 1/2 切换速度</p>
    <p style="font-size:12px;color:var(--sub);margin-top:8px">想快速体验或验证机制？在「⚙️ 政策与设置 → 调试面板」中可加资源、跳天数、召唤暴风雪等。</p>
    <div class="choices"><button class="choiceBtn" id="helpBack" style="text-align:center">返回</button></div>`;
  openModal(html);
  $('helpBack').onclick = () => { closeModal(); if (after) after(); };
}
/* 一键满级：调试面板按钮与外部共用 */
function doMaxAll() {
  B_KEYS.forEach(k => { state.lvls[k] = B[k].max; });            // 全部建筑满级
  TECHS.forEach(t => { state.tech[t.id] = true; });              // 全部科技点亮
  RES_KEYS.forEach(k => { state.res[k] = resCap(k); });          // 资源按上限加满
  state.queue = null; state.research = null; state.sick = 0;     // 清施工/研究/病患
  syncWorld(true);
  addLog('[调试] 🚀 一键满级：全部建筑满级、科技全点亮、资源加满', 'good');
  toast('🚀 已一键满级！所有建筑 Lv.MAX、科技全亮、资源满仓', 'good', 4200);
  SFX.build();
}
function showDebugModal() {
  openModal(`
    <h2>🛠️ 调试 / 测试面板</h2>
    <p style="font-size:12.5px;color:var(--sub)">面板打开时游戏<b>不会暂停</b>，可实时观察资源与温度变化。所有操作会写入日志。</p>
    <div class="dbgGrid">
      <button data-a="res">💰 +300 全资源</button>
      <button data-a="nextday">⏭ 跳到下一天</button>
      <button data-a="finQ">🔨 立即完成施工</button>
      <button data-a="finR">🔬 立即完成研究</button>
      <button data-a="cure">⚕️ 治愈所有病患</button>
      <button data-a="pop">👥 人口 +1</button>
      <button data-a="event">🎲 触发随机事件</button>
      <button data-a="storm">🌀 召唤暴风雪</button>
      <button data-a="furn">🔥 熔炉 +1 级</button>
      <button data-a="maxall">🚀 一键满级</button>
      <button data-a="close">✖ 关闭面板</button>
    </div>`);
  el.modalRoot.querySelectorAll('.dbgGrid button').forEach(b => {
    b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'res') {
        RES_KEYS.forEach(k => { state.res[k] = Math.min(resCap(k), state.res[k] + 300); });
        addLog('[调试] 全资源 +300', 'evt');
      } else if (a === 'nextday') {
        state.phase = DAY_LEN - 0.001;
        addLog('[调试] 时间快进至次日', 'evt');
      } else if (a === 'finQ') {
        if (state.queue) finishConstruction();
        else toast('当前没有进行中的施工', 'warn');
        return;
      } else if (a === 'finR') {
        if (state.research) finishResearch();
        else toast('当前没有进行中的研究', 'warn');
        return;
      } else if (a === 'cure') {
        state.sick = 0;
        addLog('[调试] 所有病患已被治愈', 'good');
      } else if (a === 'pop') {
        if (state.pop < popCap()) { state.pop++; state.stats.arrivals++; }
        else { toast('人口已达上限，请先升级居民区', 'warn'); return; }
      } else if (a === 'event') {
        fireEvent(); return;
      } else if (a === 'storm') {
        state.blizzard = Math.max(state.blizzard, 0.8);
        addLog('[调试] 召唤了一场暴风雪', 'evt');
      } else if (a === 'furn') {
        if (state.lvls.furnace < B.furnace.max) {
          state.lvls.furnace++;
          syncWorld(true);
          addLog(`[调试] 熔炉提升至 Lv.${state.lvls.furnace}`, 'good');
        } else { toast('熔炉已满级', 'warn'); return; }
      } else if (a === 'maxall') {
        doMaxAll();
      } else if (a === 'close') { closeModal(); return; }
      refreshAll();
    };
  });
}
function showPoliciesModal() {
  blockBegin();
  const html = `
    <h2>⚙️ 政策与设置</h2>
    <div class="sect">口粮配给（影响消耗与健康）</div>
    <div class="radioRow" id="rationRow">${RATIONS.map((x, i) =>
      `<button data-i="${i}" class="${i === state.rationIdx ? 'on' : ''}">${x.label}<br><small style="font-weight:400">消耗 ×${x.v}</small></button>`).join('')}</div>
    <p style="font-size:12.5px;color:var(--sub)">充足：多耗 30% 食物，降低生病几率；节约：省 30% 食物，但轻微减产并增加生病几率。</p>
    <div class="sect">音效</div>
    <div class="radioRow"><button id="muteToggle">${state.muted ? '🔇 已静音' : '🔊 已开启'}</button></div>
    <div class="choices">
      <button class="choiceBtn" id="polClose" style="text-align:center">关闭</button>
    </div>
    <span class="dangerLink" id="resetSave">删除存档并重新开始</span>
    <span class="infoLink" id="openDebug">打开调试 / 测试面板</span>`;
  openModal(html);
  $('rationRow').querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      state.rationIdx = +b.dataset.i;
      $('rationRow').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      SFX.click(); refreshAll();
    };
  });
  $('muteToggle').onclick = () => {
    state.muted = !state.muted;
    $('muteToggle').textContent = state.muted ? '🔇 已静音' : '🔊 已开启';
    doSave();
  };
  $('polClose').onclick = () => closeModal();
  $('openDebug').onclick = () => { closeModal(); showDebugModal(); };
  const rs = $('resetSave');
  rs.onclick = () => {
    if (rs.dataset.arm) {
      try { if (IS_NATIVE) window.webkit.messageHandlers.bridge.postMessage(JSON.stringify({ type: 'delete' })); else localStorage.removeItem('ew_save_v1'); } catch (e) {}
      pendingSaveJSON = null;
      closeModal();
      startGame(newState());
    } else {
      rs.dataset.arm = '1'; rs.textContent = '再点一次确认删除（不可恢复）';
    }
  };
}
function showGameOver() {
  blockBegin();
  const html = `
    <h2 style="color:var(--danger)">💀 炉火熄灭了</h2>
    <p>最后一位幸存者倒在了冰原上。风雪很快抹平了这里的一切，仿佛无人来过。</p>
    <div class="statGrid">
      <div class="statCell"><b>${state.day}</b><span>存活天数</span></div>
      <div class="statCell"><b>${state.stats.peakPop}</b><span>人口峰值</span></div>
      <div class="statCell"><b>${state.stats.arrivals}</b><span>累计抵达</span></div>
      <div class="statCell"><b>${state.stats.deaths}</b><span>逝去人数</span></div>
      <div class="statCell"><b>${state.stats.built}</b><span>完成工程</span></div>
      <div class="statCell"><b>${Object.keys(state.tech).length}</b><span>研究科技</span></div>
    </div>
    <div class="choices">
      <button class="choiceBtn" id="goRestart" style="text-align:center;font-weight:700">🔥 再燃炉火（重新开始）</button>
    </div>`;
  openModal(html);
  $('goRestart').onclick = () => {
    try { if (IS_NATIVE) window.webkit.messageHandlers.bridge.postMessage(JSON.stringify({ type: 'delete' })); else localStorage.removeItem('ew_save_v1'); } catch (e) {}
    pendingSaveJSON = null;
    closeModal();
    startGame(newState());
  };
}

/* ================= 速度控制 ================= */
function syncSpeedBtns() {
  el.btnPause.classList.toggle('active', state.speed === 0);
  el.btnPlay.classList.toggle('active', state.speed === 1);
  el.btnFast.classList.toggle('active', state.speed === 3);
}
function setSpeed(v) {
  if (blockSim > 0) return;
  state.speed = v;
  syncSpeedBtns();
}
function togglePause() {
  if (blockSim > 0) return;
  setSpeed(state.speed === 0 ? (prevSpeedBeforeBlock || 1) : 0);
  if (state.speed !== 0) prevSpeedBeforeBlock = state.speed;
}

/* ================= 主循环 ================= */
let lastT = performance.now();
let frameCount = 0;
function frame(now) {
  requestAnimationFrame(frame);
  frameCount++;
  if (frameCount === 12) Native.notify({ type: 'firstFrame' });
  let dt = (now - lastT) / 1000;
  lastT = now;
  dt = Math.min(dt, 0.1);

  const running = state.started && !state.gameOver && blockSim === 0 && state.speed > 0;
  if (running) simulate(dt * state.speed);

  /* 视觉状态 */
  const bzTarget = state.blizzard > 0 ? 1 : 0;
  blzVis += (bzTarget - blzVis) * Math.min(1, dt * 0.8);
  const view = {
    phase01: (state.phase / DAY_LEN + 0.02) % 1,
    blizzard01: blzVis,
    lvls: state.lvls,
    workers: state.workers,
    pop: state.pop,
    sick: state.sick,
    furnIntMul: intensityMul(),
    furnLvl: state.lvls.furnace,
    coalLit: state.res.coal > 0,
    gameOver: state.gameOver,
    names: {}, icons: {},
    queue: state.queue,
  };
  B_KEYS.forEach(k => { view.names[k] = B[k].name; view.icons[k] = B[k].icon; });

  World.update(dt, view);

  hudTimer += dt;
  if (hudTimer > 0.15) { hudTimer = 0; updateHUD(); }
}

/* ================= 启动 ================= */
function boot() {
  const ok = World.init({
    canvas: el.scene,
    onSelect: key => { if (key && state.started) selectBuilding(key); else if (!key) { selectedKey = null; World.setSelected(null); renderDock(); renderDetail(); } },
  });

  /* 顶栏按钮 */
  el.btnPause.onclick = () => togglePause();
  el.btnPlay.onclick = () => setSpeed(1);
  el.btnFast.onclick = () => setSpeed(3);
  el.btnMute.onclick = () => {
    state.muted = !state.muted;
    el.btnMute.textContent = state.muted ? '🔇' : '🎵';
    if (window.BGM) BGM.setMuted(state.muted);
    doSave();
  };
  el.btnPolicy.onclick = () => { if (state.started) showPoliciesModal(); };
  el.btnHelp.onclick = () => showHelpModal(state.started ? null : () => showStartModal());

  /* 标签页 */
  el.tabs.querySelectorAll('.tab').forEach(b => {
    b.onclick = () => { switchTab(b.dataset.tab); SFX.click(); };
  });

  el.gcSkip.onclick = () => {
    state.guideDone = true; state.guideIdx = GUIDE.length;
    renderGuide(); doSave();
    toast('已跳过引导，随时可在「玩法说明」回顾要点', '', 3600);
  };

  window.addEventListener('keydown', e => {
    if (e.code === 'Space') { e.preventDefault(); if (state.started) togglePause(); }
    if (e.code === 'Digit1') setSpeed(1);
    if (e.code === 'Digit2') setSpeed(3);
  });
  window.addEventListener('beforeunload', doSave);
  document.addEventListener('visibilitychange', () => { if (document.hidden) doSave(); });

  syncWorld(true);
  refreshAll();
  syncSpeedBtns();
  const verTag = $('verTag');
  if (verTag) verTag.textContent = VERSION;
  requestAnimationFrame(frame);
  Native.notify({ type: 'boot', ok: World.ok, ver: VERSION });
  Native.requestLoad();

  /* 自动测试钩子：--autotest 注入晚于 boot，轮询监听；仅原生环境、限时自取消（避免吊住无头测试） */
  if (IS_NATIVE) {
    let autotestTries = 0;
    const autotestTimer = setInterval(() => {
      if (++autotestTries > 60) { clearInterval(autotestTimer); return; }
      if (!window.__AUTOTEST__) return;
      clearInterval(autotestTimer);
      const stepN = (name, fn) => {
        try { fn(); Native.notify({ type: 'autotest', ok: true, detail: name + ' OK' }); }
        catch (e) { Native.notify({ type: 'autotest', ok: false, detail: name + ' FAIL: ' + String((e && e.stack) || e) }); }
      };
      setTimeout(() => {
        stepN('startGame', () => { if (!state.started) startGame(state); });
        stepN('lvls', () => { B_KEYS.forEach(k => { state.lvls[k] = B[k].max; }); });
        stepN('tech', () => { TECHS.forEach(t => { state.tech[t.id] = true; }); });
        stepN('res', () => { RES_KEYS.forEach(k => { state.res[k] = resCap(k); }); });
        stepN('syncWorld', () => syncWorld(true));
        stepN('refreshAll', () => refreshAll());
        setTimeout(() => stepN('focusSea', () => World.focusOn('bridge')), 400);
        setTimeout(() => {
          const pts = [[-45.5, 8], [-55, 8], [-65, 8], [-76, 8], [-84, 8], [-90, 16]];
          const out = pts.map(([px, pz]) => {
            const p = World.debugProbe(px, pz);
            return `${px},${pz}:y=${isNaN(p.terrainY) ? '?' : p.terrainY.toFixed(2)}${p.covered ? '挡水' : '见水'}`;
          }).join(' ');
          Native.notify({ type: 'autotest', ok: true, detail: 'waterProbe ' + out });
        }, 1200);
        setTimeout(() => stepN('frames+3s', () => true), 3000);
      }, 300);
    }, 400);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
