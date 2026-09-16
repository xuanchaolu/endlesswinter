/* ============================================================
 * 无尽冬日 · 3D 世界引擎（three.js r128）
 * 雪原城市：地形、建筑、昼夜光照、暴风雪、炉火粒子、幸存者小人、轨道相机
 * ============================================================ */
'use strict';

const World = (() => {

  /* ---------- 建筑槽位坐标 ---------- */
  const SLOTS = {
    furnace:   [0, 0],
    shelter:   [-7.5, -4.5],
    sawmill:   [9, -5],
    mine:      [-10.5, 5.5],
    lodge:     [10, 5.5],
    ironmine:  [-15.5, -8.5],
    warehouse: [1.5, -12],
    infirmary: [8, -12],
    academy:   [-5, 12.5],
    /* 外环（围墙 Lv.3 解锁） */
    farm:      [-22, -2],
    greenhouse:[21, -12],
    garden:    [-4, -21],
    quarry:    [-25, -9],
    workshop:  [15, -19],
    /* 远郊（围墙 Lv.5 解锁） */
    school:    [-2, 28],
    dock:      [-34, 8],
    airport:   [36, -7],
    /* 现代设施带（木栅栏与石墙之间） */
    turbine:   [-16, 23],
    radio:     [28, 18],
    geo:       [10, 17],
  };
  const HIT_SIZE = {
    furnace:[5,6,5], shelter:[6,11,6], sawmill:[4.4,3,4.4], mine:[4.4,3,4.4],
    lodge:[4,3,4], ironmine:[4.6,3.4,4.6], warehouse:[5.6,3.4,4.4], infirmary:[4,3,4], academy:[3.4,4.6,3.4],
    farm:[5,1.8,5], greenhouse:[4.4,3,3.4], garden:[3.8,1.2,3.8], quarry:[4.8,2.4,4.8],
    workshop:[4.2,2.6,4.2], school:[5.6,4.4,3.6], dock:[4.6,1.8,3.4], airport:[7,2.6,4.2],
    turbine:[2.2,4.6,2.2], radio:[1.8,4.4,1.8], geo:[3.4,2,3.4],
  };

  let scene, camera, renderer, canvas, raycaster;
  let sunLight, moonLight, hemiLight;
  let groundMesh, pondMesh;
  let floes = [];
  let seaTex = null;
  const winMats = [];          // 夜间发光的窗户材质
  const buildings = {};        // key -> {group, label:{sprite,ctx,tex}, hit, lastLvl}
  const ghosts = {};           // key -> 未建造虚线圈
  let scaffold = null;         // 施工脚手架 {group,key}
  let wallGroup = null, lastWallLvl = -1, lastHeatLvl = -1;
  let bridgeGroup = null, lastBridgeLvl = -1;
  let lightGroup = null, lastLightLvl = -1;
  /* 半径按建筑极坐标分层计算：
     内城最远 ironmine≈17.8 → 木栅栏 r19；
     外环最远 风电站≈27.9(+半宽) → 石墙 r31；
     远郊最远 机场36.7/码头34.9 → 城墙 r42，巨垒 r46 */
  const WALL_R = { 1: 19, 2: 19, 3: 31, 4: 31, 5: 42, 6: 46 };
  let lastView = null;
  let hoverRing, selectRing, heatRing;
  let snowGeo, snowPts, snowVel;
  let firePts, fireGeo, fireLife;
  let smokePts, smokeGeo, smokeLife;
  let starPts, starMat;
  let figures = [];            // 幸存者
  let figAssignT = 0;

  /* 相机 */
  const camTarget = new THREE.Vector3(0, 0, 0);
  const camGoal = new THREE.Vector3(0, 0, 0);
  let camRadius = 38, camTheta = 0.65, camPhi = 0.95;
  const keysDown = {};
  let dragInfo = null;
  let hoveredKey = null, selectedKey = null;
  let onSelectCb = null;
  let timeSec = 0;
  let webglOK = true;

  /* ---------- 小工具 ---------- */
  function mat(color, opt = {}) {
    return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.92, metalness: 0.02 }, opt));
  }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ---------- 程序化纹理（Canvas，离线生成） ---------- */
  const TEXC = {};
  function makeTex(w, h, draw) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    draw(cv.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  function texMat(kind) {
    if (TEXC[kind]) return TEXC[kind];
    let tex;
    if (kind === 'plank') {
      tex = makeTex(128, 128, (c, w, h) => {
        c.fillStyle = '#8a6844'; c.fillRect(0, 0, w, h);
        for (let i = 0; i < 8; i++) {
          const shade = 0.86 + ((i * 37) % 5) * 0.05;
          c.fillStyle = `rgb(${138 * shade | 0},${104 * shade | 0},${68 * shade | 0})`;
          c.fillRect(i * 16 + 1, 0, 14, h);
          c.strokeStyle = 'rgba(60,40,22,0.55)'; c.lineWidth = 1;
          c.beginPath(); c.moveTo(i * 16 + 0.5, 0); c.lineTo(i * 16 + 0.5, h); c.stroke();
          c.strokeStyle = 'rgba(90,64,38,0.35)';
          for (let g = 0; g < 3; g++) {
            const gx = i * 16 + 3 + g * 4;
            c.beginPath(); c.moveTo(gx, 6 + ((i * 13 + g * 29) % 100)); 
            c.bezierCurveTo(gx + 2, 30, gx - 2, 60, gx + 1, 110);
            c.stroke();
          }
        }
      });
    } else if (kind === 'plankDark') {
      tex = makeTex(128, 128, (c, w, h) => {
        c.fillStyle = '#6b4f33'; c.fillRect(0, 0, w, h);
        for (let i = 0; i < 8; i++) {
          const shade = 0.85 + ((i * 29) % 4) * 0.06;
          c.fillStyle = `rgb(${107 * shade | 0},${79 * shade | 0},${51 * shade | 0})`;
          c.fillRect(i * 16 + 1, 0, 14, h);
          c.strokeStyle = 'rgba(42,28,15,0.6)';
          c.beginPath(); c.moveTo(i * 16 + 0.5, 0); c.lineTo(i * 16 + 0.5, h); c.stroke();
        }
      });
    } else if (kind === 'brick') {
      tex = makeTex(128, 128, (c, w, h) => {
        c.fillStyle = '#b9b0a2'; c.fillRect(0, 0, w, h);
        const bh = 16, bw = 32;
        for (let r = 0; r < 8; r++) {
          const off = (r % 2) * (bw / 2);
          for (let col = -1; col < 5; col++) {
            const v = 0.88 + ((r * 7 + col * 11) % 5) * 0.045;
            c.fillStyle = `rgb(${150 * v | 0},${96 * v | 0},${74 * v | 0})`;
            c.fillRect(col * bw + off + 2, r * bh + 2, bw - 4, bh - 4);
          }
        }
      });
    } else if (kind === 'stone') {
      tex = makeTex(128, 128, (c, w, h) => {
        c.fillStyle = '#7d8791'; c.fillRect(0, 0, w, h);
        for (let i = 0; i < 26; i++) {
          const v = 0.75 + ((i * 17) % 7) * 0.07;
          c.fillStyle = `rgb(${139 * v | 0},${149 * v | 0},${160 * v | 0})`;
          const x = (i * 41) % 116, y = (i * 53) % 116, s = 10 + (i * 13) % 14;
          c.beginPath();
          c.moveTo(x + s * 0.2, y); c.lineTo(x + s, y + s * 0.25);
          c.lineTo(x + s * 0.85, y + s); c.lineTo(x + s * 0.1, y + s * 0.9);
          c.closePath(); c.fill();
          c.strokeStyle = 'rgba(50,58,66,0.5)'; c.stroke();
        }
      });
    } else if (kind === 'shingle') {
      tex = makeTex(128, 128, (c, w, h) => {
        c.fillStyle = '#4a5260'; c.fillRect(0, 0, w, h);
        for (let r = 0; r < 8; r++) {
          for (let col = 0; col < 8; col++) {
            const v = 0.82 + ((r * 5 + col * 13) % 6) * 0.045;
            c.fillStyle = `rgb(${84 * v | 0},${92 * v | 0},${104 * v | 0})`;
            c.beginPath();
            c.arc(col * 16 + 8 + (r % 2) * 8, r * 16 + 14, 8.5, Math.PI, 0);
            c.fill();
          }
        }
      });
    }
    TEXC[kind] = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0.02 });
    return TEXC[kind];
  }

  /* 窗户细节套件：框 + 窗台 + 花盒 */
  /* 建筑立面材质：rows 层 × cols 列窗格（随机亮窗 + 窗台 + 楼层线），按参数缓存 */
  const FACADE_CACHE = {};
  function facadeMat(rows, cols, tone) {
    const key = rows + '|' + cols + '|' + (tone || '');
    if (FACADE_CACHE[key]) return FACADE_CACHE[key];
    const cw = 26, ch = 26;
    const tex = makeTex(Math.max(2, cols) * cw, Math.max(1, rows) * ch, (c, w, h) => {
      c.fillStyle = tone || '#5f6d80';
      c.fillRect(0, 0, w, h);
      /* 细微面板色差 */
      for (let i = 0; i < (w * h) / 900; i++) {
        c.fillStyle = 'rgba(255,255,255,' + rand(0.015, 0.05).toFixed(3) + ')';
        c.fillRect((Math.random() * w) | 0, (Math.random() * h) | 0, 30, 8);
        c.fillStyle = 'rgba(18,26,38,' + rand(0.02, 0.06).toFixed(3) + ')';
        c.fillRect((Math.random() * w) | 0, (Math.random() * h) | 0, 22, 10);
      }
      for (let r = 0; r < rows; r++) {
        for (let col = 0; col < cols; col++) {
          const x = col * cw + cw * 0.18, y = r * ch + ch * 0.2;
          const ww = cw * 0.64, wh = ch * 0.52;
          const lit = Math.random() < 0.42;
          c.fillStyle = 'rgba(230,236,244,0.9)';
          c.fillRect(x - 1.5, y - 1.5, ww + 3, wh + 3);
          c.fillStyle = lit ? '#ffd98a' : (Math.random() < 0.5 ? '#26313f' : '#2e3c4d');
          c.fillRect(x, y, ww, wh);
          c.strokeStyle = 'rgba(160,200,235,0.35)';
          c.lineWidth = 1.4;
          c.beginPath(); c.moveTo(x + 1, y + wh - 2); c.lineTo(x + ww - 2, y + 1); c.stroke();
          c.fillStyle = 'rgba(210,220,232,0.85)';
          c.fillRect(x - 2, y + wh + 1.5, ww + 4, 2.5);
          if (lit) {
            c.fillStyle = 'rgba(255,214,130,0.16)';
            c.fillRect(x - 3, y - 3, ww + 6, wh + 6);
          }
        }
      }
      /* 楼层分隔线 */
      c.strokeStyle = 'rgba(15,22,32,0.35)';
      c.lineWidth = 1;
      for (let r = 1; r <= rows; r++) {
        c.beginPath(); c.moveTo(0, r * ch); c.lineTo(w, r * ch); c.stroke();
      }
    });
    const mtl = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.88, metalness: 0.03 });
    FACADE_CACHE[key] = mtl;
    return mtl;
  }

  function addWindowKit(g, x, y, z, ry, winMat, wW = 0.5, wH = 0.55) {
    const frame = new THREE.Group();
    const fmat = mat('#e8e2d4');
    [[0, wH / 2 + 0.04], [0, -wH / 2 - 0.04]].forEach(p => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(wW + 0.12, 0.08, 0.06), fmat);
      bar.position.set(...p); frame.add(bar);
    });
    [[-wW / 2 - 0.04], [wW / 2 + 0.04]].forEach(px => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, wH + 0.16, 0.06), fmat);
      bar.position.set(px[0], 0, 0); frame.add(bar);
    });
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.045, wH, 0.045), fmat);
    frame.add(crossV);
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(wW, 0.045, 0.045), fmat);
    frame.add(crossH);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(wW, wH), winMat || (() => {
      const m = new THREE.MeshStandardMaterial({ color: '#5a4630', emissive: '#ffc76e', emissiveIntensity: 0, roughness: 0.5 });
      winMats.push(m); return m;
    })());
    win.position.z = 0.005;
    frame.add(win);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(wW + 0.22, 0.07, 0.18), fmat);
    sill.position.set(0, -wH / 2 - 0.09, 0.07); frame.add(sill);
    const boxF = new THREE.Mesh(new THREE.BoxGeometry(wW + 0.1, 0.14, 0.16), mat('#7d4a3c'));
    boxF.position.set(0, -wH / 2 - 0.02, 0.1); frame.add(boxF);
    const cols = ['#ff8fb3', '#ffd23e', '#ff6b4a'];
    for (let i = 0; i < 3; i++) {
      const fl = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), mat(cols[(i + Math.round(x)) % 3]));
      fl.position.set(-wW / 3 + i * (wW / 3), -wH / 2 + 0.08, 0.12); frame.add(fl);
    }
    frame.position.set(x, y, z); frame.rotation.y = ry || 0;
    g.add(frame);
    return frame;
  }
  /* 门套件 */
  function addDoor(g, x, y, z, ry, w = 0.62, hgt = 1.05) {
    const dgrp = new THREE.Group();
    const door = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, 0.08), mat('#5c4327'));
    door.position.y = hgt / 2; dgrp.add(door);
    const jambL = new THREE.Mesh(new THREE.BoxGeometry(0.09, hgt + 0.12, 0.12), mat('#e8e2d4'));
    jambL.position.set(-w / 2 - 0.03, (hgt + 0.12) / 2 - 0.02, 0); dgrp.add(jambL);
    const jambR = jambL.clone(); jambR.position.x = w / 2 + 0.03; dgrp.add(jambR);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(w + 0.24, 0.1, 0.12), mat('#e8e2d4'));
    lintel.position.set(0, hgt + 0.08, 0); dgrp.add(lintel);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 7, 6), mat('#c9a24f', { metalness: 0.65, roughness: 0.35 }));
    knob.position.set(w / 2 - 0.1, hgt / 2, 0.07); dgrp.add(knob);
    dgrp.position.set(x, y, z); dgrp.rotation.y = ry || 0;
    g.add(dgrp);
    return dgrp;
  }

  function makeTextSprite(text) {
    const cw = 512, ch = 128;
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const ctx = cv.getContext('2d');
    const tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter;
    const smat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(smat);
    sprite.scale.set(5.6, 1.4, 1);
    sprite.renderOrder = 20;
    const rec = { sprite, ctx, tex, cw, ch, last: '' };
    updateTextSprite(rec, text);
    return rec;
  }
  function updateTextSprite(rec, text) {
    if (rec.last === text) return;
    rec.last = text;
    const { ctx, cw, ch } = rec;
    ctx.clearRect(0, 0, cw, ch);
    ctx.font = "600 46px 'PingFang SC','Hiragino Sans GB',sans-serif";
    const w = Math.min(cw - 20, ctx.measureText(text).width + 56);
    const x = (cw - w) / 2, h = 76, y = (ch - h) / 2;
    ctx.fillStyle = 'rgba(6,14,28,0.74)';
    ctx.strokeStyle = 'rgba(143,216,255,0.5)';
    ctx.lineWidth = 3;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, 20); ctx.fill(); ctx.stroke(); }
    else { ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h); }
    ctx.fillStyle = '#dff1ff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, cw / 2, ch / 2 + 2, cw - 24);
    rec.tex.needsUpdate = true;
    const ratio = Math.min(1, w / 300);
    rec.sprite.scale.set(3.4 + 2.6 * ratio, 1.15 + 0.35 * ratio, 1);
  }

  /* ---------- 场景基础 ---------- */
  function init(opts) {
    canvas = opts.canvas;
    onSelectCb = opts.onSelect || (() => {});
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch (e) {
      webglOK = false;
      document.body.insertAdjacentHTML('beforeend',
        '<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#0a1428;color:#fff;font-size:18px;z-index:99">您的设备不支持 WebGL，无法渲染 3D 画面</div>');
      return false;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;

    scene = new THREE.Scene();
    scene.background = new THREE.Color('#0a1428');
    scene.fog = new THREE.Fog('#0a1428', 34, 160);

    camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 400);

    raycaster = new THREE.Raycaster();

    /* 光照 */
    hemiLight = new THREE.HemisphereLight('#bfd9ff', '#2c3a52', 0.75);
    scene.add(hemiLight);
    sunLight = new THREE.DirectionalLight('#fff2df', 1.0);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    const sc = sunLight.shadow.camera;
    sc.left = -42; sc.right = 42; sc.top = 42; sc.bottom = -42; sc.near = 5; sc.far = 180;
    sunLight.shadow.bias = -0.0006;
    scene.add(sunLight); scene.add(sunLight.target);
    moonLight = new THREE.DirectionalLight('#7d9fd4', 0.25);
    moonLight.position.set(-26, 42, -18);
    scene.add(moonLight);

    buildGround();
    buildPlaza();
    buildScenery();
    buildRings();
    buildSnow();
    buildFire();
    buildSmoke();
    buildStars();

    bindControls();
    window.addEventListener('resize', onResize);
    return true;
  }

  function onResize() {
    if (!webglOK) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /* ---------- 地形 / 布景 ---------- */
  function buildGround() {
    const geo = new THREE.PlaneGeometry(300, 300, 100, 100);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const d = Math.sqrt(x * x + z * z);
      const flat = smoothstep(34, 52, d);
      let h = (Math.sin(x * 0.13) * Math.cos(z * 0.11) * 1.25 + Math.sin(x * 0.31 + z * 0.23) * 0.55) * flat;
      /* 西侧海岸：x < -32 起缓坡下沉，x < -56 成为海底（更早见水、水面更大） */
      const coast = smoothstep(0, 1, Math.min(1, Math.max(0, (-x - 32) / 24)));
      /* 先压平噪声，再整体沉入海底 —— 顺序不能反，否则海底被拉回水面之上 */
      h *= (1 - coast * 0.88);
      h -= coast * 5.5;
      pos.setY(i, h - 0.04);
    }
    geo.computeVertexNormals();
    groundMesh = new THREE.Mesh(geo, mat('#e9f1fa', { roughness: 0.97 }));
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    /* 冰海：整幅深色水面（低于陆地，只在海岸以西露出） */
    /* 冰海：整幅水面（波纹贴图 + 高反光，让它"像水"） */
    const waveTex = makeTex(256, 256, (c, w, h) => {
      c.fillStyle = '#1d527a'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i++) {
        const wy = Math.random() * h;
        const wx = Math.random() * w;
        const len = 14 + Math.random() * 46;
        c.strokeStyle = `rgba(${170 + Math.random() * 50 | 0},${205 + Math.random() * 40 | 0},235,${0.10 + Math.random() * 0.16})`;
        c.lineWidth = 1 + Math.random() * 1.6;
        c.beginPath();
        c.moveTo(wx, wy);
        c.quadraticCurveTo(wx + len / 2, wy - 2.5, wx + len, wy);
        c.stroke();
      }
    });
    waveTex.repeat.set(7, 7);
    seaTex = waveTex;
    /* 不透明海水：漫反射蓝为主 + 自发光保底；关闭雾让远海保持体色直到天际线 */
    pondMesh = new THREE.Mesh(new THREE.PlaneGeometry(440, 440),
      new THREE.MeshStandardMaterial({
        map: waveTex, color: '#bfdcf2', roughness: 0.34, metalness: 0.14,
        emissive: '#1a4a73', emissiveIntensity: 0.6,
      }));
    pondMesh.material.fog = false;   // 远海不被雾洗白
    pondMesh.rotation.x = -Math.PI / 2;
    pondMesh.position.set(0, -1.35, 0);
    pondMesh.renderOrder = -1;
    scene.add(pondMesh);

    /* 浮冰与冰山（西海面） */
    floes = [];
    const floeMat = mat('#dfeefc', { roughness: 0.55 });
    const bergMat = mat('#bcd8ee', { roughness: 0.45, metalness: 0.05 });
    for (let i = 0; i < 12; i++) {
      const fx = rand(-56, -104), fz = rand(-95, 95);
      const fw = rand(1.3, 3.2), fd = rand(1.3, 3.2), ft = rand(0.2, 0.36);
      const floe = new THREE.Mesh(new THREE.BoxGeometry(fw, ft, fd), floeMat);
      floe.position.set(fx, -1.35 + ft * 0.18, fz);
      floe.rotation.y = rand(0, Math.PI);
      floe.userData.baseY = floe.position.y;
      scene.add(floe);
      floes.push(floe);
      if (i % 5 === 0) {
        const berg = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(1.4, 3.2), 0), bergMat);
        berg.position.set(fx + rand(-3, 3), -0.45 + rand(0, 0.7), fz + rand(-3, 3));
        berg.scale.y = rand(0.8, 1.6);
        berg.rotation.set(rand(0, 0.5), rand(0, Math.PI), rand(0, 0.4));
        berg.castShadow = true;
        berg.userData.baseY = berg.position.y;
        berg.userData.bobAmp = 0.12;
        scene.add(berg);
        floes.push(berg);   // 一并轻微起伏
      }
    }
    /* 岸边碎冰带 */
    for (let i = 0; i < 14; i++) {
      const sz = rand(-46, 52);
      const chunk = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.35, 0.9), 0), floeMat);
      chunk.position.set(rand(-44, -36), -1.12, sz);
      chunk.rotation.set(rand(0, 1), rand(0, 3), rand(0, 1));
      scene.add(chunk);
    }

    /* 神秘小岛（西侧海面） */
    const isle = new THREE.Group();
    const isleRock = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 10.5, 4.4, 14), mat('#5c6672'));
    isleRock.position.y = -2.35;
    isle.add(isleRock);
    const isleTop = new THREE.Mesh(new THREE.CylinderGeometry(6.7, 7.2, 0.5, 14), mat('#e9f1fa', { roughness: 0.97 }));
    isleTop.position.y = -0.05;
    isleTop.receiveShadow = true;
    isle.add(isleTop);
    [[-3.4, -1.8, 1], [3.9, 2.2, 1.4]].forEach(p => {
      const rk = new THREE.Mesh(new THREE.DodecahedronGeometry(p[2], 0), mat('#93a1ae'));
      rk.position.set(p[0], 0.15, p[1]);
      rk.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
      isle.add(rk);
    });
    /* 岛上两棵松树 */
    [[-4.2, 2.6], [-2.6, -3.4]].forEach(p => {
      const tI = new THREE.Group();
      const trk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.75, 6), mat('#6b4a33'));
      trk.position.y = 0.37; tI.add(trk);
      [[0.95, 1.05], [0.68, 0.85]].forEach((cfg, j) => {
        const coneT = new THREE.Mesh(new THREE.ConeGeometry(cfg[0] * 0.62, cfg[1], 8), mat(j ? '#194231' : '#21553e'));
        coneT.position.y = 0.72 + j * 0.52;
        tI.add(coneT);
        const snT = new THREE.Mesh(new THREE.ConeGeometry(cfg[0] * 0.5, cfg[1] * 0.36, 8), mat('#f2f8fe'));
        snT.position.y = 0.72 + j * 0.52 + cfg[1] * 0.34;
        tI.add(snT);
      });
      tI.position.set(p[0], 0.16, p[1]);
      isle.add(tI);
    });
    isle.position.set(-84, 0, 8);
    scene.add(isle);
  }

  function buildPlaza() {
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(4.6, 40), mat('#cfdae6', { roughness: 1 }));
    plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.02; plaza.receiveShadow = true;
    scene.add(plaza);
    Object.entries(SLOTS).forEach(([k, [x, z]]) => {
      if (k === 'furnace') return;
      const len = Math.sqrt(x * x + z * z);
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(1.0, len), mat('#d5dfe9', { roughness: 1, transparent: true, opacity: 0.5 }));
      strip.rotation.x = -Math.PI / 2;
      strip.rotation.z = -Math.atan2(x, z);
      strip.position.set(x / 2, 0.025, z / 2);
      strip.receiveShadow = true;
      scene.add(strip);
    });
  }

  function buildScenery() {
    const treeG = new THREE.Group();
    const plantTree = (x, z, s, dark) => {
      const t = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.2, 0.8, 6), mat(dark ? '#5f4127' : '#6b4a33'));
      trunk.position.y = 0.4;
      t.add(trunk);
      const greens = dark ? ['#173f2e', '#1b4835', '#123a29'] : ['#1d4a37', '#21553e', '#194231'];
      let cy = 0.9;
      [[1.15, 1.15], [0.85, 1.0], [0.55, 0.9]].forEach((cfg, j) => {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(cfg[0] * 0.62, cfg[1], 8), mat(greens[j]));
        cone.position.y = cy + cfg[1] / 2 - 0.15;
        cone.castShadow = true;
        t.add(cone);
        const snow = new THREE.Mesh(new THREE.ConeGeometry(cfg[0] * 0.62 * 0.86, cfg[1] * 0.4, 8), mat('#f2f8fe'));
        snow.position.y = cy + cfg[1] - 0.28;
        t.add(snow);
        cy += cfg[1] * 0.62;
      });
      t.position.set(x, -0.05, z);
      t.scale.setScalar(s);
      return t;
    };
    /* 稀疏背景林 */
    for (let i = 0; i < 52; i++) {
      const ang = rand(0, Math.PI * 2);
      const dist = rand(33, 92);
      const x = Math.cos(ang) * dist, z = Math.sin(ang) * dist;
      if (x < -44) continue;   // 不把树种进海里
      treeG.add(plantTree(x, z, rand(0.75, 1.7), false));
    }
    /* 小镇东侧针叶密林（带建筑避让） */
    for (let i = 0; i < 72; i++) {
      const fx = 18 + Math.pow(Math.random(), 0.72) * 66;
      const fz = rand(-64, 64);
      let clear = true;
      Object.values(SLOTS).forEach(([sx, sz]) => {
        const dx = fx - sx, dz = fz - sz;
        if (dx * dx + dz * dz < 30) clear = false;
      });
      if (!clear) continue;
      treeG.add(plantTree(fx, fz, rand(1.1, 2.1), true));
    }
    scene.add(treeG);

    for (let i = 0; i < 16; i++) {
      const ang = rand(0, Math.PI * 2), dist = rand(26, 70);
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.4, 1.3), 0), mat('#93a1ae'));
      rock.position.set(Math.cos(ang) * dist, rand(-0.2, 0.25), Math.sin(ang) * dist);
      rock.scale.y = rand(0.5, 0.85);
      rock.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
      rock.castShadow = true;
      scene.add(rock);
    }
  }

  function buildRings() {
    const mkRing = (rIn, rOut, color, op) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(rIn, rOut, 48),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.y = 0.06; m.visible = false;
      scene.add(m); return m;
    };
    hoverRing = mkRing(2.6, 3.05, '#8fd8ff', 0.55);
    selectRing = mkRing(2.6, 3.0, '#ffb35c', 0.85);
    heatRing = mkRing(1, 1.14, '#ff9a3c', 0.16);
  }

  /* ---------- 粒子系统 ---------- */
  function softDot(color, size) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.beginPath(); c.arc(32, 32, 30, 0, 7); c.fill();
    return new THREE.CanvasTexture(cv);
  }

  function buildSnow() {
    const N = 1700;
    const posArr = new Float32Array(N * 3);
    snowVel = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      posArr[i * 3] = rand(-70, 70); posArr[i * 3 + 1] = rand(0, 42); posArr[i * 3 + 2] = rand(-70, 70);
      snowVel[i * 2] = rand(1.8, 4.6); snowVel[i * 2 + 1] = rand(-1, 1);
    }
    snowGeo = new THREE.BufferGeometry();
    snowGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    snowPts = new THREE.Points(snowGeo, new THREE.PointsMaterial({
      size: 0.42, map: softDot('rgba(255,255,255,0.95)', 1), transparent: true, opacity: 0.85,
      depthWrite: false, sizeAttenuation: true,
    }));
    scene.add(snowPts);
  }

  function buildFire() {
    const N = 64;
    const posArr = new Float32Array(N * 3);
    fireLife = new Float32Array(N);
    for (let i = 0; i < N; i++) fireLife[i] = Math.random();
    fireGeo = new THREE.BufferGeometry();
    fireGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    firePts = new THREE.Points(fireGeo, new THREE.PointsMaterial({
      size: 0.55, map: softDot('rgba(255,170,60,1)', 1), transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    firePts.position.set(SLOTS.furnace[0], 2.6, SLOTS.furnace[1]);
    scene.add(firePts);
  }

  function buildSmoke() {
    const N = 34;
    const posArr = new Float32Array(N * 3);
    smokeLife = new Float32Array(N);
    for (let i = 0; i < N; i++) smokeLife[i] = Math.random();
    smokeGeo = new THREE.BufferGeometry();
    smokeGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    smokePts = new THREE.Points(smokeGeo, new THREE.PointsMaterial({
      size: 1.5, map: softDot('rgba(150,150,158,0.5)', 1), transparent: true, opacity: 0.32, depthWrite: false, fog: false,
    }));
    smokePts.position.set(SLOTS.furnace[0], 3.6, SLOTS.furnace[1]);
    scene.add(smokePts);
  }

  function buildStars() {
    const N = 380;
    const arr = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const th = rand(0, Math.PI * 2), ph = rand(0.12, 1.35), r = 150;
      arr[i * 3] = Math.cos(th) * Math.cos(ph) * r;
      arr[i * 3 + 1] = Math.sin(ph) * r;
      arr[i * 3 + 2] = Math.sin(th) * Math.cos(ph) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    starMat = new THREE.PointsMaterial({ color: '#cfe4ff', size: 1.7, sizeAttenuation: false, transparent: true, opacity: 0, fog: false });
    starPts = new THREE.Points(geo, starMat);
    scene.add(starPts);
  }

  /* ============================================================
   * 建筑模型（全部由低多边形图元拼成）
   * ============================================================ */
  function shadowify(g) { g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); }

  function decorate(key, g, lvl) {
    const lanternAt = {
      shelter: [[-3.4, 1.6]], sawmill: [[2.6, -2.4]], lodge: [[-0.2, 2.8]],
      warehouse: [[-3.2, -2.2]], infirmary: [[-2.4, 1.9]], academy: [[1.9, 1.7]],
      school: [[3.6, 2.2]], workshop: [[1.8, -1.6]], dock: [[2.1, -1.5]], farm: [[2.9, 2.9]],
    };
    (lanternAt[key] || []).forEach(p => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.5, 5), mat('#4c4033'));
      pole.position.set(p[0], 0.75, p[1]); g.add(pole);
      const lm = new THREE.MeshStandardMaterial({ color: '#6b4a22', emissive: '#ffc76e', emissiveIntensity: 0 });
      winMats.push(lm);
      const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.26, 0.22), lm);
      bulb.position.set(p[0], 1.55, p[1]); g.add(bulb);
    });
    const piles = {
      furnace: [[2.6, 1.8]], shelter: [[2.6, -2.2]], sawmill: [[-2.5, -2.5]],
      mine: [[2.6, -2.6]], lodge: [[-2.6, -2.2]], warehouse: [[3.2, -1.6]], greenhouse: [[-2.6, 2.2]],
    };
    (piles[key] || []).forEach(p => {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), mat('#f2f8fe'));
      s.scale.y = 0.45; s.position.set(p[0], 0.08, p[1]); g.add(s);
    });
    if (key === 'warehouse' && lvl >= 3) {
      for (let i = 0; i < 2; i++) {
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.55, 8), mat(i ? '#796043' : '#5f6d7d'));
        barrel.position.set(3.0 - i * 0.55, 0.28, 1.9 + i * 0.3); g.add(barrel);
      }
    }
  }

  function buildModel(key, lvl) {
    const g = new THREE.Group();
    const addWin = (w, h, color) => {
      const m = new THREE.MeshStandardMaterial({ color: '#5a4630', emissive: color || '#ffc76e', emissiveIntensity: 0, roughness: 0.6 });
      winMats.push(m); return m;
    };
    if (key === 'furnace') {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.9, 1.1, 12), texMat('stone'));
      base.position.y = 0.55; g.add(base);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.9, 1.9 + lvl * 0.22, 12), texMat('brick'));
      body.position.y = 1.1 + (1.9 + lvl * 0.22) / 2; g.add(body);
      for (let i = 0; i < Math.min(lvl, 8); i++) {
        const band = new THREE.Mesh(new THREE.TorusGeometry(1.72, 0.09, 6, 16), mat(i % 2 ? '#7a8494' : '#c77b3a'));
        band.rotation.x = Math.PI / 2;
        band.position.y = 1.7 + i * (1.9 + lvl * 0.22) / 9;
        g.add(band);
      }
      const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.62, 16),
        new THREE.MeshBasicMaterial({ color: '#ffb347' }));
      mouth.position.set(0, 1.35, 1.93);
      g.add(mouth);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8),
        new THREE.MeshBasicMaterial({ color: '#ffd23e', transparent: true, opacity: 0.9 }));
      glow.position.y = 2.35 + lvl * 0.22; glow.scale.y = 0.55; g.add(glow);
      const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.9, 8), mat('#39414d'));
      vent.position.y = 2.75 + lvl * 0.22; g.add(vent);
      const pl = new THREE.PointLight('#ff9a3c', 1.1, 16, 2);
      pl.position.set(0, 2.4, 0); pl.name = 'fireLight'; g.add(pl);
    }
    else if (key === 'shelter') {
      /* —— 进化形态：Lv1-2 木屋群 → 3-4 洋楼 → 5-6 多层 → 7-8 小高层 → 9-10 高楼 —— */
      if (lvl <= 2) {
        for (let i = 0; i < Math.min(1 + Math.floor(lvl / 3), 3); i++) {
          const hx = (i - 1) * 2.6;
          const house = new THREE.Group();
          const b = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.7, 2.2),
            i === 1 ? texMat('plankDark') : texMat('plank'));
          b.position.y = 0.85; house.add(b);
          const roof = new THREE.Mesh(new THREE.ConeGeometry(1.95, 1.15, 4), texMat('shingle'));
          roof.position.y = 2.25; roof.rotation.y = Math.PI / 4; house.add(roof);
          const cap = new THREE.Mesh(new THREE.ConeGeometry(1.6, 0.5, 4), mat('#f2f8fe'));
          cap.position.y = 2.62; cap.rotation.y = Math.PI / 4; house.add(cap);
          const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 2.4), mat('#5c4327'));
          ridge.position.y = 2.72; ridge.rotation.y = Math.PI / 4; ridge.scale.z = 0.72; house.add(ridge);
          addWindowKit(house, 0.62, 0.98, 1.12, 0, null, 0.52, 0.48);
          addDoor(house, -0.62, 0.02, 1.12, 0);
          const chim = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.75, 0.3), mat('#8b98a5'));
          chim.position.set(0.75, 2.55, -0.5); house.add(chim);
          const chimCap = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.09, 0.42), mat('#59616b'));
          chimCap.position.set(0.75, 2.96, -0.5); house.add(chimCap);
          if (i === 0) {
            for (let f = 0; f < 4; f++) {
              const logF = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.7, 6), mat('#8f6b45'));
              logF.rotation.z = Math.PI / 2;
              logF.position.set(-1.45, 0.08 + Math.floor(f / 2) * 0.15, 1.35 + (f % 2) * 0.16 - 0.08);
              house.add(logF);
            }
          }
          const step = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 0.5), mat('#8a8f97'));
          step.position.set(-0.62, 0.02, 1.5); house.add(step);
          house.position.x = hx;
          g.add(house);
        }
        g.children.forEach(h => { h.position.z = (h.position.x !== 0) ? 0.9 : 0; });
      } else {
        /* 通用立面楼体：四面临时窗格纹理，夜间亮灯 */
        function buildApartmentBlock(opts) {
          const { W, D, floors, fh, tone, balcony, podium, crown, tank, antenna } = opts;
          const blk = new THREE.Group();
          const H = floors * fh;
          const facM = facadeMat(floors, Math.max(3, Math.round(W * 2)), tone);
          const sideM = facadeMat(floors, 3, tone);
          const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), [facM, facM, texMat('shingle'), texMat('shingle'), sideM, sideM]);
          body.position.y = H / 2;
          body.castShadow = true;
          blk.add(body);
          /* 底层基座与雨棚 */
          if (podium) {
            const pod = new THREE.Mesh(new THREE.BoxGeometry(W + 0.9, 0.85, D + 0.7), texMat('brick'));
            pod.position.y = 0.42;
            blk.add(pod);
          }
          const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 0.9), mat('#37404d'));
          canopy.position.set(0, 1.28, D / 2 + 0.42);
          blk.add(canopy);
          [-0.75, 0.75].forEach(px => {
            const cp = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.25, 6), mat('#37404d'));
            cp.position.set(px, 0.64, D / 2 + 0.78);
            blk.add(cp);
          });
          /* 阳台（洋楼特色） */
          if (balcony) {
            const slabB = new THREE.Mesh(new THREE.BoxGeometry(W * 0.62, 0.09, 0.65), mat('#59616b'));
            slabB.position.set(0, fh * 1.08, D / 2 + 0.32);
            blk.add(slabB);
            const railTop = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.02, 4, 4), mat('#59616b'));
            void railTop;
            for (let bx = -W * 0.3; bx <= W * 0.3; bx += 0.24) {
              const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.34, 4), mat('#8b98a5', { metalness: 0.5 }));
              bar.position.set(bx, fh * 1.08 + 0.22, D / 2 + 0.6);
              blk.add(bar);
            }
            const handrail = new THREE.Mesh(new THREE.BoxGeometry(W * 0.64, 0.06, 0.06), mat('#37404d'));
            handrail.position.set(0, fh * 1.08 + 0.4, D / 2 + 0.6);
            blk.add(handrail);
            /* 老虎窗 */
            const dormer = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.5), texMat('plank'));
            dormer.position.set(0, H + 0.28, D / 2 - 0.35);
            blk.add(dormer);
            const dRoof = new THREE.Mesh(new THREE.ConeGeometry(0.44, 0.34, 4), mat('#e05252'));
            dRoof.position.set(0, H + 0.68, D / 2 - 0.35);
            dRoof.rotation.y = Math.PI / 4;
            blk.add(dRoof);
            /* 坡屋顶（洋楼） */
            const hip = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.72, W * 0.78, 0.85, 4, 1, false, 0, Math.PI), texMat('shingle'));
            hip.rotation.y = Math.PI / 4;
            hip.rotation.z = Math.PI / 2;
            hip.scale.set(1, 0.62, D / W);
            hip.position.y = H + 0.42;
            hip.castShadow = true;
            blk.add(hip);
          } else {
            /* 平顶女儿墙 */
            const parapet = new THREE.Mesh(new THREE.BoxGeometry(W + 0.12, 0.34, D + 0.12), mat(tone));
            parapet.position.y = H + 0.17;
            blk.add(parapet);
          }
          /* 屋顶水箱 */
          if (tank) {
            const tk = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.55, 10), mat('#796043'));
            tk.position.set(W * 0.26, H + 0.62, -D * 0.2);
            blk.add(tk);
            const coneT = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.22, 10), mat('#5c4327'));
            coneT.position.set(W * 0.26, H + 1.0, -D * 0.2);
            blk.add(coneT);
          }
          /* 天线 */
          if (antenna) {
            const antP = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 1.5, 5), mat('#aab6c2'));
            antP.position.set(-W * 0.28, H + 0.95, D * 0.18);
            blk.add(antP);
          }
          /* 楼顶红灯（高楼/小高层） */
          if (crown) {
            const beaconR = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff5c5c' }));
            beaconR.position.set(0, H + (antenna ? 1.85 : 0.5), 0);
            beaconR.name = 'beacon';
            blk.add(beaconR);
            if (!antenna) {
              const crownBand = new THREE.Mesh(new THREE.BoxGeometry(W + 0.2, 0.28, D + 0.2),
                new THREE.MeshStandardMaterial({ color: '#ffd88a', emissive: '#ffca57', emissiveIntensity: 0.5 }));
              winMats.push(crownBand.material);
              crownBand.position.y = H + 0.42;
              blk.add(crownBand);
            }
          }
          return blk;
        }

        let blk;
        if (lvl <= 4) {
          blk = buildApartmentBlock({ W: 4.4, D: 3.4, floors: 2, fh: 1.5, tone: '#8f6f52',
            balcony: true, podium: false, crown: false, tank: false, antenna: false });
        } else if (lvl <= 6) {
          blk = buildApartmentBlock({ W: 4.8, D: 3.6, floors: 5, fh: 1.05, tone: '#9aa5b1',
            balcony: false, podium: true, crown: false, tank: true, antenna: false });
        } else if (lvl <= 8) {
          blk = buildApartmentBlock({ W: 4.6, D: 3.4, floors: 8, fh: 0.92, tone: '#7e8ea0',
            balcony: false, podium: true, crown: true, tank: true, antenna: true });
        } else {
          blk = buildApartmentBlock({ W: 4.2, D: 3.2, floors: 12, fh: 0.82, tone: '#5f6d80',
            balcony: false, podium: true, crown: true, tank: false, antenna: true });
        }
        g.add(blk);
      }
    }
    else if (key === 'sawmill') {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.18, 2.8), mat('#8a6a48'));
      slab.position.y = 0.1; g.add(slab);
      [[-1.5, -1.05], [1.5, -1.05], [-1.5, 1.05], [1.5, 1.05]].forEach(p => {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.9, 6), mat('#6b4a33'));
        post.position.set(p[0], 0.95, p[1]); g.add(post);
      });
      const roof = new THREE.Mesh(new THREE.BoxGeometry(4, 0.16, 3.3), mat('#71543a'));
      roof.position.y = 2.05; roof.rotation.x = 0.16; g.add(roof);
      const rcap = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.1, 2.9), mat('#f2f8fe'));
      rcap.position.y = 2.2; rcap.rotation.x = 0.16; g.add(rcap);
      for (let row = 0; row < 3; row++) {
        for (let c = 0; c < 3 - row; c++) {
          const log = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 2.2, 8), mat('#8f6b45'));
          log.rotation.x = Math.PI / 2;
          log.position.set(-0.95 + c * 0.48 + row * 0.24, 0.24 + row * 0.38, -2.1);
          g.add(log);
        }
      }
      const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 18), mat('#aab6c2', { metalness: 0.55, roughness: 0.35 }));
      blade.rotation.z = Math.PI / 2; blade.position.set(1.1, 0.62, 0.2); blade.name = 'blade'; g.add(blade);
      /* 工作台 + 台钳 */
      const bench = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.6), texMat('plankDark'));
      bench.position.set(-1.4, 0.78, 0.7); g.add(bench);
      [[-2.0], [-0.8]].forEach(px => {
        const legB = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.72, 0.5), mat('#5f4530'));
        legB.position.set(px[0], 0.38, 0.7); g.add(legB);
      });
      const vise = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.24), mat('#3c434d', { metalness: 0.5 }));
      vise.position.set(-1.75, 0.94, 0.7); g.add(vise);
      /* 锯末堆 */
      const sawdust = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), mat('#c9a870'));
      sawdust.scale.y = 0.32; sawdust.position.set(1.7, 0.06, -1.6); g.add(sawdust);
      /* 挂墙工具板 */
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.05), mat('#71543a'));
      board.position.set(-0.2, 1.45, -1.28); g.add(board);
      for (let tI = 0; tI < 3; tI++) {
        const tool = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.34, 0.04), mat(tI === 1 ? '#aab6c2' : '#59616b'));
        tool.position.set(-0.48 + tI * 0.26, 1.44, -1.24); g.add(tool);
      }
    }
    else if (key === 'mine') {
      const mound = new THREE.Mesh(new THREE.SphereGeometry(2.1, 12, 10), mat('#4d545e'));
      mound.scale.set(1.35, 0.85, 1.1); mound.position.y = 0.35; g.add(mound);
      const snowTop = new THREE.Mesh(new THREE.SphereGeometry(1.5, 10, 8), mat('#eef4fb'));
      snowTop.scale.set(1.4, 0.5, 1.1); snowTop.position.y = 1.55; g.add(snowTop);
      [[-0.62], [0.62]].forEach(px => {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.7, 0.22), mat('#5f4530'));
        post.position.set(px[0], 0.85, 2.1); g.add(post);
      });
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.24, 0.26), mat('#5f4530'));
      lintel.position.set(0, 1.75, 2.1); g.add(lintel);
      const hole = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.3), new THREE.MeshBasicMaterial({ color: '#0a0d12' }));
      hole.position.set(0, 0.68, 2.02); g.add(hole);
      const cart = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.5, 0.6), mat('#6d7683'));
      cart.position.set(0, 0.32, 3.1); g.add(cart);
      const coalPile = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.45, 8), mat('#23272e'));
      coalPile.position.set(1.4, 0.22, 2.9); g.add(coalPile);
      [[-0.3], [0.3]].forEach(rx => {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 2.4), mat('#3c434d'));
        rail.position.set(rx[0], 0.06, 2.9); g.add(rail);
      });
      /* 入口灯笼（夜间发光） */
      const lampPost = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.5, 6), mat('#4c4033'));
      lampPost.position.set(-1.05, 0.75, 2.35); g.add(lampPost);
      const lampM = new THREE.MeshStandardMaterial({ color: '#6b4a22', emissive: '#ffc76e', emissiveIntensity: 0 });
      winMats.push(lampM);
      const lampBulb = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.24, 0.18), lampM);
      lampBulb.position.set(-1.05, 1.55, 2.35); g.add(lampBulb);
      /* 支架斜撑 */
      [[-0.62, 1], [0.62, -1]].forEach(pd => {
        const brace = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.85), mat('#5f4530'));
        brace.position.set(pd[0] + pd[1] * 0.28, 1.15, 2.32); brace.rotation.y = pd[1] * 0.55; g.add(brace);
      });
    }
    else if (key === 'lodge') {
      const tent = new THREE.Mesh(new THREE.ConeGeometry(1.75, 2.3, 7), mat('#a58355'));
      tent.position.y = 1.15; g.add(tent);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(1.35, 0.7, 7), mat('#eef4fb'));
      cap.position.y = 2.1; g.add(cap);
      const pole1 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.1, 5), mat('#6b4a33'));
      pole1.rotation.z = 0.5; pole1.position.set(0.5, 1.4, 1.2); g.add(pole1);
      const pole2 = pole1.clone(); pole2.rotation.z = -0.5; pole2.rotation.y = 0.6; pole2.position.x = -0.5; g.add(pole2);
      const firePit = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.1, 6, 12), mat('#5a5f68'));
      firePit.rotation.x = Math.PI / 2; firePit.position.set(1.9, 0.1, 1.6); g.add(firePit);
      const ember = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6),
        new THREE.MeshBasicMaterial({ color: '#ff9a3c' }));
      ember.position.set(1.9, 0.16, 1.6); ember.name = 'ember'; g.add(ember);
      const rack = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.08), mat('#6b4a33'));
      rack.position.set(-1.8, 1.0, 1.2); g.add(rack);
      [[-2.3], [-1.3]].forEach(px => {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.1, 5), mat('#6b4a33'));
        leg.position.set(px[0], 1.05, 1.2); g.add(leg);
      });
      /* 挂着的两条鱼 */
      for (let fi = 0; fi < 2; fi++) {
        const fish = new THREE.Mesh(new THREE.SphereGeometry(0.16, 7, 5), mat(fi ? '#6f9fb8' : '#8fb8c9'));
        fish.scale.set(1.7, 0.55, 0.35);
        fish.position.set(-2.05 + fi * 0.75, 0.78, 1.2);
        g.add(fish);
        const tailF = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.18, 4), mat(fi ? '#6f9fb8' : '#8fb8c9'));
        tailF.rotation.z = Math.PI / 2;
        tailF.position.set(-2.32 + fi * 0.75, 0.78, 1.2); g.add(tailF);
      }
      /* 图腾小柱 */
      const totem = new THREE.Group();
      const tBase = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 1.15, 6), mat('#7a5a3d'));
      tBase.position.y = 0.57; totem.add(tBase);
      const tHead = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.24), mat('#c98fff'));
      tHead.position.y = 1.22; totem.add(tHead);
      [[-0.07], [0.07]].forEach(ex => {
        const eyeT = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 5), mat('#1a1e26'));
        eyeT.position.set(ex[0], 1.26, 0.12); totem.add(eyeT);
      });
      totem.position.set(2.6, 0, -0.9); g.add(totem);
    }
    else if (key === 'ironmine') {
      const rockBig = new THREE.Mesh(new THREE.DodecahedronGeometry(1.9, 0), mat('#7a6a58'));
      rockBig.scale.set(1.3, 0.95, 1.1); rockBig.position.y = 0.6; g.add(rockBig);
      const rust = new THREE.Mesh(new THREE.DodecahedronGeometry(0.9, 0), mat('#9a6a48'));
      rust.position.set(1.3, 0.4, 1.2); g.add(rust);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 3.4, 7), mat('#5f4530'));
      mast.position.set(-1.2, 1.7, 0.6); g.add(mast);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.6, 6), mat('#5f4530'));
      arm.rotation.z = 1.0; arm.position.set(-0.25, 3.1, 0.6); g.add(arm);
      const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 4), mat('#2e343d'));
      cable.position.set(0.75, 2.45, 0.6); g.add(cable);
      const hook = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, 0.4), mat('#6d7683'));
      hook.position.set(0.75, 1.7, 0.6); hook.name = 'hook'; g.add(hook);
    }
    else if (key === 'warehouse') {
      const base = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.9, 3), texMat('plank'));
      base.position.y = 0.95; g.add(base);
      const roofA = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 3.4), texMat('plankDark'));
      roofA.position.set(-1.15, 2.32, 0); roofA.rotation.z = 0.62; g.add(roofA);
      const roofB = roofA.clone(); roofB.position.x = 1.15; roofB.rotation.z = -0.62; g.add(roofB);
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 3.4), mat('#f2f8fe'));
      ridge.position.y = 2.85; g.add(ridge);
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.3, 0.08), mat('#5c452e'));
      door.position.set(0, 0.68, 1.54); g.add(door);
      /* 大门加固横条 */
      [[-0.45], [0], [0.45]].forEach(by => {
        const plankH = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.1, 0.1), mat('#4c3826'));
        plankH.position.set(0, 0.68 + by[0] * 1.6, 1.59); g.add(plankH);
      });
      [[-2.9, 1.9], [-2.5, 2.4], [2.8, 2.1]].forEach((p, i) => {
        const crate = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.62), mat(['#8a6a48', '#796043'][i % 2]));
        crate.position.set(p[0], 0.32, p[1]); crate.rotation.y = rand(0, 1); g.add(crate);
      });
      /* 叠放的第二个箱子 + 绳圈 */
      const crate2 = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), mat('#796043'));
      crate2.position.set(-2.72, 0.92, 2.12); crate2.rotation.y = rand(0, 1); g.add(crate2);
      const rope = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.07, 7, 14), mat('#c9b28a'));
      rope.rotation.x = Math.PI / 2; rope.position.set(3.35, 0.09, -1.1); g.add(rope);
      /* 招牌 */
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.42, 0.06), mat('#e8e2d4'));
      sign.position.set(-2.05, 1.65, 1.58); sign.rotation.y = 0.18; g.add(sign);
      const signIcon = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.02), mat('#8a6844'));
      signIcon.position.set(-2.05, 1.66, 1.62); signIcon.rotation.y = 0.18; g.add(signIcon);
    }
    else if (key === 'infirmary') {
      const tentB = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 1.7, 10, 1, false, 0, Math.PI), mat('#e8ecef'));
      tentB.position.y = 0.85; tentB.rotation.y = Math.PI; g.add(tentB);
      const roofI = new THREE.Mesh(new THREE.CylinderGeometry(1.95, 1.95, 0.9, 10, 1, true, 0, Math.PI), mat('#d3dade'));
      roofI.position.y = 1.7; roofI.material.side = THREE.DoubleSide; roofI.rotation.y = Math.PI; g.add(roofI);
      const back = new THREE.Mesh(new THREE.CircleGeometry(1.9, 10, 0, Math.PI), mat('#dde2e7'));
      back.position.y = 0.02; back.rotation.x = -Math.PI / 2; g.add(back);
      const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.2, 0.06), mat('#e05252', { emissive: '#e05252', emissiveIntensity: 0.35 }));
      c1.position.set(0, 1.35, 1.92); g.add(c1);
      const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.66, 0.06), mat('#e05252', { emissive: '#e05252', emissiveIntensity: 0.35 }));
      c2.position.set(0, 1.35, 1.92); g.add(c2);
      const lamp = new THREE.PointLight('#ff8888', 0.4, 7, 2);
      lamp.position.set(0, 2.2, 1); lamp.name = 'medLight'; g.add(lamp);
    }
    else if (key === 'academy') {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.25, 2.9, 10), texMat('brick'));
      tower.position.y = 1.45; g.add(tower);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(1.05, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat('#3f9aa4', { metalness: 0.35, roughness: 0.4 }));
      dome.position.y = 2.9; g.add(dome);
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 1.5, 8), mat('#c9a24f', { metalness: 0.5, roughness: 0.3 }));
      scope.rotation.z = 1.05; scope.position.set(0.55, 3.75, 0); g.add(scope);
      const ringD = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.07, 6, 16), mat('#c9a24f', { metalness: 0.5 }));
      ringD.rotation.x = Math.PI / 2; ringD.position.y = 2.92; g.add(ringD);
      for (let i = 0; i < 3; i++) {
        const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.36, 0.4), mat('#6b4a33'));
        shelf.position.set(1.6, 0.2 + i * 0.4, 0.8 - i * 0.5);
        shelf.rotation.y = rand(-0.4, 0.4); g.add(shelf);
      }
    }
    else if (key === 'farm') {
      for (let r = 0; r < 3; r++) {
        const soil = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.14, 0.8), mat('#4a3b2c'));
        soil.position.set(0, 0.08, -1.3 + r * 1.3); g.add(soil);
        for (let c = 0; c < 5; c++) {
          const sprout = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.34, 5), mat('#5da35a'));
          sprout.position.set(-1.6 + c * 0.8, 0.28, -1.3 + r * 1.3);
          sprout.rotation.y = rand(0, 3); g.add(sprout);
        }
      }
      const barn = new THREE.Group();
      const bb = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.2, 1.4), texMat('plankDark'));
      bb.position.y = 0.6; barn.add(bb);
      const broof = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.7, 4), texMat('shingle'));
      broof.position.y = 1.55; broof.rotation.y = Math.PI / 4; barn.add(broof);
      const bcap = new THREE.Mesh(new THREE.ConeGeometry(1.0, 0.32, 4), mat('#f2f8fe'));
      bcap.position.y = 1.82; bcap.rotation.y = Math.PI / 4; barn.add(bcap);
      const barnDoor = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), mat('#4c3826'));
      barnDoor.position.set(0, 0.36, 0.71); barn.add(barnDoor);
      barn.position.set(-2.4, 0, 1.8); g.add(barn);
      /* 饮水槽 */
      const trough = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.26, 0.4), texMat('plankDark'));
      trough.position.set(2.2, 0.14, 0.4); g.add(trough);
      const water = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.28),
        new THREE.MeshStandardMaterial({ color: '#3f6d8a', roughness: 0.15, metalness: 0.3 }));
      water.rotation.x = -Math.PI / 2; water.position.set(2.2, 0.26, 0.4); g.add(water);
      /* 干草捆 */
      [[1.9, -1.5], [2.5, -1.1]].forEach((p, hi) => {
        const hay = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.6, 9), mat(hi ? '#d9b45c' : '#c9a24f'));
        hay.rotation.z = Math.PI / 2;
        hay.position.set(p[0], 0.27, p[1]); g.add(hay);
      });
      const scare = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.3, 5), mat('#6b4a33'));
      scare.position.set(1.8, 0.65, 1.6); g.add(scare);
      const arms = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.07, 0.07), mat('#6b4a33'));
      arms.position.set(1.8, 1.0, 1.6); g.add(arms);
    }
    else if (key === 'greenhouse') {
      const glassM = new THREE.MeshStandardMaterial({ color: '#cfeaff', transparent: true, opacity: 0.42, roughness: 0.15, metalness: 0.1 });
      const box = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.9, 2.8), glassM);
      box.position.y = 0.95; g.add(box);
      const roofG = new THREE.Mesh(new THREE.CylinderGeometry(1.85, 1.85, 2.9, 3, 1, false, 0, Math.PI), glassM);
      roofG.rotation.z = Math.PI / 2; roofG.rotation.y = Math.PI / 2;
      roofG.scale.y = 0.62; roofG.position.y = 1.9; g.add(roofG);
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(3.6, 1.9, 2.8)),
        new THREE.LineBasicMaterial({ color: '#eaf6ff', transparent: true, opacity: 0.9 }));
      edge.position.y = 0.95; g.add(edge);
      for (let c = 0; c < 3; c++) {
        const plant = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), mat('#4fae4f'));
        plant.position.set(-1.1 + c * 1.1, 0.45, 0); g.add(plant);
        const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.11, 7, 6), mat('#e8543f'));
        fruit.position.set(-1.1 + c * 1.1 + 0.15, 0.68, 0.1); g.add(fruit);
      }
    }
    else if (key === 'garden') {
      const hedge = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.22, 6, 20), mat('#2f6b46'));
      hedge.rotation.x = Math.PI / 2; hedge.position.y = 0.18; g.add(hedge);
      const cols = ['#ff8fb3', '#ffd23e', '#c98fff', '#ff9a5c', '#8fd8ff'];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 4), mat('#3f7a4f'));
        stem.position.set(Math.cos(a) * 0.95, 0.25, Math.sin(a) * 0.95); g.add(stem);
        const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.13, 7, 6), mat(cols[i % cols.length]));
        bloom.position.set(Math.cos(a) * 0.95, 0.5, Math.sin(a) * 0.95); g.add(bloom);
      }
      const bench = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.28), mat('#8a6a48'));
      bench.position.set(0, 0.32, -1.1); g.add(bench);
      [[-0.38], [0.38]].forEach(px => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.24), mat('#6b4a33'));
        leg.position.set(px[0], 0.16, -1.1); g.add(leg);
      });
    }
    else if (key === 'quarry') {
      const pit = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.5, 0.5, 10), mat('#6f7883'));
      pit.position.y = 0.1; g.add(pit);
      const inner = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.0, 0.4, 10), mat('#59616b'));
      inner.position.y = 0.28; g.add(inner);
      [[-1.9, 0.9], [-1.4, -1.3], [1.8, 1.2]].forEach((p, i) => {
        const block = new THREE.Mesh(new THREE.DodecahedronGeometry(0.36, 0), mat(i ? '#aab4bf' : '#8b98a5'));
        block.position.set(p[0], 0.3, p[1]); block.rotation.set(rand(0, 3), rand(0, 3), 0); g.add(block);
      });
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 2.8, 7), mat('#5f4530'));
      mast.position.set(1.6, 1.4, -1.2); g.add(mast);
      const armQ = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.2, 6), mat('#5f4530'));
      armQ.rotation.z = 1.1; armQ.position.set(0.75, 2.5, -1.2); g.add(armQ);
      const hookQ = new THREE.Mesh(new THREE.DodecahedronGeometry(0.24, 0), mat('#aab4bf'));
      hookQ.position.set(-0.15, 1.9, -1.2); hookQ.name = 'hook'; g.add(hookQ);
    }
    else if (key === 'workshop') {
      const shed = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.5, 2.2), texMat('plankDark'));
      shed.position.y = 0.75; g.add(shed);
      const wshRoof = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.14, 2.6), mat('#5c4c39'));
      wshRoof.position.y = 1.58; g.add(wshRoof);
      const chimneyW = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.8, 0.32), mat('#4c4033'));
      chimneyW.position.set(0.9, 1.95, -0.6); g.add(chimneyW);
      const gear = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.13, 8, 12), mat('#c77b3a', { metalness: 0.5, roughness: 0.35 }));
      gear.position.set(-1.9, 0.55, 1.1); gear.rotation.x = Math.PI / 2; gear.name = 'gear'; g.add(gear);
      const anvil = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.26), mat('#3c434d'));
      anvil.position.set(-1.2, 0.35, 1.6); g.add(anvil);
      const forgeGlow = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6),
        new THREE.MeshBasicMaterial({ color: '#ffb347' }));
      forgeGlow.position.set(0.9, 0.5, 1.15); forgeGlow.name = 'ember'; g.add(forgeGlow);
    }
    else if (key === 'school') {
      const hall = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.9, 2.8), texMat('plank'));
      hall.position.y = 0.95; g.add(hall);
      const sRoof = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.16, 3.2), texMat('plankDark'));
      sRoof.position.y = 2.0; g.add(sRoof);
      const scap = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.1, 2.8), mat('#f2f8fe'));
      scap.position.y = 2.14; g.add(scap);
      for (let c = 0; c < 4; c++) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.55),
          (() => { const m = new THREE.MeshStandardMaterial({ color: '#5a4630', emissive: '#ffc76e', emissiveIntensity: 0, roughness: 0.6 }); winMats.push(m); return m; })());
        win.position.set(-1.65 + c * 1.1, 1.0, 1.42); g.add(win);
      }
      const tower = new THREE.Mesh(new THREE.BoxGeometry(0.9, 3.1, 0.9), mat('#a5825c'));
      tower.position.set(-2.5, 1.55, 0); g.add(tower);
      const tCap = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.8, 4), mat('#7d4a3c'));
      tCap.position.set(-2.5, 3.5, 0); tCap.rotation.y = Math.PI / 4; g.add(tCap);
      const bell = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), mat('#c9a24f', { metalness: 0.6 }));
      bell.position.set(-2.5, 2.9, 0.48); bell.name = 'bell'; g.add(bell);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 5), mat('#8a8f97'));
      pole.position.set(2.6, 1.2, 1.4); g.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.42),
        new THREE.MeshBasicMaterial({ color: '#e05252', side: THREE.DoubleSide }));
      flag.position.set(2.95, 2.15, 1.4); flag.name = 'flag'; g.add(flag);
    }
    else if (key === 'dock') {
      const platform = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.22, 2.6), mat('#8a6a48'));
      platform.position.y = 0.22; g.add(platform);
      [[-1.6, -1.1], [1.6, -1.1], [-1.6, 1.1], [1.6, 1.1], [0, 0]].forEach(p => {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.9, 6), mat('#5f4530'));
        post.position.set(p[0], -0.1, p[1]); g.add(post);
      });
      const walkway = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.18, 2.2), mat('#7a5c3e'));
      walkway.position.set(0, 0.2, 2.2); g.add(walkway);
      const hut = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.0, 1.1), texMat('plank'));
      hut.position.set(-1.1, 0.85, -0.6); g.add(hut);
      const hRoof = new THREE.Mesh(new THREE.ConeGeometry(1.0, 0.55, 4), mat('#f2f8fe'));
      hRoof.position.set(-1.1, 1.6, -0.6); hRoof.rotation.y = Math.PI / 4; g.add(hRoof);
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.5, 12), new THREE.MeshBasicMaterial({ color: '#123a5c' }));
      hole.rotation.x = -Math.PI / 2; hole.position.set(1.0, 0.34, 1.0); hole.name = 'iceHole'; g.add(hole);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.3, 4), mat('#3c434d'));
      rod.rotation.x = 0.9; rod.position.set(1.0, 0.75, 0.55); g.add(rod);
      const crateD = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), mat('#8a6a48'));
      crateD.position.set(1.4, 0.6, -0.8); crateD.rotation.y = 0.5; g.add(crateD);
    }
    else if (key === 'airport') {
      const runway = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.1, 2.4), mat('#3d4652'));
      runway.position.y = 0.06; g.add(runway);
      for (let c = 0; c < 5; c++) {
        const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.12), new THREE.MeshBasicMaterial({ color: '#dfe8f0' }));
        dash.rotation.x = -Math.PI / 2; dash.position.set(-2.4 + c * 1.2, 0.13, 0); g.add(dash);
      }
      const plane = new THREE.Group();
      const bodyP = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 1.7, 8), mat('#dfe8f0', { metalness: 0.3, roughness: 0.4 }));
      bodyP.rotation.z = Math.PI / 2; plane.add(bodyP);
      const noseP = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), mat('#dfe8f0', { metalness: 0.3 }));
      noseP.position.x = 0.85; plane.add(noseP);
      const wingP = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 2.0), mat('#c3ced9'));
      wingP.position.x = -0.1; plane.add(wingP);
      const tailP = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.5, 0.06), mat('#e05252'));
      tailP.position.set(-0.72, 0.3, 0); plane.add(tailP);
      plane.position.set(-1.2, 0.42, -0.6); plane.name = 'plane'; g.add(plane);
      const atower = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 2.2, 8), mat('#7e8ea0'));
      atower.position.set(2.2, 1.1, -1.2); g.add(atower);
      const atop = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), mat('#3f9aa4', { metalness: 0.3 }));
      atop.position.set(2.2, 2.4, -1.2); g.add(atop);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6),
        new THREE.MeshBasicMaterial({ color: '#ff5c5c' }));
      beacon.position.set(2.2, 3.0, -1.2); beacon.name = 'beacon'; g.add(beacon);
    }
    else if (key === 'turbine') {
      /* 塔杆（上细下粗） */
      const mastT = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.26, 3.6, 9), mat('#dfe8f0', { roughness: 0.4, metalness: 0.15 }));
      mastT.position.y = 1.8;
      mastT.castShadow = true;
      g.add(mastT);
      /* 机舱 */
      const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.62, 9), mat('#c3ced9', { metalness: 0.25 }));
      nacelle.rotation.z = Math.PI / 2;
      nacelle.position.y = 3.68;
      g.add(nacelle);
      /* 转子：轮毂 + 三片叶片（绕 z 旋转动画） */
      const rotor = new THREE.Group();
      const hub = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 7), mat('#e8edf2'));
      rotor.add(hub);
      for (let b = 0; b < 3; b++) {
        const bladeW = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.45, 0.03),
          mat('#f2f8fe', { roughness: 0.35 }));
        bladeW.position.y = 0.78;
        const arm = new THREE.Group();
        arm.add(bladeW);
        arm.rotation.z = (b / 3) * Math.PI * 2;
        rotor.add(arm);
      }
      rotor.position.set(-0.32, 3.68, 0);
      rotor.name = 'rotor';
      g.add(rotor);
      /* 检修梯 + 配电箱 */
      const boxE = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.36), mat('#c9a24f'));
      boxE.position.set(0.75, 0.28, 0.35);
      g.add(boxE);
    }
    else if (key === 'radio') {
      /* 格构塔（三段收分） */
      const segs = [[1.05, 0.72], [0.72, 0.48], [0.48, 0.3]];
      let yB = 0;
      segs.forEach((sg, si) => {
        const segM = new THREE.Mesh(new THREE.CylinderGeometry(sg[1], sg[0], 1.15, 6, 1, true),
          mat(si % 2 ? '#aab6c2' : '#96a3b0', { metalness: 0.3, roughness: 0.5 }));
        segM.material.side = THREE.DoubleSide;
        segM.position.y = yB + 0.575;
        yB += 1.15;
        g.add(segM);
      });
      /* 天线杆 + 横枝 */
      const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.3, 5), mat('#dfe8f0'));
      whip.position.y = yB + 0.65;
      g.add(whip);
      [-0.5, -0.15].forEach(dy => {
        const cross = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.045, 0.045), mat('#dfe8f0'));
        cross.position.set(0, yB + 0.9 + dy, 0);
        g.add(cross);
      });
      /* 航空障碍灯 */
      const warn = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff5c5c' }));
      warn.position.y = yB + 1.34;
      warn.name = 'beacon';
      g.add(warn);
      /* 抛物面天线 */
      const dish = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2.6),
        mat('#eef4fb', { roughness: 0.4 }));
      dish.rotation.x = -Math.PI / 2.6;
      dish.position.set(0.55, yB - 0.35, 0.25);
      g.add(dish);
      const dishArm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 5), mat('#96a3b0'));
      dishArm.rotation.x = 0.5;
      dishArm.position.set(0.42, yB - 0.12, 0.12);
      g.add(dishArm);
      /* 机房 */
      const shedR = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 0.9), texMat('plankDark'));
      shedR.position.set(-0.85, 0.35, 0.55);
      g.add(shedR);
    }
    else if (key === 'geo') {
      /* 井口平台 */
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.9, 0.24, 12), mat('#59616b'));
      pad.position.y = 0.12;
      g.add(pad);
      /* 井架（四腿塔） */
      [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]].forEach(p => {
        const legG = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 2.5, 6), mat('#8a6844'));
        legG.position.set(p[0], 1.25, p[1]);
        legG.rotation.z = p[0] > 0 ? -0.08 : 0.08;
        g.add(legG);
      });
      [[0.9], [1.7], [2.4]].forEach(hy => {
        const brace = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.07, 0.95), mat('#6b4a33'));
        brace.position.y = hy[0];
        g.add(brace);
      });
      /* 输热管道（弯头） */
      const pipeMat = mat('#c97b3a', { metalness: 0.35, roughness: 0.4 });
      const p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.9, 8), pipeMat);
      p1.rotation.z = Math.PI / 2;
      p1.position.set(-0.6, 0.42, 1.15);
      g.add(p1);
      const p2 = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.1, 8), pipeMat);
      p2.position.set(-1.5, 0.95, 1.15);
      g.add(p2);
      /* 阀门轮 */
      const valve = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 6, 14), mat('#e05252'));
      valve.position.set(-0.35, 0.58, 1.15);
      valve.name = 'valve';
      g.add(valve);
      /* 地热蒸汽 */
      const steamM = new THREE.MeshBasicMaterial({ color: '#eef6ff', transparent: true, opacity: 0.32 });
      [0, 1, 2].forEach(si => {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(0.22 - si * 0.04, 7, 6), steamM.clone());
        puff.position.set(0.15 + si * 0.14, 2.75 + si * 0.34, 0);
        puff.userData.puffOff = si * 1.9;
        puff.name = 'steam';
        g.add(puff);
      });
      /* 变电站小屋 */
      const sub = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.62, 0.8), texMat('plank'));
      sub.position.set(1.35, 0.31, -0.95);
      g.add(sub);
    }
    decorate(key, g, lvl);
    shadowify(g);
    return g;
  }

  /* 同步建筑可见性 / 等级 / 标签 / 脚手架 */
  function sync(view) {
    lastView = view;
    Object.keys(SLOTS).forEach(key => {
      const lvl = view.lvls[key] || 0;
      const [x, z] = SLOTS[key];
      let rec = buildings[key];
      if (lvl > 0) {
        if (!rec || rec.lastLvl !== lvl) {
          if (rec) { scene.remove(rec.group); disposeGroup(rec.group); scene.remove(rec.hit); }
          const group = buildModel(key, lvl);
          group.position.set(x, 0, z);
          if (key === 'dock') group.rotation.y = -Math.PI / 2;   // 栈桥朝向大海（西）
          scene.add(group);
          const label = makeTextSprite('');
          label.sprite.position.set(x, key === 'furnace' ? 5.6 : 4.1, z);
          scene.add(label.sprite);
          const hs = HIT_SIZE[key];
          const hit = new THREE.Mesh(new THREE.BoxGeometry(hs[0], hs[1], hs[2]),
            new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
          hit.position.set(x, hs[1] / 2, z);
          hit.userData.key = key;
          scene.add(hit);
          rec = buildings[key] = { group, label, hit, lastLvl: lvl };
        }
        updateTextSprite(rec.label, (view.icons[key] || '') + ' ' + view.names[key] + ' · Lv.' + lvl);
        rec.label.sprite.visible = true;
        if (ghosts[key]) ghosts[key].visible = false;
      } else {
        if (rec) { scene.remove(rec.group); disposeGroup(rec.group); scene.remove(rec.hit); scene.remove(rec.label.sprite); delete buildings[key]; }
        if (!ghosts[key]) {
          const gh = new THREE.Mesh(new THREE.RingGeometry(2.1, 2.45, 36),
            new THREE.MeshBasicMaterial({ color: '#8fd8ff', transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
          gh.rotation.x = -Math.PI / 2; gh.position.set(x, 0.055, z);
          scene.add(gh); ghosts[key] = gh;
        }
        ghosts[key].visible = true;
      }
    });

    /* 施工脚手架 */
    const q = view.queue;
    if (q) {
      if (!scaffold || scaffold.key !== q.key) {
        if (scaffold) scene.remove(scaffold.group);
        const hs = HIT_SIZE[q.key];
        const g = new THREE.Group();
        const boxM = new THREE.MeshBasicMaterial({ color: '#59c8ff', transparent: true, opacity: 0.22, depthWrite: false });
        const box = new THREE.Mesh(new THREE.BoxGeometry(hs[0] * 0.9, hs[1] * 0.8, hs[2] * 0.9), boxM);
        box.position.y = hs[1] * 0.4; g.add(box);
        const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(hs[0] * 0.9, hs[1] * 0.8, hs[2] * 0.9)),
          new THREE.LineBasicMaterial({ color: '#8fd8ff', transparent: true, opacity: 0.8 }));
        edge.position.y = hs[1] * 0.4; g.add(edge);
        g.position.set(SLOTS[q.key][0], 0.1, SLOTS[q.key][1]);
        scene.add(g);
        scaffold = { group: g, box, key: q.key };
      }
      const p = q.total > 0 ? Math.min(1, 1 - q.remain / q.total) : 0;
      scaffold.box.scale.y = 0.12 + p * 0.88;
      scaffold.box.position.y = (HIT_SIZE[q.key][1] * 0.8) * scaffold.box.scale.y / 2;
    } else if (scaffold) {
      scene.remove(scaffold.group); scaffold = null;
    }

    /* 围墙（随等级变身：木栅栏 → 石墙 → 城墙） */
    const wl = view.lvls.wall || 0;
    const hn = Math.min(4, view.lvls.heatStation || 0);
    if (wl !== lastWallLvl || hn !== lastHeatLvl) {
      lastWallLvl = wl;
      lastHeatLvl = hn;
      if (wallGroup) { scene.remove(wallGroup); disposeGroup(wallGroup); wallGroup = null; }
      if (wl > 0) { wallGroup = buildWall(wl, hn); scene.add(wallGroup); }
    }

    /* 跨海大桥 */
    const bl = view.lvls.bridge || 0;
    if (bl !== lastBridgeLvl) {
      lastBridgeLvl = bl;
      if (bridgeGroup) { scene.remove(bridgeGroup); disposeGroup(bridgeGroup); bridgeGroup = null; }
      if (bl > 0) { bridgeGroup = buildBridge(bl); scene.add(bridgeGroup); }
    }
    /* 灯塔 */
    const ll = view.lvls.lighthouse || 0;
    if (ll !== lastLightLvl) {
      lastLightLvl = ll;
      if (lightGroup) { scene.remove(lightGroup); disposeGroup(lightGroup); lightGroup = null; }
      if (ll > 0) { lightGroup = buildLighthouse(ll); scene.add(lightGroup); }
    }
  }

  function buildBridge(lvl) {
    const g = new THREE.Group();
    const deckMat = texMat('plankDark');
    const railMat = mat('#8a6844');
    const X0 = -45.5, X1 = -76, ZC = 8;
    const N = 13;
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) / N;
      const x = X0 + (X1 - X0) * t;
      const archY = 0.5 + Math.sin(t * Math.PI) * 0.55;
      const seg = new THREE.Mesh(new THREE.BoxGeometry((X1 - X0) / N + 0.25, 0.22, 2.5), deckMat);
      seg.position.set(x, archY, ZC);
      seg.castShadow = true; seg.receiveShadow = true;
      g.add(seg);
      /* 栏杆柱 */
      [-1.12, 1.12].forEach(off => {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.55, 0.09), railMat);
        post.position.set(x, archY + 0.36, ZC + off);
        g.add(post);
      });
      /* 灯串（夜间发光） */
      if (i % 2 === 0) {
        const lm = new THREE.MeshStandardMaterial({ color: '#6b4a22', emissive: '#ffc76e', emissiveIntensity: 0 });
        winMats.push(lm);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 7, 6), lm);
        bulb.position.set(x, archY + 0.62, ZC);
        g.add(bulb);
      }
      /* 桥墩 */
      if (i % 3 === 1) {
        [-0.85, 0.85].forEach(off => {
          const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, archY + 1.9, 8), mat('#5f4530'));
          pil.position.set(x, archY / 2 - 0.95 + 0.35, ZC + off);
          g.add(pil);
        });
      }
    }
    /* 两侧长栏杆扶手 */
    [ZC - 1.12, ZC + 1.12].forEach(off => {
      const hand = new THREE.Mesh(new THREE.BoxGeometry(X1 - X0, 0.07, 0.07), railMat);
      hand.position.set((X0 + X1) / 2, 1.06, off);
      hand.rotation.z = 0; // 拱顶差由立柱消化
      g.add(hand);
    });
    /* 桥头堡 */
    [[X0, 1], [X1, -1]].forEach(([gx]) => {
      const gate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.5, 3), texMat('plank'));
      gate.position.set(gx, 0.75, ZC);
      gate.castShadow = true;
      g.add(gate);
      void lvl;
    });
    return g;
  }

  function buildLighthouse(lvl) {
    const g = new THREE.Group();
    const LX = -86.5, LZ = 11.5;
    const h = 3.1 + lvl * 0.5;
    /* 红白条纹塔身 */
    const stripes = 5;
    for (let i = 0; i < stripes; i++) {
      const rB = 1.02 - i * 0.11;
      const segH = h / stripes;
      const st = new THREE.Mesh(new THREE.CylinderGeometry(rB - 0.055, rB, segH, 14),
        mat(i % 2 ? '#e8ecef' : '#e05252', { roughness: 0.7 }));
      st.position.y = segH * (i + 0.5);
      st.castShadow = true;
      g.add(st);
    }
    /* 岩石基座 */
    const fnd = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.8, 0.5, 12), mat('#93a1ae'));
    fnd.position.y = 0.15;
    g.add(fnd);
    /* 观景回廊 */
    const gal = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.12, 14), mat('#37404d'));
    gal.position.y = h + 0.06;
    g.add(gal);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const rp = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.42, 5), mat('#37404d'));
      rp.position.set(Math.cos(a) * 0.88, h + 0.32, Math.sin(a) * 0.88);
      g.add(rp);
    }
    /* 灯室 + 旋转光束 */
    const lampRoom = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.62, 12),
      new THREE.MeshStandardMaterial({ color: '#ffd88a', emissive: '#ffca57', emissiveIntensity: 0.85, transparent: true, opacity: 0.92 }));
    lampRoom.position.y = h + 0.44;
    g.add(lampRoom);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.78, 0.55, 12), mat('#e05252'));
    cap.position.y = h + 1.02;
    g.add(cap);
    const pl = new THREE.PointLight('#ffca57', 1.2, 30, 2);
    pl.position.y = h + 0.44;
    g.add(pl);
    const beam = new THREE.Group();
    const coneGeo = new THREE.ConeGeometry(1.7, 17, 16, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: '#ffe9b0', transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
    });
    const bcone = new THREE.Mesh(coneGeo, beamMat);
    bcone.rotation.z = Math.PI / 2;
    bcone.position.x = 8.5;
    beam.add(bcone);
    beam.position.y = h + 0.44;
    beam.name = 'beam';
    g.add(beam);
    /* 守塔人小屋 */
    const hut = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.0, 1.2), texMat('plank'));
    hut.position.set(3.1, 0.66, -1.6);
    hut.castShadow = true;
    g.add(hut);
    const hRoof = new THREE.Mesh(new THREE.ConeGeometry(1.25, 0.6, 4), mat('#7d4a3c'));
    hRoof.position.set(3.1, 1.42, -1.6);
    hRoof.rotation.y = Math.PI / 4;
    g.add(hRoof);
    const winL = new THREE.MeshStandardMaterial({ color: '#5a4630', emissive: '#ffc76e', emissiveIntensity: 0 });
    winMats.push(winL);
    const hutWin = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), winL);
    hutWin.position.set(3.1, 0.72, -0.98);
    g.add(hutWin);

    g.position.set(LX, 0, LZ);
    return g;
  }

  /* 城门方位（西→码头/大桥，南→主城区） */
  /* 西城门精确对准跨海大桥落点 (-45.5, 8)；南门保持 π/2 */
  const WEST_GATE_A = Math.atan2(8, -45.5);
  const WALL_GATES = [WEST_GATE_A, Math.PI / 2];
  function nearGate(a) {
    return WALL_GATES.some(ga => {
      let d = Math.abs(a - ga) % (Math.PI * 2);
      if (d > Math.PI) d = Math.PI * 2 - d;
      return d < 0.09;
    });
  }

  function buildGateHouse(g, a, r, h, stone) {
    const gx = Math.cos(a) * r, gz = Math.sin(a) * r;
    const grp = new THREE.Group();
    const gateW = stone ? 3.4 : 2.6;
    /* 门柱 × 2 */
    [-1, 1].forEach(s => {
      const pa = a + s * (gateW / 2) / r;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(stone ? 0.5 : 0.17, stone ? 0.58 : 0.2, h + (stone ? 0.9 : 0.5), stone ? 10 : 6),
        stone ? texMat('stone') : mat('#5f4530'));
      post.position.set(Math.cos(pa) * r, (h + (stone ? 0.9 : 0.5)) / 2, Math.sin(pa) * r);
      post.rotation.y = -a;
      post.castShadow = true;
      grp.add(post);
    });
    /* 门楣 / 拱梁 */
    const lintelLen = gateW + (stone ? 1.1 : 0.7);
    if (stone) {
      const arch = new THREE.Mesh(new THREE.BoxGeometry(lintelLen, 0.55, 1.0), texMat('brick'));
      arch.position.set(gx, h + 1.05, gz);
      arch.rotation.y = -a + Math.PI / 2;
      arch.castShadow = true;
      grp.add(arch);
      const crenel = new THREE.Mesh(new THREE.BoxGeometry(lintelLen, 0.3, 0.8), mat('#8b98a5'));
      crenel.position.set(gx, h + 1.45, gz);
      crenel.rotation.y = -a + Math.PI / 2;
      grp.add(crenel);
    } else {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(lintelLen, 0.16, 0.24), mat('#6b4a33'));
      beam.position.set(gx, h + 0.42, gz);
      beam.rotation.y = -a + Math.PI / 2;
      grp.add(beam);
      const beam2 = beam.clone(); beam2.position.y = h + 0.18; grp.add(beam2);
    }
    /* 门柱灯（夜间发光） */
    const lampM = new THREE.MeshStandardMaterial({ color: '#6b4a22', emissive: '#ffc76e', emissiveIntensity: 0 });
    winMats.push(lampM);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 7, 6), lampM);
    bulb.position.set(Math.cos(a + 0.06) * r, (stone ? h + 0.75 : h + 0.62), Math.sin(a + 0.06) * r);
    grp.add(bulb);
    g.add(grp);
  }

  function buildHeatPost(g, a, r, h) {
    /* 墙上供暖站岗楼：砖房 + 铜顶 + 烟囱 + 暖窗 */
    const hx = Math.cos(a) * r, hz = Math.sin(a) * r;
    const hutG = new THREE.Group();
    const bodyH = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.35, 1.5), texMat('brick'));
    bodyH.position.y = h + 0.68;
    hutG.add(bodyH);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.95, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat('#c77b3a', { metalness: 0.55, roughness: 0.35 }));
    dome.position.y = h + 1.36;
    hutG.add(dome);
    const chimH = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.85, 7), mat('#4c4033'));
    chimH.position.set(-0.45, h + 1.95, 0.25);
    hutG.add(chimH);
    const warmWin = new THREE.MeshStandardMaterial({ color: '#5a4630', emissive: '#ff9a3c', emissiveIntensity: 0 });
    winMats.push(warmWin);
    const winH = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.4), warmWin);
    winH.position.set(0, h + 0.72, 0.77);
    hutG.add(winH);
    const pipeH = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.15, 7), mat('#c97b3a', { metalness: 0.4 }));
    pipeH.rotation.x = Math.PI / 2;
    pipeH.position.set(0, h + 0.3, -0.95);
    hutG.add(pipeH);
    hutG.position.set(hx, 0, hz);
    hutG.rotation.y = -a;
    g.add(hutG);
  }

  function buildWall(lvl, heatN = 0) {
    const g = new THREE.Group();
    const r = WALL_R[lvl] || 20;
    if (lvl <= 2) {
      const h = lvl === 1 ? 1.05 : 1.3;
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        if (nearGate(a)) continue;   // 留出城门
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, h, 5), mat('#7a5a3d'));
        post.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
        post.rotation.y = -a;
        post.castShadow = true;
        g.add(post);
      }
      /* 栏绳也断在门口：用两段圆弧 */
      WALL_GATES.forEach((ga, gi) => {
        const span = Math.PI * 2 / WALL_GATES.length;
        const startA = ga + 0.1, endA = ga + span - 0.1;
        const midR = r;
        const arcPts = [];
        for (let t = 0; t <= 20; t++) {
          const aa = startA + (endA - startA) * (t / 20);
          arcPts.push(new THREE.Vector3(Math.cos(aa) * midR, 0.55, Math.sin(aa) * midR));
        }
        const railCurve = new THREE.CatmullRomCurve3(arcPts);
        const rail = new THREE.Mesh(new THREE.TubeGeometry(railCurve, 32, 0.05, 5, false), mat('#6b4a33'));
        g.add(rail);
        if (lvl === 2) {
          const pts2 = arcPts.map(p => p.clone().setY(1.05));
          const rail2 = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts2), 32, 0.05, 5, false), mat('#6b4a33'));
          g.add(rail2);
        }
        buildGateHouse(g, ga, r, h, false);
        void gi;
      });
    } else {
      const h = 2 + (lvl - 3) * 0.35;
      const N = Math.max(36, Math.round(r * 2.4));
      const w = (2 * Math.PI * r) / N * 0.94;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        if (nearGate(a)) continue;   // 留出城门
        const seg = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.75), mat(i % 2 ? '#9aa5b1' : '#8b98a5'));
        seg.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
        seg.rotation.y = -a + Math.PI / 2;
        seg.castShadow = true; seg.receiveShadow = true;
        g.add(seg);
      }
      for (let q = 0; q < 4; q++) {
        const a = q * Math.PI / 2 + Math.PI / 4;
        const tw = new THREE.Group();
        const tb = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.15, h + 1.1, 10), mat('#8b98a5'));
        tb.position.y = (h + 1.1) / 2; tw.add(tb);
        const tc = new THREE.Mesh(new THREE.ConeGeometry(1.25, 0.9, 10), mat('#f2f8fe'));
        tc.position.y = h + 1.55; tw.add(tc);
        if (lvl >= 5) {
          const torchM = new THREE.MeshStandardMaterial({ color: '#7a4c22', emissive: '#ff9a3c', emissiveIntensity: 0 });
          winMats.push(torchM);
          const torch = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), torchM);
          torch.position.set(0, h + 0.6, 1.05); tw.add(torch);
        }
        tw.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); g.add(tw);
      }
      /* 石墙阶段：供暖站岗楼（数量随供暖站等级） */
      if (lvl >= 3 && heatN > 0) {
        [Math.PI / 4, 7 * Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4].slice(0, heatN)
          .forEach(a => buildHeatPost(g, a, r, h));
      }
      WALL_GATES.forEach(ga => buildGateHouse(g, ga, r, h, true));
    }
    shadowify(g);
    return g;
  }

  /* 每帧刷新选择圈位置（保证点击后立刻贴合所选建筑底部） */
  function updateRings() {
    if (selectedKey && SLOTS[selectedKey]) {
      selectRing.visible = true;
      selectRing.position.x = SLOTS[selectedKey][0];
      selectRing.position.z = SLOTS[selectedKey][1];
    } else {
      selectRing.visible = false;
    }
  }

  function setSelected(key) { selectedKey = key; }
  function disposeGroup(g) {
    g.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); }
    });
  }

  /* ============================================================
   * 幸存者小人
   ============================================================ */
  const COATS = ['#c94f4f', '#4f7fc9', '#c9a24f', '#7d63c9', '#4fc98f', '#c96a9a'];
  const HAIRS = ['#2b2118', '#4a331f', '#7a5230', '#141414', '#8c3b22', '#d8c07a'];
  const SKINS = ['#f2cfa5', '#eec298', '#d9ab7e'];

  function makeFigure() {
    const g = new THREE.Group();
    const coat = COATS[Math.floor(Math.random() * COATS.length)];
    const hairC = HAIRS[Math.floor(Math.random() * HAIRS.length)];
    const skin = SKINS[Math.floor(Math.random() * SKINS.length)];
    const dark = mat('#232830');

    /* 四肢工厂：枢轴在肩/胯，末端加手/脚 */
    function limb(px, py, len, r, m, foot) {
      const pivot = new THREE.Group();
      pivot.position.set(px, py, 0);
      const bone = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.82, len, 6), m);
      bone.position.y = -len / 2;
      pivot.add(bone);
      if (foot === 'shoe') {
        const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.15), mat('#22262e'));
        shoe.position.set(0, -len - 0.015, 0.035);
        pivot.add(shoe);
      } else if (foot === 'mitt') {
        const hand = new THREE.Mesh(new THREE.SphereGeometry(r * 1.25, 6, 5), mat(skin));
        hand.position.y = -len - 0.01;
        pivot.add(hand);
      }
      return pivot;
    }

    /* 腿 × 2 */
    const trouser = mat('#37404d');
    const legL = limb(-0.085, 0.36, 0.3, 0.055, trouser, 'shoe');
    const legR = limb(0.085, 0.36, 0.3, 0.055, trouser, 'shoe');
    g.add(legL, legR);

    /* 大衣躯干 */
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.215, 0.46, 8), mat(coat, { roughness: 0.85 }));
    body.position.y = 0.56;
    g.add(body);
    /* 围巾 */
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.045, 6, 12),
      mat(COATS[Math.floor(Math.random() * COATS.length)], { roughness: 0.9 }));
    scarf.rotation.x = Math.PI / 2;
    scarf.position.y = 0.78;
    g.add(scarf);

    /* 手臂 × 2（微外张） */
    const armL = limb(-0.225, 0.74, 0.3, 0.045, mat(coat), 'mitt');
    armL.rotation.z = 0.22;
    const armR = limb(0.225, 0.74, 0.3, 0.045, mat(coat), 'mitt');
    armR.rotation.z = -0.22;
    g.add(armL, armR);

    /* 头部（脸 / 发 / 帽） */
    const headG = new THREE.Group();
    headG.position.y = 0.98;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 10, 9), mat(skin, { roughness: 0.75 }));
    headG.add(head);
    [-1, 1].forEach(s => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.019, 6, 5), dark);
      eye.position.set(0.052 * s, 0.025, 0.117);
      headG.add(eye);
    });
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.009, 5, 10, Math.PI), dark);
    smile.position.set(0, -0.038, 0.116);
    smile.rotation.z = Math.PI;
    headG.add(smile);
    [-1, 1].forEach(s => {
      const blush = new THREE.Mesh(new THREE.CircleGeometry(0.022, 7),
        new THREE.MeshBasicMaterial({ color: '#e8927c', transparent: true, opacity: 0.55 }));
      blush.position.set(0.085 * s, -0.012, 0.104);
      headG.add(blush);
    });
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.142, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.56),
      mat(hairC, { roughness: 0.95 }));
    hairCap.position.set(0, 0.012, -0.012);
    headG.add(hairCap);
    const fringe = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.055, 0.05), mat(hairC));
    fringe.position.set(0, 0.095, 0.098);
    fringe.rotation.x = -0.25;
    headG.add(fringe);
    if (Math.random() < 0.4) {
      const beanC = COATS[Math.floor(Math.random() * COATS.length)];
      const beanie = new THREE.Mesh(new THREE.SphereGeometry(0.148, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
        mat(beanC, { roughness: 0.95 }));
      beanie.position.y = 0.02;
      headG.add(beanie);
      const brim = new THREE.Mesh(new THREE.TorusGeometry(0.138, 0.026, 6, 14), mat(beanC));
      brim.rotation.x = Math.PI / 2;
      brim.position.y = 0.028;
      headG.add(brim);
      const pom = new THREE.Mesh(new THREE.SphereGeometry(0.045, 7, 6), mat('#f2f8fe'));
      pom.position.y = 0.185;
      headG.add(pom);
    }
    g.add(headG);

    shadowify(g);
    g.userData.fig = {
      target: new THREE.Vector3(), speed: rand(1.1, 1.7),
      mode: 'idle', wait: rand(0, 2), bobOff: rand(0, 6), sickTint: false,
      limbs: { legL, legR, armL, armR },
    };
    const spot = SLOTS.shelter;
    g.position.set(spot[0] + rand(-2, 2), 0, spot[1] + rand(-2, 2));
    scene.add(g);
    return g;
  }

  function randPointNear(key, spread) {
    const [x, z] = SLOTS[key];
    return new THREE.Vector3(x + rand(-spread, spread), 0, z + rand(-spread, spread));
  }

  function assignFigures(view) {
    const want = Math.max(0, Math.min(view.pop, 26));
    while (figures.length < want) figures.push(makeFigure());
    while (figures.length > want) { const f = figures.pop(); scene.remove(f); disposeGroup(f); }
    const sites = [];
    ['sawmill', 'mine', 'lodge', 'ironmine', 'farm', 'greenhouse', 'quarry', 'dock'].forEach(k => {
      const n = view.workers[k] || 0;
      if (n > 0 && (view.lvls[k] || 0) > 0) sites.push({ key: k, count: n });
    });
    const night = view.nightFactor > 0.62;
    const shelterBuilt = (view.lvls.shelter || 0) > 0;
    const infirmaryBuilt = (view.lvls.infirmary || 0) > 0;
    let idx = 0;
    const totalSiteNeed = sites.reduce((s, o) => s + o.count, 0);
    figures.forEach((fig, i) => {
      const ud = fig.userData.fig;
      const isSick = i >= figures.length - Math.min(view.sick, figures.length);
      ud.sickTint = isSick;
      if (isSick) {
        ud.mode = 'rest';
        ud.target.copy(infirmaryBuilt && !night ? randPointNear('infirmary', 1.6) :
          (shelterBuilt ? randPointNear('shelter', 1.8) : randPointNear('furnace', 2.4)));
        return;
      }
      if (night) {
        ud.mode = 'home';
        if (i < 2) { ud.target.copy(randPointNear('furnace', 1.6)); ud.mode = 'tend'; }
        else ud.target.copy(shelterBuilt ? randPointNear('shelter', 2.2) : randPointNear('furnace', 3));
        return;
      }
      if (idx < totalSiteNeed) {
        let acc = 0, site = sites[sites.length - 1];
        for (const s of sites) { acc += s.count; if (idx < acc) { site = s; break; } }
        idx++;
        ud.mode = 'work';
        ud.siteKey = site.key;
        ud.target.copy(randPointNear(site.key, 1.9));
        return;
      }
      ud.mode = 'wander';
      if (ud.wait <= 0) {
        ud.target.copy(Math.random() < 0.5 ? randPointNear('furnace', 4.5) : randPointNear(shelterBuilt ? 'shelter' : 'furnace', 3.5));
        ud.wait = rand(3, 8);
      }
    });
  }

  function updateFigures(dt, view) {
    figAssignT -= dt;
    if (figAssignT <= 0) { assignFigures(view); figAssignT = 2.2; }
    figures.forEach(fig => {
      const ud = fig.userData.fig;
      ud.wait -= dt;
      const d = ud.target.clone().sub(fig.position); d.y = 0;
      const dist = d.length();
      let moving = dist > 0.25;
      const L = ud.limbs;
      if (moving) {
        const sp = ud.speed * (ud.sickTint ? 0.45 : 1) * dt;
        if (d.lengthSq() > sp * sp) fig.position.add(d.normalize().multiplyScalar(sp));
        else fig.position.copy(ud.target);
        fig.position.y = Math.abs(Math.sin(timeSec * 9 + ud.bobOff)) * 0.055;
        fig.rotation.y = Math.atan2(d.x, d.z);
        /* 走路：手脚交替摆动 */
        const sw = Math.sin(timeSec * 9 + ud.bobOff) * (ud.sickTint ? 0.25 : 0.55);
        L.legL.rotation.x = sw; L.legR.rotation.x = -sw;
        L.armL.rotation.x = -sw * 0.7; L.armR.rotation.x = sw * 0.7;
      } else {
        fig.position.y = ud.mode === 'work' ? Math.abs(Math.sin(timeSec * 7 + ud.bobOff)) * 0.04 : 0;
        if (ud.mode === 'work') {
          fig.rotation.y += Math.sin(timeSec * 3 + ud.bobOff) * 0.01;
          /* 干活：手臂小幅劳作摆动 */
          const wv = Math.sin(timeSec * 7 + ud.bobOff) * 0.3;
          L.armL.rotation.x = -wv; L.armR.rotation.x = -wv;
          L.legL.rotation.x *= 0.85; L.legR.rotation.x *= 0.85;
        } else {
          [L.legL, L.legR, L.armL, L.armR].forEach(p => { p.rotation.x *= 0.9; });
          if (ud.mode === 'wander' && ud.wait <= 0) ud.wait = rand(2, 6);
        }
      }
      if (ud.sickTint) fig.userData.fig._green = true;
    });
  }

  /* ============================================================
   * 相机控制
  ============================================================ */
  function bindControls() {
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('mousedown', e => {
      dragInfo = { mode: e.button === 0 ? 'rot' : 'pan', x: e.clientX, y: e.clientY, moved: 0 };
      canvas.classList.add('dragging');
    });
    window.addEventListener('mousemove', e => {
      if (!dragInfo) { handleHover(e); return; }
      const dx = e.clientX - dragInfo.x, dy = e.clientY - dragInfo.y;
      dragInfo.moved += Math.abs(dx) + Math.abs(dy);
      dragInfo.x = e.clientX; dragInfo.y = e.clientY;
      if (dragInfo.mode === 'rot') {
        camTheta -= dx * 0.0052;
        camPhi = Math.min(1.38, Math.max(0.22, camPhi + dy * 0.0042));
      } else {
        const s = camRadius * 0.0016;
        const fx = Math.sin(camTheta), fz = Math.cos(camTheta);
        camGoal.x += (-dx * fz * s) + (dy * fx * s);
        camGoal.z += (dx * fx * s) + (dy * fz * s);
        clampTarget();
      }
    });
    window.addEventListener('mouseup', e => {
      if (dragInfo && dragInfo.mode === 'rot' && dragInfo.moved < 6) handleClickPick(e);
      dragInfo = null;
      canvas.classList.remove('dragging');
    });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      camRadius = Math.min(90, Math.max(13, camRadius * Math.pow(1.0016, e.deltaY)));
    }, { passive: false });
    window.addEventListener('keydown', e => { keysDown[e.code] = true; });
    window.addEventListener('keyup', e => { keysDown[e.code] = false; });
  }

  function ndc(e) {
    return new THREE.Vector2(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1);
  }
  let hoverThrottle = 0;
  function pickKey(e) {
    raycaster.setFromCamera(ndc(e), camera);
    const hits = [];
    Object.values(buildings).forEach(rec => hits.push(rec.hit));
    const inter = raycaster.intersectObjects(hits, false);
    return inter.length ? inter[0].object.userData.key : null;
  }
  function handleHover(e) {
    const now = performance.now();
    if (now - hoverThrottle < 80) return;
    hoverThrottle = now;
    const k = pickKey(e);
    if (k !== hoveredKey) {
      hoveredKey = k;
      canvas.classList.toggle('hovering', !!k);
      if (k && buildings[k]) {
        hoverRing.visible = true;
        hoverRing.position.x = SLOTS[k][0]; hoverRing.position.z = SLOTS[k][1];
      } else hoverRing.visible = false;
    }
  }
  function handleClickPick(e) {
    const k = pickKey(e);
    onSelectCb(k);
  }

  function clampTarget() {
    camGoal.x = Math.min(26, Math.max(-26, camGoal.x));
    camGoal.z = Math.min(26, Math.max(-26, camGoal.z));
  }

  function focusOn(key) {
    if (key === 'wall') {
      /* 围墙没有槽位：把视线引向南侧墙环 */
      const r = WALL_R[(lastView && lastView.lvls && lastView.lvls.wall) || 1] || 20;
      camGoal.set(0, 0, r * 0.8);
      if (camRadius > 34) camRadius = 30;
      return;
    }
    if (key === 'bridge') { camGoal.set(-58, 0, 8); camRadius = Math.max(camRadius, 42); return; }
    if (key === 'lighthouse') { camGoal.set(-84, 0, 9); camRadius = Math.max(camRadius, 36); return; }
    if (!SLOTS[key]) return;
    camGoal.set(SLOTS[key][0] * 0.75, 0, SLOTS[key][1] * 0.75);
    if (camRadius > 30) camRadius = 26;
  }
  function resetCam() { camGoal.set(0, 0, 0); camRadius = 38; camTheta = 0.65; camPhi = 0.95; }

  /* ============================================================
   * 主循环视觉更新
  ============================================================ */
  const C_DAY = new THREE.Color('#b8d4ec'), C_NIGHT = new THREE.Color('#0a1526'),
    C_DUSK = new THREE.Color('#c97a5a'), C_BLIZ = new THREE.Color('#5f6d7d');
  const tmpC = new THREE.Color(), tmpC2 = new THREE.Color();

  function updateSky(view) {
    const p = view.phase01;
    const sunAng = p * Math.PI * 2 - Math.PI / 2;     // p=0 日出
    const sunY = Math.sin(sunAng);
    const daylight = Math.min(1, Math.max(0, sunY * 1.7 + 0.12));
    const duskAmt = Math.max(0, 1 - Math.abs(sunY) * 3.2) * 0.7;
    const bz = view.blizzard01;

    tmpC.copy(C_NIGHT).lerp(C_DAY, daylight);
    tmpC.lerp(C_DUSK, duskAmt * 0.55);
    tmpC.lerp(C_BLIZ, bz * 0.75);
    scene.background.copy(tmpC);

    const fogNear = lerp(36, 11, bz), fogFar = lerp(165, 46, bz);
    scene.fog.color.copy(tmpC);
    scene.fog.near = fogNear; scene.fog.far = fogFar;

    sunLight.position.set(Math.cos(sunAng) * 60, Math.max(4, sunY * 62 + 6), 24);
    sunLight.intensity = daylight * (1 - bz * 0.55) * 1.05;
    sunLight.color.set('#fff2df').lerp(tmpC2.set('#ffb98a'), duskAmt);
    moonLight.intensity = (1 - daylight) * 0.3 * (1 - bz * 0.6);
    hemiLight.intensity = 0.32 + daylight * 0.5 - bz * 0.1;
    hemiLight.color.copy(tmpC).lerp(tmpC2.set('#ffffff'), 0.5);

    starMat.opacity = (1 - daylight) * (1 - bz) * 0.9;
    starPts.visible = starMat.opacity > 0.02;

    const nightF = 1 - daylight;
    winMats.forEach(m => { m.emissiveIntensity = nightF * 1.15; });
    view.nightFactor = nightF;
  }

  function updateSnow(dt, view) {
    const bz = view.blizzard01;
    const pos = snowGeo.attributes.position.array;
    const cx = camGoal.x, cz = camGoal.z;
    const wind = lerp(1.6, 21, bz);
    const fall = lerp(1, 3.2, bz);
    for (let i = 0; i < snowVel.length / 2; i++) {
      let y = pos[i * 3 + 1] - snowVel[i * 2] * fall * dt;
      let x = pos[i * 3] + (wind + snowVel[i * 2 + 1]) * dt;
      let z = pos[i * 3 + 2] + Math.sin(timeSec * 0.7 + i) * 0.35 * dt * 8;
      if (y < 0) y = rand(38, 44);
      if (x > cx + 72) x = cx - 72; if (x < cx - 72) x = cx + 72;
      if (z > cz + 72) z = cz - 72; if (z < cz - 72) z = cz + 72;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    }
    snowGeo.attributes.position.needsUpdate = true;
    snowPts.material.opacity = lerp(0.7, 0.95, bz);
    snowPts.material.size = lerp(0.4, 0.55, bz);
  }

  function updateFurnaceFX(dt, view) {
    const rec = buildings['furnace'];
    const lit = view.coalLit && !view.gameOver;
    const inten = view.furnIntMul;
    firePts.visible = !!rec && lit;
    smokePts.visible = !!rec;
    heatRing.visible = !!rec && lit;
    if (!rec) return;
    const flick = 1 + Math.sin(timeSec * 21) * 0.18 + Math.sin(timeSec * 47) * 0.1;
    const light = rec.group.getObjectByName('fireLight');
    if (light) { light.intensity = lit ? (0.7 + inten * 0.7) * flick : 0.05; }

    const fp = fireGeo.attributes.position.array;
    for (let i = 0; i < fireLife.length; i++) {
      fireLife[i] += dt * (1.2 + inten * 0.8);
      if (fireLife[i] > 1) { fireLife[i] = 0; fp[i * 3] = rand(-0.4, 0.4); fp[i * 3 + 2] = rand(-0.4, 0.4); }
      fp[i * 3 + 1] = fireLife[i] * (1.6 + inten * 0.9);
      fp[i * 3] *= 0.985; fp[i * 3 + 2] *= 0.985;
    }
    fireGeo.attributes.position.needsUpdate = true;
    firePts.material.opacity = lit ? 0.85 * flick : 0;

    const sp = smokeGeo.attributes.position.array;
    for (let i = 0; i < smokeLife.length; i++) {
      smokeLife[i] += dt * 0.32;
      if (smokeLife[i] > 1) { smokeLife[i] = 0; sp[i * 3] = rand(-0.3, 0.3); sp[i * 3 + 2] = rand(-0.3, 0.3); }
      sp[i * 3 + 1] = 1.4 + smokeLife[i] * 7;
      sp[i * 3] += windDriftX(dt) ;
      sp[i * 3] += Math.sin(timeSec + i) * 0.12 * dt;
    }
    smokeGeo.attributes.position.needsUpdate = true;
    smokePts.material.opacity = lit ? 0.3 : 0.1;

    const hr = 2.6 + Math.sqrt(view.furnLvl) * 1.35 * (0.6 + inten * 0.55);
    heatRing.scale.set(hr, hr, 1);
    heatRing.position.x = SLOTS.furnace[0]; heatRing.position.z = SLOTS.furnace[1];
    heatRing.material.opacity = 0.1 + Math.sin(timeSec * 2.4) * 0.05 + inten * 0.04;
  }
  function windDriftX(dt) { return windCache * dt; }
  let windCache = 1.2;

  function updateMiscAnim(dt) {
    Object.values(buildings).forEach(rec => {
      const ember = rec.group.getObjectByName('ember');
      if (ember) ember.scale.setScalar(1 + Math.sin(timeSec * 12 + rec.group.id) * 0.25);
      const hook = rec.group.getObjectByName('hook');
      if (hook) hook.position.y = 1.7 + Math.sin(timeSec * 0.9 + rec.group.id) * 0.35;
      const gear = rec.group.getObjectByName('gear');
      if (gear) gear.rotation.z += dt * 0.8;
      const blade = rec.group.getObjectByName('blade');
      if (blade) blade.rotation.y += dt * 4.5;
      const flag = rec.group.getObjectByName('flag');
      if (flag) flag.rotation.y = Math.sin(timeSec * 2.2) * 0.35;
      const beacon = rec.group.getObjectByName('beacon');
      if (beacon) { const on = Math.sin(timeSec * 3) > 0; beacon.scale.setScalar(on ? 1.4 : 0.6); }
      const plane = rec.group.getObjectByName('plane');
      if (plane) plane.position.y = 0.42 + Math.abs(Math.sin(timeSec * 0.8)) * 0.06;
      const rotor = rec.group.getObjectByName('rotor');
      if (rotor) rotor.rotation.z += dt * 2.2;
      const valve = rec.group.getObjectByName('valve');
      if (valve) valve.rotation.y += dt * 1.4;
      const steamPuffs = [];
      rec.group.traverse(o => { if (o.name === 'steam') steamPuffs.push(o); });
      steamPuffs.forEach(p => {
        const t0 = timeSec * 1.1 + p.userData.puffOff;
        p.position.y += dt * 0.32;
        p.material.opacity = Math.max(0, 0.34 - (p.position.y - 2.75) * 0.09);
        if (p.position.y > 4.4) { p.position.y = 2.75; }
        void t0;
      });
    });
    /* 灯塔光束旋转 */
    if (lightGroup) {
      const beam = lightGroup.getObjectByName('beam');
      if (beam) beam.rotation.y += dt * 0.55;
    }
    Object.values(ghosts).forEach(gh => {
      gh.material.opacity = 0.1 + Math.sin(timeSec * 2) * 0.06;
    });
    if (hoverRing.visible) hoverRing.rotation.z += dt * 0.5;
    if (selectRing.visible) selectRing.rotation.z -= dt * 0.4;
  }

  function updateCamera(dt) {
    const panSpd = camRadius * 0.55 * dt;
    const fx = Math.sin(camTheta), fz = Math.cos(camTheta);
    if (keysDown['KeyW'] || keysDown['ArrowUp']) { camGoal.x -= fx * panSpd; camGoal.z -= fz * panSpd; }
    if (keysDown['KeyS'] || keysDown['ArrowDown']) { camGoal.x += fx * panSpd; camGoal.z += fz * panSpd; }
    if (keysDown['KeyA'] || keysDown['ArrowLeft']) { camGoal.x -= fz * panSpd; camGoal.z += fx * panSpd; }
    if (keysDown['KeyD'] || keysDown['ArrowRight']) { camGoal.x += fz * panSpd; camGoal.z -= fx * panSpd; }
    clampTarget();
    camTarget.lerp(camGoal, Math.min(1, dt * 5));
    camera.position.set(
      camTarget.x + Math.cos(camPhi) * Math.sin(camTheta) * camRadius,
      camTarget.y + Math.sin(camPhi) * camRadius,
      camTarget.z + Math.cos(camPhi) * Math.cos(camTheta) * camRadius);
    camera.lookAt(camTarget.x, 0.5, camTarget.z);
  }

  function updateScaffold(view) {
    if (!scaffold || !view.queue || scaffold.key !== view.queue.key) return;
    const q = view.queue;
    const p = q.total > 0 ? Math.min(1, 1 - q.remain / q.total) : 0;
    scaffold.box.scale.y = 0.12 + p * 0.88;
    scaffold.box.position.y = (HIT_SIZE[q.key][1] * 0.8) * scaffold.box.scale.y / 2;
  }

  function update(dt, view) {
    if (!webglOK) return;
    dt = Math.min(dt, 0.1);
    timeSec += dt;
    view.nightFactor = 0;
    updateSky(view);
    windCache = lerp(1.4, 22, view.blizzard01) * 0.55;
    updateSnow(dt, view);
    updateFurnaceFX(dt, view);
    updateFigures(dt, view);
    updateMiscAnim(dt);
    /* 海面波纹流动 */
    if (seaTex) {
      seaTex.offset.x += dt * 0.0085;
      seaTex.offset.y += dt * 0.0052;
    }
    /* 冰海浮冰起伏 */
    for (let i = 0; i < floes.length; i++) {
      const m = floes[i];
      if (m.userData.baseY !== undefined)
        m.position.y = m.userData.baseY + Math.sin(timeSec * 0.6 + i * 1.7) * (m.userData.bobAmp || 0.05);
    }
    updateRings();
    updateScaffold(view);
    updateCamera(dt);
    renderer.render(scene, camera);
  }

  return {
    init, sync, update, focusOn, resetCam, setSelected,
    get ok() { return webglOK; },
    /* 调试探针：查询 (x,z) 处地形高度与是否盖过水面 */
    debugProbe(x, z) {
      if (!groundMesh) return { terrainY: NaN, seaY: -1.35, covered: false };
      const pos = groundMesh.geometry.attributes.position;
      let bx = 0, by = 0, bz = 0, bd = Infinity;
      for (let i = 0; i < pos.count; i++) {
        const dx = pos.getX(i) - x, dz = pos.getZ(i) - z;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; bx = pos.getX(i); by = pos.getY(i); bz = pos.getZ(i); }
      }
      return { x: bx, z: bz, terrainY: by, seaY: -1.35, covered: by > -1.35 };
    },
  };
})();
