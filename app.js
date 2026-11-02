/* ============================================================================
   一笔一画 · 汉字手写动画
   ----------------------------------------------------------------------------
   每个字用楷体笔画轮廓（strokes）+ 运笔中线（medians）还原：
   把中线加粗到笔画宽度，再用「描边虚线」一点点揭开，最后用轮廓裁掉多余部分，
   得到的就是这笔字真正的形状；再用时间曲线、起收笔停顿和轻微抖动让它像人写的。
   ============================================================================ */

(function () {
  'use strict';

  /* ---------------- 版式常量 ---------------- */

  const CELL = 104;        // 竖排时的字格边长
  const COL_GAP = 10;      // 栏与栏的间距
  const ROW_GAP = 7;       // 同一栏里字与字的间距
  const PAD = 64;          // 纸内边距
  const MAX_ROWS = 10;     // 一栏最多写几格（含标点）
  const MOBILE_PAD = 26;   // 横排时的纸内边距

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const PUNCT = new Set(['，', '。', '、', '；', '：', '？', '！', '·']);
  const INKS = ['#1b1510', '#211a13', '#171310', '#1e1711'];
  const GUIDE_SVG =
    '<svg class="guide" viewBox="0 0 100 100" aria-hidden="true">' +
    '<rect x="3" y="3" width="94" height="94"/>' +
    '<line x1="50" y1="3" x2="50" y2="97"/>' +
    '<line x1="3" y1="50" x2="97" y2="50"/>' +
    '<line class="diag" x1="4" y1="4" x2="96" y2="96"/>' +
    '<line class="diag" x1="96" y1="4" x2="4" y2="96"/>' +
    '</svg>';

  /* ---------------- 小工具 ---------------- */

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const $ = (id) => document.getElementById(id);

  const els = {
    stage: $('stage'),
    scroll: $('scroll'),
    paper: $('paper'),
    text: $('text'),
    colophon: $('colophon'),
    sig: $('sig'),
    seal: $('seal'),
    player: $('player'),
    hud: $('hud'),
    timeRange: $('timeRange'),
    timecode: $('timecode'),
    btnSave: $('btnSave'),
    fontSelect: $('fontSelect'),
    modes: $('modes'),
    scene: $('scene'),
    sceneSelect: $('sceneSelect'),
    sealMenu: $('sealMenu'),
    sealGrid: $('sealGrid'),
    sealForm: $('sealForm'),
    sealInput: $('sealInput'),
    sealOff: $('sealOff'),
    btnColor: $('btnColor'),
    colorDot: $('colorDot'),
    colorMenu: $('colorMenu'),
    colorGrid: $('colorGrid'),
    colorInput: $('colorInput'),
    quickOpen: $('quickOpen'),
    mobileBar: $('mobileBar'),
    mReplay: $('mReplay'),
    mPause: $('mPause'),
    mMore: $('mMore'),
    sheet: $('sheet'),
    sheetBackdrop: $('sheetBackdrop'),
    sheetPanel: $('sheetPanel'),
    sheetBody: $('sheetBody'),
    sheetClose: $('sheetClose'),
    btnRead: $('btnRead'),
    btnLens: $('btnLens'),
    mLens: $('mLens'),
    speechMenu: $('speechMenu'),
    speechToggle: $('speechToggle'),
    voiceSelect: $('voiceSelect'),
    speechRate: $('speechRate'),
    speechTest: $('speechTest'),
    speechNote: $('speechNote'),
    quick: $('quick'),
    quickText: $('quickText'),
    quickGo: $('quickGo'),
    quickMore: $('quickMore'),
    toast: $('toast'),
    loading: $('loading'),
    compose: $('compose'),
    cTitle: $('cTitle'),
    cAuthor: $('cAuthor'),
    cText: $('cText'),
    cStatus: $('cStatus'),
    cGo: $('cGo'),
    cCancel: $('cCancel'),
    btnReplay: $('btnReplay'),
    btnPause: $('btnPause'),
    speedRange: $('speedRange'),
    speedVal: $('speedVal'),
    btnGrid: $('btnGrid'),
    btnSound: $('btnSound'),
    poemSelect: $('poemSelect')
  };

  const state = {
    poemId: 'sushi',
    poem: null,
    blocks: [],
    timeline: null,
    t: 0,
    playing: false,
    raf: 0,
    lastTs: 0,
    startAt: 0,
    audioIndex: 0,
    scrubbing: false,
    lastCode: '',
    customPoem: null,
    customRaw: '',
    fontList: [],
    fontId: 'kai',
    fontFamily: '',
    fontShown: false,
    mode: 'write',
    scene: 'zhu',
    seal: undefined,
    ink: null,
    lens: true,
    speech: {
      supported: false,
      enabled: false,
      segments: [],
      next: 0,
      voices: [],
      voiceName: '',
      rate: 1
    },
    speed: 1.0,
    vertical: true,
    paperW: 0,
    paperH: 0
  };

  let uid = 0;

  /* ---------------- 笔画几何 ---------------- */

  function polyLength(pts) {
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
      len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    }
    return len;
  }

  // 把起笔点沿反方向延长，让虚线从字形外开始，起笔不会先冒出一块墨
  function extendStart(pts, dist) {
    if (pts.length < 2) return pts.slice();
    const [x0, y0] = pts[0];
    const [x1, y1] = pts[1];
    const dx = x0 - x1;
    const dy = y0 - y1;
    const len = Math.hypot(dx, dy) || 1;
    return [[x0 + (dx / len) * dist, y0 + (dy / len) * dist], ...pts];
  }

  function pointAt(pts, dist) {
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - pts[i - 1][0];
      const dy = pts[i][1] - pts[i - 1][1];
      const seg = Math.hypot(dx, dy);
      if (acc + seg >= dist) {
        const t = seg ? (dist - acc) / seg : 0;
        return [pts[i - 1][0] + dx * t, pts[i - 1][1] + dy * t];
      }
      acc += seg;
    }
    const last = pts[pts.length - 1];
    return [last[0], last[1]];
  }

  function pathD(pts) {
    return pts
      .map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1))
      .join(' ');
  }

  const glyphCache = new Map();
  function glyphOf(ch) {
    if (glyphCache.has(ch)) {
      const cached = glyphCache.get(ch);
      if (cached) return cached;
    }
    const raw = window.HANZI_STROKES && window.HANZI_STROKES[ch];
    if (!raw || !raw.strokes || !raw.strokes.length) return null;
    const strokes = raw.strokes.map((outline, i) => {
      const med = raw.medians[i] || [];
      const ext = extendStart(med, 100);
      return {
        outline,
        d: pathD(ext),
        pts: ext,
        len: Math.max(140, polyLength(ext)),
        medLen: polyLength(med)
      };
    });
    const data = { ch, strokes };
    glyphCache.set(ch, data);
    return data;
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (const key in attrs) el.setAttribute(key, attrs[key]);
    }
    return el;
  }

  /* ---------------- 造格子 ---------------- */

  function makeCharCell(ch, size) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.style.width = size + 'px';
    cell.style.height = size + 'px';
    cell.style.setProperty('--s', size + 'px');
    cell.innerHTML = GUIDE_SVG;

    const data = glyphOf(ch);
    if (!data) {
      const span = document.createElement('span');
      span.className = 'fallback';
      span.textContent = ch;
      cell.appendChild(span);
      return { kind: 'char', ch, el: cell, strokes: [], fallback: true };
    }

    const svg = svgEl('svg', {
      class: 'glyph',
      viewBox: '-80 -80 1184 1184',
      role: 'img',
      'aria-label': ch
    });
    const defs = svgEl('defs');
    const inkGroup = svgEl('g', { class: 'ink', filter: 'url(#inkTexture)' });
    const flip = svgEl('g', { transform: 'translate(0,1024) scale(1,-1)' });
    const tipLayer = svgEl('g', { transform: 'translate(0,1024) scale(1,-1)' });

    const strokes = data.strokes.map((s) => {
      const clipId = 'ink' + ++uid;
      const clip = svgEl('clipPath', { id: clipId });
      clip.appendChild(svgEl('path', { d: s.outline }));
      defs.appendChild(clip);

      const path = svgEl('path', {
        d: s.d,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '200',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'miter',
        'clip-path': 'url(#' + clipId + ')',
        'stroke-dasharray': s.len + ' ' + s.len * 3,
        'stroke-dashoffset': s.len
      });
      flip.appendChild(path);
      return { len: s.len, medLen: s.medLen, pts: s.pts, el: path };
    });

    const tip = svgEl('circle', {
      class: 'tip',
      cx: '-300',
      cy: '-300',
      r: '150',
      fill: 'url(#tipGrad)'
    });
    tipLayer.appendChild(tip);

    const bead = svgEl('circle', {
      class: 'bead',
      cx: '-300',
      cy: '-300',
      r: '34',
      fill: 'url(#beadGrad)',
      opacity: '0'
    });
    const beadGlint = svgEl('circle', {
      class: 'bead-glint',
      cx: '-300',
      cy: '-300',
      r: '8',
      fill: '#fff7e8',
      opacity: '0'
    });
    const spray = svgEl('g', { class: 'spray', 'aria-hidden': 'true' });
    const sprayIn = svgEl('g', { class: 'spray-in' });
    for (let i = 0; i < 7; i++) {
      const ang = rand(0, Math.PI * 2);
      const dist = rand(36, 122);
      sprayIn.appendChild(
        svgEl('circle', {
          cx: (Math.cos(ang) * dist).toFixed(1),
          cy: (Math.sin(ang) * dist).toFixed(1),
          r: rand(3, 8).toFixed(1),
          fill: 'currentColor',
          opacity: rand(0.35, 0.75).toFixed(2)
        })
      );
    }
    spray.appendChild(sprayIn);
    tipLayer.append(bead, beadGlint, spray);

    inkGroup.appendChild(flip);

    // 毛笔模式的小笔（笔尖在 (0,0)，笔杆朝右上）
    const brushLayer = svgEl('g', {
      class: 'brush-layer',
      'aria-hidden': 'true',
      opacity: '0'
    });
    brushLayer.appendChild(
      svgEl('path', {
        d: 'M -30 7 C -33 -18 -16 -38 0 -38 C 16 -38 33 -18 30 7 C 14 16 -14 16 -30 7 Z',
        fill: '#241b12'
      })
    );
    brushLayer.appendChild(
      svgEl('rect', { x: '-25', y: '-92', width: '50', height: '58', rx: '5', fill: '#b48d5c' })
    );
    brushLayer.appendChild(
      svgEl('path', {
        d: 'M -18 -92 L -11 -560 Q 0 -580 11 -560 L 18 -92 Z',
        fill: '#7b5a36'
      })
    );

    // 写完后的字帖字体（逐笔动画仍是楷书数据）
    const fontGroup = svgEl('g', {
      class: 'font-glyph',
      filter: 'url(#inkTexture)',
      opacity: '0',
      'aria-hidden': 'true'
    });
    const fontText = svgEl('text', {
      x: '512',
      y: '1002',
      'font-size': '920',
      'text-anchor': 'middle',
      fill: 'currentColor',
      'font-family': state.fontFamily || '"Kaiti SC", serif'
    });
    fontText.textContent = ch;
    fontGroup.appendChild(fontText);

    svg.append(defs, inkGroup, fontGroup, tipLayer, brushLayer);
    const jitter = {
      tx: rand(-1.4, 1.4),
      ty: rand(-1.4, 1.4),
      rot: rand(-0.8, 0.8),
      scale: rand(0.975, 1.025)
    };
    svg.__jitter = jitter;
    svg.style.color = inkForGlyph();
    svg.style.transform =
      'translate(' + jitter.tx.toFixed(2) + 'px,' + jitter.ty.toFixed(2) + 'px) ' +
      'rotate(' + jitter.rot.toFixed(2) + 'deg) ' +
      'scale(' + jitter.scale.toFixed(3) + ')';
    cell.appendChild(svg);

    return {
      kind: 'char',
      ch,
      el: cell,
      svg,
      strokes,
      tip,
      brush: brushLayer,
      bead,
      beadGlint,
      spray,
      lastStroke: -1
    };
  }

  function makePunctCell(ch, size, compact) {
    const cell = document.createElement('div');
    cell.className = 'cell punct';
    cell.style.width = (compact ? size * 0.58 : size) + 'px';
    cell.style.height = size + 'px';
    cell.style.setProperty('--s', size + 'px');
    const span = document.createElement('span');
    span.textContent = ch;
    cell.appendChild(span);
    return { kind: 'punct', ch, el: cell };
  }

  function makeSep(size) {
    const cell = document.createElement('div');
    cell.className = 'cell sep';
    cell.style.width = Math.max(14, size) + 'px';
    cell.style.height = Math.max(18, size * 1.15) + 'px';
    cell.style.setProperty('--s', size + 'px');
    const span = document.createElement('span');
    span.textContent = '·';
    cell.appendChild(span);
    return { kind: 'sep', el: cell };
  }

  /* ---------------- 篇目排版 ---------------- */

  function splitLine(line, cell, compactPunct) {
    const items = [];
    for (const ch of line.text) {
      items.push(
        PUNCT.has(ch) ? makePunctCell(ch, cell, compactPunct) : makeCharCell(ch, cell)
      );
    }
    const last = items[items.length - 1];
    if (last) {
      last.lineEnd = line.poemEnd ? 'poem' : line.partEnd ? 'part' : 'line';
    }
    return items;
  }

  function titleItems(poem, cell) {
    const items = [];
    const main = cell * 0.92;
    const sub = cell * 0.68;
    for (const ch of poem.title) items.push(makeCharCell(ch, main));
    if (poem.subtitle && poem.subtitle.length) {
      items.push(makeSep(cell * 0.34));
      for (const ch of poem.subtitle) items.push(makeCharCell(ch, sub));
    }
    return items;
  }

  function buildBlocks(poem, cell, vertical) {
    const blocks = [];
    const head = titleItems(poem, cell);
    if (head.length) blocks.push({ items: head, pause: 380, title: true });
    const lines = poem.lines.map((line) => splitLine(line, cell, !vertical));

    if (vertical) {
      let cur = [];
      let rows = 0;
      const flush = (pause) => {
        if (!cur.length) return;
        blocks.push({ items: cur, pause });
        cur = [];
        rows = 0;
      };
      for (const items of lines) {
        if (cur.length && rows + items.length > MAX_ROWS) flush(300);
        cur.push(...items);
        rows += items.length;
        const end = items[items.length - 1].lineEnd;
        if (end === 'part') flush(300);
      }
      flush(300);
    } else {
      for (const items of lines) {
        const end = items[items.length - 1].lineEnd;
        blocks.push({ items, pause: 0 });
      }
    }
    return blocks;
  }

  function mobileCell(poem) {
    let maxItems = 0;
    for (const line of poem.lines) maxItems = Math.max(maxItems, [...line.text].length);
    const titleLen = poem.title.length + 2 + (poem.subtitle ? poem.subtitle.length + 1 : 0);
    maxItems = Math.max(maxItems, titleLen, 6);
    const targetW = Math.min(window.innerWidth * 0.94, 640);
    const cell = Math.floor((targetW - MOBILE_PAD * 2 - (maxItems - 1) * 2) / maxItems);
    return clamp(cell, 24, 58);
  }

  /* ---------------- 纸张纹理 ---------------- */

  function paintPaper(mode) {
    const raw = mode === 'brush' || mode === 'ink';
    const S = 512;
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const g = canvas.getContext('2d');
    g.fillStyle = raw ? '#f2e6cf' : '#f7f0de';
    g.fillRect(0, 0, S, S);

    // 淡淡的水渍
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * S;
      const y = Math.random() * S;
      const r = rand(36, 150);
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(196,169,122,' + rand(0.02, 0.05).toFixed(3) + ')');
      grd.addColorStop(1, 'rgba(196,169,122,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }

    // 纸筋
    const fibers = raw ? 1450 : 950;
    for (let i = 0; i < fibers; i++) {
      const x = Math.random() * S;
      const y = Math.random() * S;
      const len = rand(3, raw ? 34 : 26);
      const ang = rand(-0.18, 0.18) + (Math.random() < 0.5 ? 0 : Math.PI / 2);
      g.strokeStyle = 'rgba(150,120,78,' + rand(0.03, 0.085).toFixed(3) + ')';
      g.lineWidth = rand(0.5, 1);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      g.stroke();
    }

    // 细颗粒
    const img = g.getImageData(0, 0, S, S);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 12;
      d[i] = clamp(d[i] + n, 0, 255);
      d[i + 1] = clamp(d[i + 1] + n, 0, 255);
      d[i + 2] = clamp(d[i + 2] + n * 0.8, 0, 255);
    }
    g.putImageData(img, 0, 0);

    els.paper.style.setProperty('--grain', 'url(' + canvas.toDataURL('image/png') + ')');
  }

  /* ---------------- 时间轴 ---------------- */

  const strokeEase = (t) => 1 - Math.pow(1 - t, 2.2);

  /* ---------------- 笔触声 ---------------- */

  const audio = {
    enabled: true,
    ctx: null,
    noise: null,
    init() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
      } catch (e) {
        return;
      }
      const rate = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, Math.floor(rate * 1.2), rate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < d.length; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.045 * white) / 1.045;
        d[i] = last * 3.1;
      }
      this.noise = buf;
    },
    stroke(durationMs) {
      if (!this.enabled) return;
      this.init();
      const ctx = this.ctx;
      if (!ctx || !this.noise || ctx.state !== 'running') return;
      const t0 = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.playbackRate.value = rand(0.85, 1.15);
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = rand(900, 2500);
      band.Q.value = rand(0.7, 1.5);
      const high = ctx.createBiquadFilter();
      high.type = 'highpass';
      high.frequency.value = 420;
      const gain = ctx.createGain();
      const dur = clamp(durationMs / 1000, 0.08, 0.4);
      const peak = rand(0.018, 0.045);
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(peak, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0008, t0 + dur + 0.14);
      src.connect(band).connect(high).connect(gain).connect(ctx.destination);
      src.start(t0, rand(0, 0.7), dur + 0.25);
    }
  };

  /* ---------------- 写字 ---------------- */

  function buildTimeline(blocks) {
    let t = 0;
    const chars = [];
    const marks = [];
    const events = [];

    blocks.forEach((block) => {
      block.items.forEach((item) => {
        if (item.kind === 'char') {
          if (!item.strokes.length) {
            chars.push({
              item,
              el: item.el,
              strokes: [],
              t0: t,
              t1: t + 200,
              state: 'hidden',
              tip: null,
              brush: item.brush || null,
              bead: item.bead || null,
              beadGlint: item.beadGlint || null,
              spray: item.spray || null,
              lastStroke: -1,
              fallback: true
            });
            t += 200;
          } else {
            // 笔画多的字，落笔前先“想一想”
            if (item.strokes.length >= 12 && Math.random() < 0.55) t += rand(180, 420);
            const t0 = t;
            const strokes = [];
            for (let i = 0; i < item.strokes.length; i++) {
              // 换笔之间偶尔停一下，像在找下一笔的落点
              if (i > 0 && Math.random() < 0.3) t += rand(30, 90);
              const s = item.strokes[i];
              const dur = clamp(135 + s.len * 0.19, 160, 560) * rand(0.9, 1.1);
              strokes.push({
                el: s.el,
                len: s.len,
                pts: s.pts,
                medLen: s.medLen,
                start: t,
                dur
              });
              events.push({ t, dur });
              t += dur;
              t += rand(55, 115);
            }
            const last = strokes[strokes.length - 1];
            chars.push({
              item,
              el: item.el,
              strokes,
              t0,
              t1: last.start + last.dur,
              state: 'hidden',
              tip: item.tip,
              brush: item.brush || null,
              bead: item.bead || null,
              beadGlint: item.beadGlint || null,
              spray: item.spray || null,
              lastStroke: -1,
              fallback: false
            });
            t += rand(200, 330);
          }
        } else {
          const span = item.el.querySelector('span');
          const dur = item.kind === 'sep' ? 110 : 150;
          marks.push({
            item,
            span,
            t0: t,
            dur,
            k: -1,
            base: item.kind === 'sep' ? 0.75 : 0.72
          });
          t += dur;
        }

        const end = item.lineEnd;
        if (end === 'part') t += 1600;
        else if (end === 'poem') t += 800;
        else if (end === 'line') t += 650;
      });
      if (block.pause) t += block.pause;
    });

    const colophonT0 = t;
    const sealT0 = t + 520;
    return { duration: sealT0 + 500, chars, marks, events, colophonT0, sealT0 };
  }

  function activeTip(c, t) {
    for (const s of c.strokes) {
      if (t >= s.start && t < s.start + s.dur) {
        const dist = strokeEase((t - s.start) / s.dur) * s.len - 100;
        if (dist <= 0) return null;
        const medLen = Math.max(1, s.medLen);
        const q = Math.min(1, dist / medLen);
        const pt = pointAt(s.pts, 100 + q * medLen);
        return { x: pt[0], y: pt[1], opacity: 0.85 };
      }
    }
    return null;
  }

  // 把任意时刻的画面算出来：所有笔画的 dashoffset、标点、落款、印章都由 t 决定
  function renderAt(t) {
    const tl = state.timeline;
    if (!tl) return;
    t = clamp(t, 0, tl.duration);

    tl.chars.forEach((c) => {
      if (t >= c.t1) {
        if (c.state !== 'done') {
          c.state = 'done';
          c.el.classList.remove('writing');
          c.el.classList.add('done');
          if (c.tip) c.tip.style.opacity = '0';
          if (c.brush) c.brush.style.opacity = '0';
          if (c.bead) c.bead.style.opacity = '0';
          if (c.beadGlint) c.beadGlint.style.opacity = '0';
          if (c.spray) c.spray.classList.remove('go');
          c.lastStroke = -1;
          c.strokes.forEach((s) => (s.el.style.strokeDashoffset = '0'));
        }
      } else if (t >= c.t0) {
        if (c.state !== 'writing') {
          c.state = 'writing';
          c.el.classList.add('writing');
          c.el.classList.remove('done');
        }
        c.strokes.forEach((s) => {
          const p = clamp((t - s.start) / s.dur, 0, 1);
          s.el.style.strokeDashoffset = (s.len * (1 - strokeEase(p))).toFixed(1);
        });
        if (c.tip) {
          const tip = activeTip(c, t);
          if (tip) {
            c.tip.setAttribute('cx', tip.x.toFixed(1));
            c.tip.setAttribute('cy', tip.y.toFixed(1));
            c.tip.style.opacity = String(tip.opacity);
            if (c.brush) {
              if (state.mode === 'brush' || state.mode === 'ink') {
                c.brush.setAttribute(
                  'transform',
                  'translate(' + tip.x.toFixed(1) + ' ' + (1024 - tip.y).toFixed(1) + ') rotate(38)'
                );
                c.brush.style.opacity = String(clamp(tip.opacity * 0.92, 0, 1));
              } else {
                c.brush.style.opacity = '0';
              }
            }
            if (c.bead) {
              c.bead.setAttribute('cx', tip.x.toFixed(1));
              c.bead.setAttribute('cy', tip.y.toFixed(1));
              c.bead.style.opacity = String(clamp(tip.opacity * 0.96, 0, 1));
            }
            if (c.beadGlint) {
              c.beadGlint.setAttribute('cx', (tip.x - 9).toFixed(1));
              c.beadGlint.setAttribute('cy', (tip.y + 8).toFixed(1));
              c.beadGlint.style.opacity = String(clamp(tip.opacity * 0.55, 0, 1));
            }
            if (c.spray) {
              let cur = null;
              for (let i = 0; i < c.strokes.length; i++) {
                const st = c.strokes[i];
                if (t >= st.start && t <= st.start + st.dur) {
                  cur = i;
                  break;
                }
              }
              if (cur !== null && cur !== c.lastStroke) {
                c.lastStroke = cur;
                const pts = c.strokes[cur].pts;
                if (pts && pts[0]) {
                  c.spray.setAttribute(
                    'transform',
                    'translate(' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1) + ')'
                  );
                  c.spray.classList.remove('go');
                  void c.spray.getBoundingClientRect();
                  c.spray.classList.add('go');
                }
              }
            }
          } else {
            c.tip.style.opacity = '0';
            if (c.brush) c.brush.style.opacity = '0';
            if (c.bead) c.bead.style.opacity = '0';
            if (c.beadGlint) c.beadGlint.style.opacity = '0';
          }
        }
      } else if (c.state !== 'hidden') {
        c.state = 'hidden';
        c.el.classList.remove('writing', 'done');
        if (c.tip) c.tip.style.opacity = '0';
        if (c.brush) c.brush.style.opacity = '0';
        if (c.bead) c.bead.style.opacity = '0';
        if (c.beadGlint) c.beadGlint.style.opacity = '0';
        if (c.spray) c.spray.classList.remove('go');
        c.lastStroke = -1;
        c.strokes.forEach((s) => (s.el.style.strokeDashoffset = String(s.len)));
      }
    });

    tl.marks.forEach((m) => {
      const k = clamp((t - m.t0) / m.dur, 0, 1);
      if (Math.abs(k - m.k) < 0.002 && k !== 0 && k !== 1) return;
      m.k = k;
      if (!m.span) return;
      m.span.style.opacity = (m.base * k).toFixed(3);
      m.span.style.transform =
        k >= 1 ? 'none' : 'translateY(' + (-3 * (1 - k)).toFixed(2) + 'px)';
    });

    const ck = clamp((t - tl.colophonT0) / 700, 0, 1);
    els.colophon.style.opacity = ck.toFixed(3);
    els.colophon.style.transform =
      ck >= 1 ? 'none' : 'translateY(' + (8 * (1 - ck)).toFixed(2) + 'px)';

    const sk = clamp((t - tl.sealT0) / 500, 0, 1);
    let scale;
    let op;
    if (sk <= 0) {
      scale = 1.45;
      op = 0;
    } else if (sk < 0.55) {
      const u = sk / 0.55;
      scale = 1.45 - 0.5 * u;
      op = 0.94 * u;
    } else {
      const u = (sk - 0.55) / 0.45;
      scale = 0.95 + 0.05 * u;
      op = 0.94 - 0.04 * u;
    }
    els.seal.style.opacity = op.toFixed(3);
    els.seal.style.transform = 'rotate(-3deg) scale(' + scale.toFixed(3) + ')';

    document.body.classList.toggle('finished', t >= tl.duration - 1);
    applyFontDisplay();
    updateSheen();
  }

  /* ---------------- 播放 ---------------- */

  function formatClock(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  }

  function updateTimeUI(t) {
    const tl = state.timeline;
    if (!tl || !els.timeRange) return;
    const p = tl.duration ? t / tl.duration : 0;
    if (!state.scrubbing) els.timeRange.value = p;
    els.timeRange.style.setProperty('--p', (p * 100).toFixed(2) + '%');
    const code = formatClock(t) + ' / ' + formatClock(tl.duration);
    if (code !== state.lastCode) {
      els.timecode.textContent = code;
      state.lastCode = code;
    }
  }

  function firstEventAfter(t) {
    const evs = state.timeline ? state.timeline.events : [];
    for (let i = 0; i < evs.length; i++) if (evs[i].t > t) return i;
    return evs.length;
  }

  function seek(t) {
    const tl = state.timeline;
    if (!tl) return;
    state.t = clamp(t, 0, tl.duration);
    state.audioIndex = firstEventAfter(state.t);
    renderAt(state.t);
    updateTimeUI(state.t);
    resetSpeechAt(state.t);
  }

  function fireAudio(prev, next) {
    const tl = state.timeline;
    if (!tl) return;
    const evs = tl.events;
    while (state.audioIndex < evs.length && evs[state.audioIndex].t <= next) {
      const ev = evs[state.audioIndex];
      if (ev.t > prev) audio.stroke(ev.dur / state.speed);
      state.audioIndex++;
    }
  }

  function tick(now) {
    state.raf = 0;
    if (!state.playing) return;
    if (state.startAt && now < state.startAt) {
      state.lastTs = now;
      state.raf = requestAnimationFrame(tick);
      return;
    }
    if (state.scrubbing) {
      state.lastTs = now;
      state.raf = requestAnimationFrame(tick);
      return;
    }
    const tl = state.timeline;
    const dt = Math.min(80, now - state.lastTs);
    state.lastTs = now;
    const prev = state.t;
    state.t = Math.min(tl.duration, state.t + dt * state.speed);
    fireAudio(prev, state.t);
    renderAt(state.t);
    updateTimeUI(state.t);
    speechTick(state.t);
    if (state.t >= tl.duration) {
      state.playing = false;
      setPausedLabel(false);
      return;
    }
    state.raf = requestAnimationFrame(tick);
  }

  function play(delay) {
    const tl = state.timeline;
    if (!tl || state.playing) return;
    if (state.t >= tl.duration - 1) seek(0);
    state.playing = true;
    setPausedLabel(false);
    state.lastTs = performance.now();
    state.startAt = delay ? performance.now() + delay : 0;
    state.raf = requestAnimationFrame(tick);
  }

  function pause() {
    if (!state.playing) return;
    state.playing = false;
    if (state.raf) {
      cancelAnimationFrame(state.raf);
      state.raf = 0;
    }
    setPausedLabel(true);
  }

  function togglePause(force) {
    if (!state.timeline) return;
    const shouldPause = force !== undefined ? force : state.playing;
    if (shouldPause) {
      pause();
      if (hasSpeech && state.speech.enabled) Speech.pause();
    } else {
      play(0);
      if (hasSpeech && state.speech.enabled) Speech.resume();
    }
  }

  function cancelPlayback() {
    state.playing = false;
    if (state.raf) {
      cancelAnimationFrame(state.raf);
      state.raf = 0;
    }
    state.scrubbing = false;
  }

  function isFinished() {
    return !!state.timeline && state.t >= state.timeline.duration - 1;
  }

  /* ---------------- 建纸 / 布局 ---------------- */

  function chooseVertical() {
    if (window.matchMedia('(max-height: 520px) and (orientation: landscape)').matches) return false;
    if (window.innerWidth < 760) return window.innerHeight >= window.innerWidth;
    return window.innerWidth / window.innerHeight >= 1.0;
  }

  const SEALS = ['墨戲', '心畫', '清歡', '聽雨', '自在', '守拙'];

  function currentSealText(poem) {
    if (typeof state.seal === 'string') return state.seal;
    return (poem && poem.seal) || '墨戲';
  }

  function applySeal(poem) {
    if (!els.seal) return;
    const text = currentSealText(poem);
    const chars = [...String(text || '')].slice(0, 2);
    els.seal.innerHTML = '';
    els.seal.classList.remove('off', 'one', 'two');
    if (!chars.length) {
      els.seal.classList.add('off');
      els.seal.setAttribute('aria-label', '加印章，点击选择');
      els.seal.setAttribute('title', '点击加印章');
      return;
    }
    els.seal.classList.add(chars.length === 1 ? 'one' : 'two');
    els.seal.setAttribute('title', '点击换印章');
    chars.forEach((ch) => {
      const span = document.createElement('span');
      span.textContent = ch;
      els.seal.appendChild(span);
    });
    els.seal.setAttribute('aria-label', '印章：' + chars.join('') + '，点击更换');
  }

  function buildSealMenu() {
    if (!els.sealGrid) return;
    els.sealGrid.innerHTML = '';
    SEALS.forEach((text) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'seal-chip';
      b.dataset.seal = text;
      b.setAttribute('aria-label', '印章 ' + text);
      [...text].forEach((ch) => {
        const sp = document.createElement('span');
        sp.textContent = ch;
        b.appendChild(sp);
      });
      b.addEventListener('click', () => setSeal(text));
      els.sealGrid.appendChild(b);
    });
  }

  function updateSealMenu() {
    const text = currentSealText(state.poem);
    [...els.sealGrid.children].forEach((b) => {
      b.classList.toggle('on', b.dataset.seal === text);
    });
    els.sealOff.classList.toggle('on', text === '');
    els.sealInput.value = SEALS.includes(text) || text === '' ? '' : text;
  }

  function positionSealMenu() {
    if (!els.sealMenu || !els.seal) return;
    const r = els.seal.getBoundingClientRect();
    const m = els.sealMenu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left;
    let top;
    if (vw < 760) {
      left = (vw - m.width) / 2;
      top = clamp(r.top - m.height - 12, 12, vh - m.height - 12);
      if (top < 12) top = clamp(r.bottom + 12, 12, vh - m.height - 12);
    } else {
      left = r.right + 14;
      if (left + m.width > vw - 12) left = r.left - m.width - 14;
      if (left < 12) left = (vw - m.width) / 2;
      const above = r.top - m.height - 12;
      top = above >= 12 ? above : clamp(r.bottom + 12, 12, vh - m.height - 12);
    }
    els.sealMenu.style.left = Math.round(left) + 'px';
    els.sealMenu.style.top = Math.round(top) + 'px';
  }

  function openSealMenu() {
    if (!els.sealMenu || document.body.classList.contains('clean')) return;
    closeColorMenu();
    closeSpeechMenu();
    updateSealMenu();
    els.sealMenu.hidden = false;
    positionSealMenu();
  }

  function closeSealMenu() {
    if (els.sealMenu) els.sealMenu.hidden = true;
  }

  function toggleSealMenu() {
    if (!els.sealMenu) return;
    if (els.sealMenu.hidden) openSealMenu();
    else closeSealMenu();
  }

  function setSeal(text) {
    state.seal = String(text || '');
    try {
      localStorage.setItem('shufa:seal', state.seal);
    } catch (e) {
      /* ignore */
    }
    applySeal(state.poem);
    closeSealMenu();
    showToast(state.seal ? '印章：' + state.seal : '已去掉印章');
  }

  const INK_CHOICES = [
    { name: '墨色', color: '' },
    { name: '朱砂', color: '#a83a2b' },
    { name: '赭石', color: '#85532f' },
    { name: '花青', color: '#3f5a5a' },
    { name: '黛青', color: '#4a4a5a' },
    { name: '胭脂', color: '#9a4a5a' },
    { name: '松烟', color: '#3a3a36' },
    { name: '石绿', color: '#4a6a55' },
    { name: '藤黄', color: '#a8853a' }
  ];

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255;
    let g = (n >> 8) & 255;
    let b = n & 255;
    if (amt >= 0) {
      r += (255 - r) * amt;
      g += (255 - g) * amt;
      b += (255 - b) * amt;
    } else {
      r *= 1 + amt;
      g *= 1 + amt;
      b *= 1 + amt;
    }
    return 'rgb(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ')';
  }

  function inkForGlyph() {
    return state.ink ? shade(state.ink, rand(-0.1, 0.04)) : pick(INKS);
  }

  function applyInkColor() {
    const base = state.ink;
    if (els.paper) els.paper.style.setProperty('--ink', base || '#1f1a14');
    if (els.sig) els.sig.style.color = base || '';
    document.querySelectorAll('.glyph').forEach((svg) => {
      svg.style.color = inkForGlyph();
    });
    if (els.colorDot) els.colorDot.style.background = base || '#1f1a14';
    if (els.btnColor) {
      const choice = INK_CHOICES.find((c) => c.color === base);
      els.btnColor.title = '墨色' + (base ? '：' + (choice ? choice.name : '自定义') : '：墨色');
    }
    updateColorMenu();
  }

  function buildColorMenu() {
    if (!els.colorGrid) return;
    els.colorGrid.innerHTML = '';
    INK_CHOICES.forEach((choice) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'color-choice';
      b.dataset.color = choice.color;
      b.setAttribute('aria-label', '墨色 ' + choice.name);
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = choice.color || '#1f1a14';
      const name = document.createElement('span');
      name.textContent = choice.name;
      b.append(dot, name);
      b.addEventListener('click', () => setInk(choice.color));
      els.colorGrid.appendChild(b);
    });
  }

  function updateColorMenu() {
    if (!els.colorGrid) return;
    [...els.colorGrid.children].forEach((b) => {
      b.classList.toggle('on', (b.dataset.color || '') === (state.ink || ''));
    });
    if (els.colorInput) els.colorInput.value = state.ink || '#a83a2b';
  }

  function positionColorMenu() {
    if (!els.colorMenu || !els.btnColor) return;
    const r = els.btnColor.getBoundingClientRect();
    const m = els.colorMenu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = r.left + r.width / 2 - m.width / 2;
    left = clamp(left, 12, vw - m.width - 12);
    let top = r.top - m.height - 12;
    if (top < 12) top = clamp(r.bottom + 12, 12, vh - m.height - 12);
    els.colorMenu.style.left = Math.round(left) + 'px';
    els.colorMenu.style.top = Math.round(top) + 'px';
  }

  function openColorMenu() {
    if (!els.colorMenu || document.body.classList.contains('clean')) return;
    closeSealMenu();
    closeSpeechMenu();
    updateColorMenu();
    els.colorMenu.hidden = false;
    positionColorMenu();
  }

  function closeColorMenu() {
    if (els.colorMenu) els.colorMenu.hidden = true;
  }

  function toggleColorMenu() {
    if (!els.colorMenu) return;
    if (els.colorMenu.hidden) openColorMenu();
    else closeColorMenu();
  }

  function setInk(color, keepOpen) {
    state.ink = color || null;
    try {
      if (state.ink) localStorage.setItem('shufa:ink', state.ink);
      else localStorage.removeItem('shufa:ink');
    } catch (e) {
      /* ignore */
    }
    applyInkColor();
    if (!keepOpen) closeColorMenu();
    const choice = INK_CHOICES.find((c) => c.color === state.ink);
    showToast(state.ink ? '墨色：' + (choice ? choice.name : '自定义') : '回到默认墨色');
  }

  function setColophon(poem) {
    els.sig.textContent = poem.author || '';
    els.sig.style.display = poem.author ? '' : 'none';

    applySeal(poem);
  }

  function show(poemRef, opts) {
    const options = opts || {};
    cancelPlayback();
    cancelSpeech();
    state.timeline = null;

    const poem =
      typeof poemRef === 'string'
        ? (window.SHUFA_POEMS || []).find((p) => p.id === poemRef) || window.SHUFA_POEMS[0]
        : poemRef;
    if (!poem) return;
    state.poem = poem;
    state.poemId = poem.id;
    const label = poemLabel(poem);
    document.title = '一笔一画 · ' + label;

    document.body.classList.remove('finished');
    els.paper.classList.remove('show-grid');
    els.btnGrid.classList.remove('on');
    els.text.innerHTML = '';
    els.poemSelect.value = poem.id;
    setColophon(poem);

    const vertical = chooseVertical();
    state.vertical = vertical;
    const cell = vertical ? CELL : mobileCell(poem);
    const gap = vertical ? COL_GAP : 2;
    const vgap = vertical ? ROW_GAP : 9;
    const padX = vertical ? PAD : MOBILE_PAD;
    const padY = vertical ? PAD : MOBILE_PAD;

    const blocks = buildBlocks(poem, cell, vertical);
    state.blocks = blocks;

    const blockCount = blocks.length;
    const maxItems = Math.max.apply(null, blocks.map((b) => b.items.length));
    // 每一栏的真实高度（标题/副题的字号更小，不能按个数算）
    const blockHeights = blocks.map((b) => {
      let h = 0;
      b.items.forEach((it, i) => {
        const eh = parseFloat((it.el && it.el.style && it.el.style.height) || '') || cell;
        h += eh + (i ? vgap : 0);
      });
      return h;
    });
    const maxBlockH = Math.max.apply(null, blockHeights);
    const lastBlockH = blockHeights[blockHeights.length - 1];
    // 最后一栏到底了，就把纸往下多留一条落款的位置，印章不会压到字
    const sealBand =
      vertical && lastBlockH > maxBlockH - 70 ? (poem.author ? 128 : 72) : 0;

    let paperW;
    let paperH;
    if (vertical) {
      paperW = padX * 2 + blockCount * cell + (blockCount - 1) * gap;
      paperH = padY * 2 + maxBlockH + sealBand;
    } else {
      paperW = padX * 2 + maxItems * cell + (maxItems - 1) * gap;
      paperH = padY * 2 + blockCount * cell + (blockCount - 1) * vgap + 62;
    }
    // 字少的篇目不要变成一根窄条：留一点纸边的白
    if (vertical && paperW < paperH * 0.62) paperW = Math.round(paperH * 0.62);
    state.paperW = paperW;
    state.paperH = paperH;

    els.paper.className = 'paper ' + (vertical ? 'vert' : 'horiz');
    els.paper.setAttribute(
      'aria-label',
      (poem.title ? label + '，' : '') +
        poem.lines.map((l) => l.text).join('') +
        (poem.author ? '　' + poem.author : '')
    );
    const short = vertical && !poem.title && !poem.subtitle && blocks.length === 1;
    els.text.className = 'text ' + (vertical ? 'vert' : 'horiz') + (short ? ' short' : '');
    els.paper.style.setProperty('--cell', cell + 'px');
    els.paper.style.setProperty('--gap', gap + 'px');
    els.paper.style.setProperty('--vgap', vgap + 'px');
    els.paper.style.setProperty('--pad-x', padX + 'px');
    els.paper.style.setProperty('--pad-y', padY + 'px');
    els.text.style.bottom = vertical && sealBand ? padY + sealBand + 'px' : '';
    els.scroll.style.width = paperW + 'px';
    els.scroll.style.height = paperH + 'px';

    const frag = document.createDocumentFragment();
    blocks.forEach((block) => {
      const el = document.createElement('div');
      el.className = (vertical ? 'col' : 'row') + (block.title ? ' title' : '');
      block.items.forEach((item) => el.appendChild(item.el));
      frag.appendChild(el);
    });
    els.text.appendChild(frag);
    applyInkFilter();
    applyInkColor();

    state.timeline = buildTimeline(blocks);
    state.t = 0;
    state.scrubbing = false;
    state.lastCode = '';
    state.audioIndex = 0;
    seek(0);
    buildSpeechSegments(poem, state.timeline);

    fitPaper();
    document.body.classList.add('ready');
    requestAnimationFrame(() => {
      fitPaper();
      els.scroll.classList.add('settled');
    });

    if (options.still != null) {
      seek(state.timeline.duration * clamp(options.still, 0, 1));
    } else if (options.animate) {
      play(950);
    }
  }

  function fitPaper() {
    if (!state.paperW) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clean = document.body.classList.contains('clean');
    let top = vw < 760 ? 26 : 32;
    if (!clean && els.modes) {
      const mr = els.modes.getBoundingClientRect();
      if (mr.height) top = Math.max(top, mr.bottom + 14);
    }
    const playerTop = els.player ? els.player.getBoundingClientRect().top : vh - 80;
    const bottom = clean ? vh - 24 : playerTop - 20;
    const left = vw < 760 ? 10 : 20;
    const right = vw - left;
    const scale = clamp(
      Math.min((right - left) / state.paperW, (bottom - top) / state.paperH),
      0.15,
      1.6
    );
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const tx = cx - (state.paperW * scale) / 2;
    const ty = cy - (state.paperH * scale) / 2;
    els.scroll.style.transform =
      'translate(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px) scale(' + scale.toFixed(4) + ')';
  }

  /* ---------------- 重来 ---------------- */

  function setPausedLabel(paused) {
    els.btnPause.textContent = paused ? '继续' : '暂停';
    if (els.mPause) {
      els.mPause.textContent = paused ? '继续' : '暂停';
      els.mPause.title = paused ? '继续播放' : '暂停';
    }
  }

  function replay() {
    if (!state.timeline) {
      show(state.poem, { animate: true });
      return;
    }
    seek(0);
    play(0);
  }

  /* ---------------- 速度 ---------------- */

  function formatSpeed(v) {
    return v.toFixed(2).replace(/0$/, '') + '×';
  }

  function setSpeed(value, persist) {
    const v = clamp(Math.round(value * 20) / 20, 0.4, 2);
    state.speed = v;
    if (els.speedRange) {
      els.speedRange.value = v;
      els.speedRange.style.setProperty('--p', (((v - 0.4) / 1.6) * 100).toFixed(1) + '%');
    }
    if (els.speedVal) els.speedVal.textContent = formatSpeed(v);
    if (persist) {
      try {
        localStorage.setItem('shufa:speed', String(v));
      } catch (e) {
        /* file:// 或隐私模式下可能不可用，忽略 */
      }
    }
  }

  /* ---------------- 字帖字体 ---------------- */

  const FONT_OPTIONS = [
    { id: 'kai', label: '楷书', family: '' },
    { id: 'song', label: '宋体', family: '"Songti SC","STSong","SimSun","宋体","Noto Serif CJK SC",serif' },
    { id: 'hei', label: '黑体', family: '"Heiti SC","PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif' }
  ];
  const EXTRA_FONTS = [
    { id: 'wei', label: '魏碑', family: '"Weibei SC","Weibei TC",serif', probe: 'Weibei SC' },
    { id: 'li', label: '隶书', family: '"Libian SC","Libian TC",serif', probe: 'Libian SC' },
    { id: 'xing', label: '行楷', family: '"Xingkai SC","Xingkai TC",cursive', probe: 'Xingkai SC' },
    { id: 'hanno', label: '手写楷', family: '"Hannotate SC","Hannotate TC",cursive', probe: 'Hannotate SC' }
  ];

  function fontAvailable(name) {
    try {
      const c = document.createElement('canvas');
      c.width = 96;
      c.height = 96;
      const g = c.getContext('2d');
      const sample = '永魏隶';
      g.clearRect(0, 0, 96, 96);
      g.font = '64px "NoSuchFontXYZ", serif';
      g.fillStyle = '#000';
      g.fillText(sample, 4, 74);
      const base = g.getImageData(0, 0, 96, 96).data;
      g.clearRect(0, 0, 96, 96);
      g.font = '64px "' + name + '", serif';
      g.fillText(sample, 4, 74);
      const data = g.getImageData(0, 0, 96, 96).data;
      for (let i = 0; i < base.length; i += 4) {
        if (base[i] !== data[i]) return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  function buildFontSelect() {
    const list = FONT_OPTIONS.slice();
    EXTRA_FONTS.forEach((f) => {
      if (fontAvailable(f.probe)) list.push(f);
    });
    state.fontList = list;
    els.fontSelect.innerHTML = '';
    list.forEach((f) => {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.label;
      els.fontSelect.appendChild(opt);
    });
  }

  function setFont(id, persist) {
    const list = state.fontList.length ? state.fontList : FONT_OPTIONS;
    const f = list.find((x) => x.id === id) || list[0];
    state.fontId = f.id;
    state.fontFamily = f.family;
    if (els.fontSelect) els.fontSelect.value = f.id;
    document.querySelectorAll('.font-glyph text').forEach((t) => {
      t.setAttribute('font-family', f.family || '"Kaiti SC", serif');
    });
    state.fontShown = null;
    applyFontDisplay();
    if (persist && f.family && state.timeline && state.t < state.timeline.duration - 1) {
      showToast('写完后呈现为' + f.label);
    }
    if (persist) {
      try {
        localStorage.setItem('shufa:font', f.id);
      } catch (e) {
        /* ignore */
      }
    }
  }

  function applyFontDisplay() {
    const tl = state.timeline;
    const show = !!(tl && state.fontFamily && state.t >= tl.duration - 1 && state.mode === 'write');
    if (show === state.fontShown) return;
    state.fontShown = show;
    document.querySelectorAll('.glyph').forEach((svg) => {
      const ink = svg.querySelector('.ink');
      const fg = svg.querySelector('.font-glyph');
      if (ink) ink.style.opacity = show ? '0' : '1';
      if (fg) fg.style.opacity = show ? '1' : '0';
    });
    document.querySelectorAll('.cell.punct span, .cell.sep span, .sig').forEach((el) => {
      el.style.fontFamily = show ? state.fontFamily : '';
    });
  }

  /* ---------------- 毛笔 / 水墨 ---------------- */

  const SCENES = {
    zhu: {
      name: '竹',
      svg: `<svg viewBox="0 0 1000 1600" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
<defs>
  <filter id="zhuWash" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="26"/></filter>
  <filter id="zhuRough" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="0.015 0.03" numOctaves="2" seed="4" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="8" xChannelSelector="R" yChannelSelector="G"/></filter>
  <linearGradient id="zhuInk" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#3b3c30"/><stop offset="1" stop-color="#6f7460"/></linearGradient>
</defs>
<g filter="url(#zhuWash)" opacity=".35"><ellipse cx="730" cy="1220" rx="330" ry="420" fill="#7d8a6c"/><ellipse cx="430" cy="1520" rx="380" ry="150" fill="#8d9378"/></g>
<g filter="url(#zhuRough)" fill="url(#zhuInk)" opacity=".5"><path d="M 540 1520 C 535 1120 540 700 555 260 L 573 260 C 566 700 564 1120 572 1520 Z"/></g>
<g filter="url(#zhuRough)" fill="url(#zhuInk)" opacity=".72"><path d="M 760 1540 C 750 1150 756 730 778 230 L 806 230 C 790 730 780 1150 796 1540 Z"/><path d="M 858 1540 C 850 1180 858 830 874 450 L 896 450 C 884 830 876 1180 888 1540 Z"/></g>
<g stroke="#4d4a3a" stroke-width="6" opacity=".5" stroke-linecap="round"><path d="M 758 520 L 806 518"/><path d="M 756 860 L 804 858"/><path d="M 760 1200 L 806 1198"/><path d="M 856 700 L 898 698"/><path d="M 858 1040 L 896 1038"/></g>
<g filter="url(#zhuRough)" fill="#46503b" opacity=".78"><path d="M 790 500 C 860 470 940 440 995 400 C 940 470 870 510 800 528 Z"/><path d="M 800 545 C 880 535 955 525 1000 500 C 940 550 870 565 808 570 Z"/><path d="M 780 620 C 840 610 900 590 950 555 C 900 620 840 650 790 655 Z"/><path d="M 870 760 C 930 730 980 690 1000 640 C 970 710 920 760 880 780 Z"/><path d="M 760 680 C 700 650 650 610 620 560 C 670 620 720 670 770 700 Z"/><path d="M 850 570 C 900 540 950 510 990 470 C 950 530 900 580 860 600 Z"/></g>
<g filter="url(#zhuRough)" fill="#7f8770" opacity=".45"><path d="M 770 900 C 830 880 890 850 940 810 C 890 880 830 920 780 935 Z"/><path d="M 860 930 C 910 900 950 870 980 830 C 950 890 910 930 870 950 Z"/></g>
</svg>`
    },
    mei: {
      name: '梅',
      svg: `<svg viewBox="0 0 1000 1600" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
<defs>
  <filter id="meiWash" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="24"/></filter>
  <filter id="meiRough" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="0.012 0.025" numOctaves="2" seed="9" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="7" xChannelSelector="R" yChannelSelector="G"/></filter>
  <linearGradient id="meiInk" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="#3a2f26"/><stop offset="1" stop-color="#6b5a48"/></linearGradient>
</defs>
<g filter="url(#meiWash)" opacity=".28"><ellipse cx="180" cy="1180" rx="270" ry="330" fill="#8a7f6a"/></g>
<g filter="url(#meiRough)" stroke="url(#meiInk)" fill="none" stroke-linecap="round">
  <path d="M 40 1540 C 90 1320 120 1120 108 900 C 104 760 118 620 170 490" stroke-width="24"/>
  <path d="M 105 1100 C 165 1060 210 1010 250 950" stroke-width="10"/>
  <path d="M 110 830 C 170 790 220 750 270 700" stroke-width="8"/>
  <path d="M 140 620 C 180 590 215 560 250 520" stroke-width="6"/>
</g>
<g fill="#b04534" opacity=".95">
  <g transform="translate(170 490) rotate(15)"><ellipse cx="0" cy="-12" rx="7" ry="12"/><ellipse cx="0" cy="-12" rx="7" ry="12" transform="rotate(72)"/><ellipse cx="0" cy="-12" rx="7" ry="12" transform="rotate(144)"/><ellipse cx="0" cy="-12" rx="7" ry="12" transform="rotate(216)"/><ellipse cx="0" cy="-12" rx="7" ry="12" transform="rotate(288)"/></g>
  <g transform="translate(250 530) rotate(40)"><ellipse cx="0" cy="-12" rx="7" ry="12"/><ellipse cx="0" cy="-12" rx="7" ry="12" transform="rotate(72)"/><ellipse cx="0" cy="-12" rx="7" ry="12" transform="rotate(144)"/><ellipse cx="0" cy="-12" rx="7" ry="12" transform="rotate(216)"/><ellipse cx="0" cy="-12" rx="7" ry="12" transform="rotate(288)"/></g>
  <g transform="translate(270 700) rotate(10)"><ellipse cx="0" cy="-12" rx="7" ry="12"/><ellipse cx="0" cy="-12" rx="7" ry="12" transform="rotate(72)"/><ellipse cx="0" cy="-12" rx="7" ry="12" transform="rotate(144)"/><ellipse cx="0" cy="-12" rx="7" ry="12" transform="rotate(216)"/><ellipse cx="0" cy="-12" rx="7" ry="12" transform="rotate(288)"/></g>
  <g transform="translate(250 950) rotate(35)"><ellipse cx="0" cy="-12" rx="7" ry="12"/><ellipse cx="0" cy="-12" rx="7" ry="12" transform="rotate(72)"/><ellipse cx="0" cy="-12" rx="7" ry="12" transform="rotate(144)"/><ellipse cx="0" cy="-12" rx="7" ry="12" transform="rotate(216)"/><ellipse cx="0" cy="-12" rx="7" ry="12" transform="rotate(288)"/></g>
  <g transform="translate(210 1010) rotate(20)"><ellipse cx="0" cy="-12" rx="7" ry="12"/><ellipse cx="0" cy="-12" rx="7" ry="12" transform="rotate(72)"/><ellipse cx="0" cy="-12" rx="7" ry="12" transform="rotate(144)"/><ellipse cx="0" cy="-12" rx="7" ry="12" transform="rotate(216)"/><ellipse cx="0" cy="-12" rx="7" ry="12" transform="rotate(288)"/></g>
</g>
<g fill="#cf8068" opacity=".82">
  <g transform="translate(110 830) rotate(0)"><ellipse cx="0" cy="-10" rx="6" ry="10"/><ellipse cx="0" cy="-10" rx="6" ry="10" transform="rotate(72)"/><ellipse cx="0" cy="-10" rx="6" ry="10" transform="rotate(144)"/><ellipse cx="0" cy="-10" rx="6" ry="10" transform="rotate(216)"/><ellipse cx="0" cy="-10" rx="6" ry="10" transform="rotate(288)"/></g>
  <g transform="translate(90 1100) rotate(50)"><ellipse cx="0" cy="-10" rx="6" ry="10"/><ellipse cx="0" cy="-10" rx="6" ry="10" transform="rotate(72)"/><ellipse cx="0" cy="-10" rx="6" ry="10" transform="rotate(144)"/><ellipse cx="0" cy="-10" rx="6" ry="10" transform="rotate(216)"/><ellipse cx="0" cy="-10" rx="6" ry="10" transform="rotate(288)"/></g>
  <g transform="translate(60 1300) rotate(20)"><ellipse cx="0" cy="-10" rx="6" ry="10"/><ellipse cx="0" cy="-10" rx="6" ry="10" transform="rotate(72)"/><ellipse cx="0" cy="-10" rx="6" ry="10" transform="rotate(144)"/><ellipse cx="0" cy="-10" rx="6" ry="10" transform="rotate(216)"/><ellipse cx="0" cy="-10" rx="6" ry="10" transform="rotate(288)"/></g>
</g>
<g fill="#4a3a2c" opacity=".85"><circle cx="170" cy="490" r="4"/><circle cx="250" cy="530" r="4"/><circle cx="270" cy="700" r="4"/><circle cx="250" cy="950" r="4"/><circle cx="210" cy="1010" r="4"/><circle cx="110" cy="830" r="3.4"/><circle cx="90" cy="1100" r="3.4"/><circle cx="60" cy="1300" r="3.4"/></g>
</svg>`
    },
    he: {
      name: '荷',
      svg: `<svg viewBox="0 0 1000 1600" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
<defs>
  <filter id="heWash" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="26"/></filter>
  <filter id="heRough" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="0.014 0.03" numOctaves="2" seed="12" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="8" xChannelSelector="R" yChannelSelector="G"/></filter>
</defs>
<g filter="url(#heWash)" opacity=".32"><ellipse cx="300" cy="1240" rx="340" ry="270" fill="#7f8c6e"/><ellipse cx="760" cy="1450" rx="220" ry="120" fill="#8c9476"/></g>
<g filter="url(#heRough)" fill="#6d7a5e" opacity=".5"><path d="M 80 1250 C 60 1090 220 1020 400 1070 C 570 1120 630 1260 520 1360 C 400 1450 150 1440 80 1250 Z"/></g>
<g stroke="#4e5845" fill="none" stroke-width="3" opacity=".4">
  <path d="M 300 1360 C 300 1250 296 1150 300 1070"/>
  <path d="M 300 1360 C 220 1290 180 1210 170 1120"/>
  <path d="M 300 1360 C 380 1290 430 1210 440 1120"/>
  <path d="M 300 1360 C 180 1330 120 1280 90 1220"/>
  <path d="M 300 1360 C 420 1330 490 1280 520 1220"/>
</g>
<g filter="url(#heRough)" stroke="#5b6048" stroke-width="8" fill="none" stroke-linecap="round">
  <path d="M 690 1480 C 680 1300 700 1140 760 1000"/>
  <path d="M 700 1180 C 760 1120 800 1060 820 990" stroke-width="5"/>
</g>
<g filter="url(#heWash)" opacity=".4"><ellipse cx="820" cy="980" rx="60" ry="120" fill="#b56a62"/></g>
<g filter="url(#heRough)" fill="#b56a62" opacity=".55"><path d="M 820 1000 C 780 950 780 870 820 810 C 860 870 860 950 820 1000 Z"/></g>
</svg>`
    },
    shan: {
      name: '山',
      svg: `<svg viewBox="0 0 1000 1600" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
<defs>
  <filter id="shanWash" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="20"/></filter>
  <filter id="shanRough" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="0.02 0.04" numOctaves="2" seed="6" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G"/></filter>
</defs>
<g filter="url(#shanWash)" opacity=".35"><path d="M 0 1180 C 160 1080 260 1120 380 1050 C 520 970 620 1050 760 1000 C 880 960 940 1000 1000 980 L 1000 1600 L 0 1600 Z" fill="#7d8574"/></g>
<g filter="url(#shanRough)" opacity=".45"><path d="M 0 1320 C 140 1240 240 1290 360 1210 C 500 1120 620 1200 760 1150 C 880 1110 940 1150 1000 1130 L 1000 1600 L 0 1600 Z" fill="#5f6a58"/></g>
<g filter="url(#shanWash)" opacity=".5"><circle cx="760" cy="380" r="95" fill="#e0d0aa"/></g>
<g stroke="#f4ead4" stroke-width="8" opacity=".38" filter="url(#shanWash)"><path d="M 100 1120 C 300 1100 500 1140 700 1100"/><path d="M 250 1250 C 450 1220 650 1260 850 1220"/></g>
</svg>`
    }
  };

  function buildScene(name) {
    const sc = SCENES[name] || SCENES.zhu;
    if (els.scene) els.scene.innerHTML = sc.svg;
  }

  function setScene(name, persist) {
    state.scene = SCENES[name] ? name : 'zhu';
    if (els.sceneSelect) els.sceneSelect.value = state.scene;
    buildScene(state.scene);
    if (persist) {
      try {
        localStorage.setItem('shufa:scene', state.scene);
      } catch (e) {
        /* ignore */
      }
      updateUrl();
    }
  }

  function buildSceneSelect() {
    if (!els.sceneSelect) return;
    els.sceneSelect.innerHTML = '';
    Object.keys(SCENES).forEach((key) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = SCENES[key].name;
      els.sceneSelect.appendChild(opt);
    });
    els.sceneSelect.value = state.scene;
  }

  function applyInkFilter() {
    const brush = state.mode === 'brush' || state.mode === 'ink';
    document.querySelectorAll('.glyph .ink').forEach((g) => {
      g.setAttribute('filter', brush ? 'url(#brushInk)' : 'url(#inkTexture)');
    });
  }

  function applyModeChrome() {
    document.body.dataset.mode = state.mode;
    const sub = document.querySelector('.brand span');
    if (sub) {
      sub.textContent =
        state.mode === 'brush'
          ? '毛笔 · 墨迹'
          : state.mode === 'ink'
            ? '水墨 · 文人画'
            : '汉字笔顺 · 手写动画';
    }
    document.querySelectorAll('#modes button').forEach((b) => {
      const on = b.dataset.mode === state.mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (els.sceneSelect) els.sceneSelect.value = state.scene;
  }

  function updateUrl() {
    try {
      const u = new URL(location.href);
      if (state.mode === 'write') u.searchParams.delete('mode');
      else u.searchParams.set('mode', state.mode);
      if (state.mode === 'ink') u.searchParams.set('scene', state.scene);
      else u.searchParams.delete('scene');
      history.replaceState(null, '', u.toString());
    } catch (e) {
      /* file:// 下某些浏览器禁用 history，忽略 */
    }
  }

  function setMode(mode, silent) {
    state.mode = ['write', 'brush', 'ink'].includes(mode) ? mode : 'write';
    applyModeChrome();
    applyInkFilter();
    paintPaper(state.mode);
    state.fontShown = null;
    applyFontDisplay();
    if (els.scene && !els.scene.firstChild) buildScene(state.scene);
    if (state.timeline) renderAt(state.t);
    try {
      localStorage.setItem('shufa:mode', state.mode);
    } catch (e) {
      /* ignore */
    }
    if (!silent) {
      updateUrl();
      fitPaper();
    }
  }

  /* ---------------- 导出 PNG ---------------- */

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function collectCharBoxes(el) {
    const boxes = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue || '';
      for (let i = 0; i < text.length; i++) {
        if (/\s/.test(text[i])) continue;
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) boxes.push({ ch: text[i], rect });
      }
    }
    return boxes;
  }

  function buildGlyphSVG() {
    const paperRect = els.paper.getBoundingClientRect();
    const k = paperRect.width / state.paperW;
    const W = state.paperW;
    const H = state.paperH;
    const filter = document.querySelector('#inkTexture');
    const brushFilter = document.querySelector('#brushInk');
    const parts = [];
    parts.push(
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H +
        '" viewBox="0 0 ' + W + ' ' + H + '">'
    );
    parts.push(
      '<defs>' +
        (filter ? filter.outerHTML : '') +
        (brushFilter ? brushFilter.outerHTML : '') +
        '</defs>'
    );

    els.text.querySelectorAll('.glyph').forEach((svg) => {
      const cell = svg.closest('.cell');
      const cr = cell.getBoundingClientRect();
      const w = cr.width / k;
      const h = cr.height / k;
      const x = (cr.left - paperRect.left) / k;
      const y = (cr.top - paperRect.top) / k;
      const j = svg.__jitter || { tx: 0, ty: 0, rot: 0, scale: 1 };

      const clone = svg.cloneNode(true);
      clone.removeAttribute('class');
      clone.removeAttribute('role');
      clone.removeAttribute('aria-label');
      clone.style.removeProperty('transform');
      clone.setAttribute('x', '0');
      clone.setAttribute('y', '0');
      clone.setAttribute('width', String(w));
      clone.setAttribute('height', String(h));
      clone.setAttribute('overflow', 'visible');
      clone.querySelectorAll('.tip, .brush-layer, .bead, .bead-glint, .spray').forEach((t) => t.remove());

      const cx = x + w / 2 + j.tx;
      const cy = y + h / 2 + j.ty;
      parts.push(
        '<g transform="translate(' + cx.toFixed(2) + ' ' + cy.toFixed(2) + ') rotate(' +
          j.rot.toFixed(2) + ') scale(' + j.scale.toFixed(3) + ') translate(' +
          (-w / 2).toFixed(2) + ' ' + (-h / 2).toFixed(2) + ')">'
      );
      parts.push(new XMLSerializer().serializeToString(clone));
      parts.push('</g>');
    });

    parts.push('</svg>');
    return parts.join('');
  }

  function drawTextGroups(ctx, paperRect, k, groups, color, alpha, rotation) {
    groups.forEach(({ el, boxes }) => {
      const cs = getComputedStyle(el);
      const font =
        cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
      boxes.forEach(({ ch, rect }) => {
        const cx = (rect.left - paperRect.left + rect.width / 2) / k;
        const cy = (rect.top - paperRect.top + rect.height / 2) / k;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color || cs.color;
        ctx.font = font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.translate(cx, cy);
        if (rotation) ctx.rotate(rotation);
        ctx.fillText(ch, 0, 0);
        ctx.restore();
      });
    });
  }

  async function exportPNG() {
    const tl = state.timeline;
    if (!tl) return;
    const wasPlaying = state.playing;
    const prevT = state.t;
    const paperRect = els.paper.getBoundingClientRect();
    const k = paperRect.width / state.paperW;
    const W = state.paperW;
    const H = state.paperH;

    pause();
    document.documentElement.classList.add('exporting');
    renderAt(tl.duration);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    // 先把“写完的样子”序列化，再把画面恢复，后面的绘制全用快照
    const svgString = buildGlyphSVG();
    const punctGroups = [...els.text.querySelectorAll('.cell.punct span')].map((span) => ({
      el: span,
      boxes: collectCharBoxes(span)
    }));
    const sepGroups = [...els.text.querySelectorAll('.cell.sep span')].map((span) => ({
      el: span,
      boxes: collectCharBoxes(span)
    }));
    const sigBoxes = collectCharBoxes(els.sig);
    const sealBoxes = collectCharBoxes(els.seal);
    const sealRect = els.seal.getBoundingClientRect();
    const sealSize = els.seal.offsetWidth || 46;

    renderAt(prevT);
    document.documentElement.classList.remove('exporting');
    if (wasPlaying) play(0);

    try {
      const grainUrl = (getComputedStyle(els.paper).getPropertyValue('--grain') || '')
        .trim()
        .replace(/^url\(['"]?/, '')
        .replace(/['"]?\)$/, '');
      const grain = grainUrl ? await loadImage(grainUrl) : null;
      const svgUrl = URL.createObjectURL(new Blob([svgString], { type: 'image/svg+xml' }));
      const glyph = await loadImage(svgUrl);
      URL.revokeObjectURL(svgUrl);

      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(W * scale);
      canvas.height = Math.round(H * scale);
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);

      const paperBg = (getComputedStyle(els.paper).backgroundColor || '').trim();
      ctx.fillStyle = paperBg && paperBg !== 'rgba(0, 0, 0, 0)' ? paperBg : '#f6efdd';
      ctx.fillRect(0, 0, W, H);
      const glow = ctx.createRadialGradient(W * 0.24, H * 0.06, 0, W * 0.24, H * 0.06, W * 0.95);
      glow.addColorStop(0, 'rgba(255,255,255,0.38)');
      glow.addColorStop(0.55, 'rgba(255,255,255,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);

      if (grain) {
        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.globalCompositeOperation = 'multiply';
        for (let x = 0; x < W; x += 512) {
          for (let y = 0; y < H; y += 512) ctx.drawImage(grain, x, y, 512, 512);
        }
        ctx.restore();
      }

      // 水墨背景（画在纸纹之上、字之下）
      if (state.mode === 'ink' && els.scene) {
        const sceneSvg = els.scene.querySelector('svg');
        const sr = els.scene.getBoundingClientRect();
        if (sceneSvg && sr.width > 0) {
          try {
            const clone = sceneSvg.cloneNode(true);
            clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            clone.setAttribute('width', String(sr.width / k));
            clone.setAttribute('height', String(sr.height / k));
            const sUrl = URL.createObjectURL(
              new Blob([new XMLSerializer().serializeToString(clone)], {
                type: 'image/svg+xml'
              })
            );
            const sImg = await loadImage(sUrl);
            URL.revokeObjectURL(sUrl);
            ctx.save();
            ctx.globalAlpha = 0.45;
            ctx.drawImage(
              sImg,
              (sr.left - paperRect.left) / k,
              (sr.top - paperRect.top) / k,
              sr.width / k,
              sr.height / k
            );
            ctx.restore();
          } catch (e) {
            /* 背景失败不影响字 */
          }
        }
      }

      ctx.strokeStyle = 'rgba(122,88,50,0.24)';
      ctx.lineWidth = 1;
      ctx.strokeRect(26.5, 26.5, W - 53, H - 53);
      ctx.strokeStyle = 'rgba(122,88,50,0.12)';
      ctx.strokeRect(30.5, 30.5, W - 61, H - 61);

      ctx.drawImage(glyph, 0, 0, W, H);

      drawTextGroups(ctx, paperRect, k, punctGroups, null, 0.72);
      drawTextGroups(ctx, paperRect, k, sepGroups, null, 0.75);

      // 落款
      drawTextGroups(
        ctx,
        paperRect,
        k,
        [{ el: els.sig, boxes: sigBoxes }],
        null,
        1
      );

      // 印章底
      const sealOff = els.seal.classList.contains('off');
      if (!sealOff) {
      const scx = (sealRect.left - paperRect.left + sealRect.width / 2) / k;
      const scy = (sealRect.top - paperRect.top + sealRect.height / 2) / k;
      ctx.save();
      ctx.translate(scx, scy);
      ctx.rotate((-3 * Math.PI) / 180);
      const sealGrad = ctx.createRadialGradient(-sealSize * 0.2, -sealSize * 0.25, 0, 0, 0, sealSize * 0.8);
      sealGrad.addColorStop(0, '#bd4a39');
      sealGrad.addColorStop(1, '#9e3326');
      ctx.fillStyle = sealGrad;
      roundRect(ctx, -sealSize / 2, -sealSize / 2, sealSize, sealSize, 3);
      ctx.fill();
      ctx.restore();

      drawTextGroups(
        ctx,
        paperRect,
        k,
        [{ el: els.seal, boxes: sealBoxes }],
        '#f4e9d7',
        0.9,
        (-3 * Math.PI) / 180
      );
      }

      await new Promise((resolve) => {
        canvas.toBlob((blob) => {
          if (!blob) return resolve();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          const name = ['一笔一画', poemLabel(state.poem), state.poem.author]
            .filter(Boolean)
            .join('-')
            .replace(/[\\/:*?"<>|]/g, '');
          a.href = url;
          a.download = name + '.png';
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
          resolve();
        }, 'image/png');
      });
    } catch (err) {
      console.error('导出失败', err);
    }
  }

  /* ---------------- 自定义篇目 / 按需取字 ---------------- */

  const GLYPH_BASES = [
    'https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/',
    'https://unpkg.com/hanzi-writer-data@2.0.1/'
  ];

  function readGlyphCache(ch) {
    try {
      const raw = localStorage.getItem('shufa:glyph:' + ch);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data && data.strokes && data.medians) return data;
    } catch (e) {
      /* 缓存损坏或不可用，忽略 */
    }
    return null;
  }

  async function fetchGlyphData(ch) {
    for (const base of GLYPH_BASES) {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 9000) : 0;
      try {
        const res = await fetch(base + encodeURIComponent(ch) + '.json', ctrl ? { signal: ctrl.signal } : undefined);
        if (!res.ok) continue;
        const d = await res.json();
        if (!d.strokes || !d.medians) continue;
        const data = { strokes: d.strokes, medians: d.medians };
        window.HANZI_STROKES[ch] = data;
        try {
          localStorage.setItem('shufa:glyph:' + ch, JSON.stringify(data));
        } catch (e) {
          /* 配额满或隐私模式，忽略 */
        }
        return true;
      } catch (e) {
        /* 换下一个源 */
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    return false;
  }

  async function ensureGlyphs(chars, onProgress) {
    const missing = chars.filter((ch) => !window.HANZI_STROKES[ch]);
    if (!missing.length) return [];
    const failed = [];
    let done = 0;
    const queue = missing.slice();

    async function worker() {
      while (queue.length) {
        const ch = queue.shift();
        const cached = readGlyphCache(ch);
        let ok = false;
        if (cached) {
          window.HANZI_STROKES[ch] = cached;
          ok = true;
        } else {
          ok = await fetchGlyphData(ch);
        }
        if (!ok) failed.push(ch);
        done++;
        if (onProgress) onProgress(done, missing.length);
      }
    }

    const workers = [];
    for (let i = 0; i < Math.min(6, missing.length); i++) workers.push(worker());
    await Promise.all(workers);
    return failed;
  }

  function splitWidth(text, max) {
    const out = [];
    let cur = '';
    for (const ch of [...text]) {
      if (/\s/.test(ch)) continue;
      cur += ch;
      if ([...cur].length >= max) {
        out.push(cur);
        cur = '';
      }
    }
    if (cur) out.push(cur);
    return out;
  }

  // 一句里如果太长，优先在标点处断开，再退回硬切
  function packSegment(seg, max) {
    const clauses = [];
    let cur = '';
    for (const ch of seg) {
      cur += ch;
      if ('，。！？!?；;、'.includes(ch)) {
        clauses.push(cur);
        cur = '';
      }
    }
    if (cur.trim()) clauses.push(cur);
    if (!clauses.length) clauses.push(seg);

    const out = [];
    let line = '';
    clauses.forEach((clause) => {
      const len = [...clause].length;
      if ([...line].length + len <= max) {
        line += clause;
        return;
      }
      if (line) out.push(line);
      if (len <= max) {
        line = clause;
      } else {
        const chunks = splitWidth(clause, max);
        chunks.forEach((c, i) => {
          if (i === chunks.length - 1) line = c;
          else out.push(c);
        });
      }
    });
    if (line) out.push(line);
    return out;
  }

  function parseCustomLines(raw) {
    const parts = raw
      .replace(/\r/g, '')
      .split(/\n\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const lines = [];

    parts.forEach((part, idx) => {
      let segs;
      if (part.includes('\n')) {
        segs = part.split('\n').map((s) => s.trim()).filter(Boolean);
      } else {
        segs = [];
        let cur = '';
        for (const ch of part) {
          cur += ch;
          if ('。！？!?；;，、'.includes(ch)) {
            segs.push(cur);
            cur = '';
          }
        }
        if (cur.trim()) segs.push(cur);
      }
      if (!segs.length) segs = [part];

      segs.forEach((seg) => {
        packSegment(seg, 10).forEach((t) => lines.push({ text: t }));
      });

      if (idx < parts.length - 1 && lines.length) lines[lines.length - 1].partEnd = true;
    });

    return lines;
  }

  function poemGlyphChars(poem) {
    const set = [];
    const add = (ch) => {
      if (ch && ch.trim() && !PUNCT.has(ch)) set.push(ch);
    };
    [...poem.title].forEach(add);
    [...(poem.subtitle || '')].forEach(add);
    poem.lines.forEach((l) => [...l.text].forEach(add));
    return [...new Set(set)];
  }

  function parseCustomPoem(raw, title, author) {
    const clean = String(raw || '').replace(/\r/g, '').trim();
    if (!clean) throw new Error('正文为空');

    const fullTitle = String(title || '').trim();
    const bits = fullTitle.split('·');
    const main = (bits.shift() || '').trim();
    const subtitle = bits.join('·').trim();
    if ([...main].length + [...subtitle].length > 8) throw new Error('标题最多 8 个字');

    const lines = parseCustomLines(clean);
    if (!lines.length) throw new Error('正文为空');

    const poem = {
      id: 'custom',
      title: main,
      subtitle,
      author: String(author || '').trim(),
      dynasty: '',
      seal: '墨戏',
      lines
    };

    let count = [...main, ...subtitle].filter((c) => !PUNCT.has(c)).length;
    lines.forEach((l) => {
      count += [...l.text].filter((c) => !PUNCT.has(c)).length;
    });
    if (count > 160) throw new Error('一次最多 160 字（现在约 ' + count + ' 字）');

    return poem;
  }

  async function loadPoemFromText(raw, title, author, onStatus) {
    const poem = parseCustomPoem(raw, title, author);
    const chars = poemGlyphChars(poem);
    const missing = chars.filter((ch) => !window.HANZI_STROKES[ch]);
    if (missing.length) {
      if (onStatus) onStatus('正在取字 0/' + missing.length + '…');
      const failed = await ensureGlyphs(missing, (done, total) => {
        if (onStatus) onStatus('正在取字 ' + done + '/' + total + '…');
      });
      if (failed.length) {
        throw new Error(
          '缺字：' + failed.slice(0, 10).join('') + (failed.length > 10 ? '…' : '') +
            '（可能离线，或这些字没有笔顺数据）'
        );
      }
    }
    return poem;
  }

  function poemLabel(poem) {
    if (poem.title) return poem.title + (poem.subtitle ? '·' + poem.subtitle : '');
    const first = (poem.lines[0] && poem.lines[0].text) || '自定';
    return [...first].slice(0, 8).join('').replace(/[，。！？、；：\s]/g, '') || '自定';
  }

  function customOptionLabel(poem) {
    return '自定义 · ' + poemLabel(poem);
  }

  function ensureCustomOption(poem) {
    let opt = [...els.poemSelect.options].find((o) => o.value === 'custom');
    if (!opt) {
      opt = document.createElement('option');
      opt.value = 'custom';
      els.poemSelect.insertBefore(opt, els.poemSelect.lastElementChild);
    }
    opt.textContent = customOptionLabel(poem);
    return opt;
  }

  let toastTimer = 0;

  function showToast(msg, error) {
    if (!els.toast) return;
    els.toast.hidden = !msg;
    els.toast.textContent = msg || '';
    els.toast.classList.toggle('error', !!error);
    if (els.player) {
      const r = els.player.getBoundingClientRect();
      els.toast.style.bottom = Math.max(12, window.innerHeight - r.top + 10) + 'px';
    }
    window.clearTimeout(toastTimer);
    if (msg && !error) {
      toastTimer = window.setTimeout(() => {
        els.toast.hidden = true;
      }, 2600);
    } else if (msg && error) {
      toastTimer = window.setTimeout(() => {
        els.toast.hidden = true;
      }, 4200);
    }
  }

  async function quickSubmit() {
    if (!els.quickText) return;
    const text = els.quickText.value.trim();
    if (!text) {
      els.quickText.focus();
      return;
    }
    if (els.quickGo.disabled) return;
    els.quickGo.disabled = true;
    els.quickGo.textContent = '…';
    showToast('正在取字…', false);
    try {
      const poem = await loadPoemFromText(text, '', '', (msg) => showToast(msg, false));
      state.customPoem = poem;
      state.customRaw = text;
      ensureCustomOption(poem);
      show(poem, { animate: true });
      els.poemSelect.value = 'custom';
      showToast('写好了');
    } catch (err) {
      showToast(err.message || '取字失败', true);
    } finally {
      els.quickGo.disabled = false;
      els.quickGo.textContent = '开写';
    }
  }

  function openCompose(fresh) {
    if (!els.compose) return;
    if (fresh || !state.customPoem) {
      els.cTitle.value = '';
      els.cAuthor.value = '';
      els.cText.value = '';
    } else {
      els.cTitle.value =
        state.customPoem.title +
        (state.customPoem.subtitle ? '·' + state.customPoem.subtitle : '');
      els.cAuthor.value = state.customPoem.author;
      els.cText.value =
        state.customRaw || state.customPoem.lines.map((l) => l.text).join('\n');
    }
    els.cStatus.textContent = '';
    if (typeof els.compose.showModal === 'function') els.compose.showModal();
    else els.compose.setAttribute('open', '');
    setTimeout(() => els.cText && els.cText.focus(), 40);
  }

  async function submitCompose() {
    const title = els.cTitle.value;
    const author = els.cAuthor.value;
    const raw = els.cText.value;
    if (!raw.trim()) {
      els.cStatus.textContent = '请先写正文';
      return;
    }
    els.cGo.disabled = true;
    els.cCancel.disabled = true;
    els.cStatus.textContent = '准备中…';
    try {
      const poem = await loadPoemFromText(raw, title, author, (msg) => {
        els.cStatus.textContent = msg;
      });
      state.customPoem = poem;
      state.customRaw = raw;
      if (els.compose.open) els.compose.close();
      ensureCustomOption(poem);
      show(poem, { animate: true });
      els.poemSelect.value = 'custom';
    } catch (err) {
      els.cStatus.textContent = err.message || '取字失败';
    } finally {
      els.cGo.disabled = false;
      els.cCancel.disabled = false;
    }
  }

  /* ---------------- 手机版 ---------------- */

  const MOBILE_QUERY = '(max-width: 760px), (max-height: 520px) and (orientation: landscape)';
  let sheetTimer = 0;

  function isMobileLayout() {
    return window.matchMedia(MOBILE_QUERY).matches;
  }

  function layoutForViewport() {
    if (!els.hud) return;
    if (isMobileLayout()) {
      if (els.sheetBody && els.hud.parentNode !== els.sheetBody) els.sheetBody.appendChild(els.hud);
    } else {
      if (els.player && els.hud.parentNode !== els.player) els.player.appendChild(els.hud);
      closeSheet(true);
    }
  }

  function openSheet() {
    if (!isMobileLayout() || !els.sheet) return;
    closeSealMenu();
    closeColorMenu();
    els.sheet.hidden = false;
    if (els.mMore) els.mMore.classList.add('on');
    document.body.classList.add('sheet-open');
    window.requestAnimationFrame(() => els.sheet.classList.add('on'));
  }

  function closeSheet(immediate) {
    if (!els.sheet) return;
    els.sheet.classList.remove('on');
    if (els.mMore) els.mMore.classList.remove('on');
    document.body.classList.remove('sheet-open');
    window.clearTimeout(sheetTimer);
    if (immediate) {
      els.sheet.hidden = true;
      return;
    }
    sheetTimer = window.setTimeout(() => {
      if (!els.sheet.classList.contains('on')) els.sheet.hidden = true;
    }, 280);
  }

  function toggleSheet() {
    if (!els.sheet) return;
    if (els.sheet.hidden || !els.sheet.classList.contains('on')) openSheet();
    else closeSheet();
  }

  /* ---------------- 朗读（系统语音，无音频文件） ---------------- */

  const Speech = typeof window !== 'undefined' ? window.speechSynthesis : null;
  const hasSpeech = !!Speech && typeof window !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined';
  const VOICE_PREF = [
    'Natural',
    'Online',
    'Premium',
    'Enhanced',
    'Siri',
    'Xiaoxiao',
    'Yunxi',
    'Yunjian',
    'Xiaoyi',
    'Yunxia',
    'Yunye',
    'Tingting',
    'Ting-Ting',
    'Meijia',
    'Mei-Jia',
    'Sinji',
    'Li-mu',
    'Yu-shu',
    'Huihui',
    'Yaoyao',
    'Google 普通话',
    'Google Chinese'
  ];

  function glyphCount(text) {
    return [...String(text || '')].filter((ch) => !PUNCT.has(ch)).length;
  }

  function zhVoices() {
    if (!hasSpeech) return [];
    try {
      return (Speech.getVoices() || []).filter((v) => /^zh/i.test(v.lang));
    } catch (e) {
      return [];
    }
  }

  function defaultVoice(list) {
    if (!list || !list.length) return null;
    for (const name of VOICE_PREF) {
      const hit = list.find((v) => v.name && v.name.toLowerCase().includes(name.toLowerCase()));
      if (hit) return hit;
    }
    return list.find((v) => /zh[-_]CN/i.test(v.lang)) || list[0];
  }

  function currentVoice() {
    const list = state.speech.voices;
    if (!list.length) return null;
    return list.find((v) => v.name === state.speech.voiceName) || defaultVoice(list);
  }

  function refreshVoiceSelect() {
    if (!els.voiceSelect) return;
    const sp = state.speech;
    els.voiceSelect.innerHTML = '';
    if (!sp.voices.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = hasSpeech ? '未找到中文语音' : '不支持朗读';
      els.voiceSelect.appendChild(opt);
      return;
    }
    sp.voices.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = v.name + (v.lang ? ' · ' + v.lang : '');
      els.voiceSelect.appendChild(opt);
    });
    if (!sp.voices.some((v) => v.name === sp.voiceName)) {
      const d = defaultVoice(sp.voices);
      sp.voiceName = d ? d.name : sp.voices[0].name;
    }
    els.voiceSelect.value = sp.voiceName;
  }

  function loadVoices() {
    if (!hasSpeech) return;
    const sp = state.speech;
    sp.voices = zhVoices();
    if (!sp.voices.some((v) => v.name === sp.voiceName)) {
      const d = defaultVoice(sp.voices);
      sp.voiceName = d ? d.name : '';
    }
    refreshVoiceSelect();
    updateSpeechMenu();
  }

  function updateSpeechMenu() {
    const sp = state.speech;
    if (els.speechToggle) {
      els.speechToggle.textContent = sp.enabled ? '关闭朗读' : '开启朗读';
      els.speechToggle.classList.toggle('on', sp.enabled);
    }
    if (els.btnRead) {
      els.btnRead.classList.toggle('on', sp.enabled);
      els.btnRead.title = !hasSpeech
        ? '当前浏览器不支持朗读'
        : sp.enabled
          ? '朗读：开（落笔时逐句读）'
          : '朗读：关';
    }
    if (els.speechRate && document.activeElement !== els.speechRate) {
      els.speechRate.value = String(sp.rate);
    }
    if (els.speechNote) {
      els.speechNote.textContent = !hasSpeech
        ? '当前浏览器不支持系统朗读。'
        : !sp.voices.length
          ? '没有找到中文语音；请先在系统设置里安装中文语音（如 Tingting）。'
          : '落笔时逐句朗读。优先选 Natural / Premium；Edge 的微软自然音色比 Chrome 自带普通话更自然。';
    }
  }

  function initSpeech() {
    const sp = state.speech;
    sp.supported = hasSpeech;
    if (!hasSpeech) {
      updateSpeechMenu();
      return;
    }
    try {
      const v = localStorage.getItem('shufa:voice');
      if (v) sp.voiceName = v;
    } catch (e) {
      /* ignore */
    }
    try {
      const r = parseFloat(localStorage.getItem('shufa:speechRate'));
      if (Number.isFinite(r)) sp.rate = clamp(r, 0.7, 1.2);
    } catch (e) {
      /* ignore */
    }
    if (els.speechRate) els.speechRate.value = String(sp.rate);
    loadVoices();
    if (Speech.addEventListener) Speech.addEventListener('voiceschanged', loadVoices);
    updateSpeechMenu();
  }

  function buildSpeechSegments(poem, tl) {
    const sp = state.speech;
    sp.segments = [];
    if (!poem || !tl) return;
    const headGlyphs = glyphCount(poem.title) + glyphCount(poem.subtitle || '');
    const headText = [poem.title, poem.subtitle, poem.author].filter(Boolean).join('，');
    if (headText) {
      const t0 = headGlyphs && tl.chars[0] ? tl.chars[0].t0 : 0;
      sp.segments.push({
        text: headText,
        start: Math.max(0, t0 - 80),
        rate: 0.8 * sp.rate,
        pitch: 1.0
      });
    }
    const body = tl.chars.slice(headGlyphs);
    let idx = 0;
    const n = poem.lines.length;
    poem.lines.forEach((line, i) => {
      const count = glyphCount(line.text);
      if (!count) return;
      const first = body[idx];
      idx += count;
      if (!first) return;
      const isFirst = i === 0;
      const isLast = i === n - 1;
      const lineRate = 0.9 * (isLast ? 0.82 : isFirst ? 0.96 : 1.0);
      sp.segments.push({
        text: line.text,
        start: first.t0 + 60,
        rate: lineRate * sp.rate,
        pitch: isLast ? 0.96 : isFirst ? 0.99 : 1.0
      });
    });
    sp.segments.sort((a, b) => a.start - b.start);
    sp.next = sp.segments.findIndex((s) => s.start >= state.t - 200);
    if (sp.next < 0) sp.next = sp.segments.length;
  }

  function speakSegment(seg) {
    if (!seg || !seg.text || !hasSpeech) return;
    const voice = currentVoice();
    if (!voice) return;
    const u = new SpeechSynthesisUtterance(seg.text);
    u.voice = voice;
    u.lang = voice.lang || 'zh-CN';
    u.rate = clamp(seg.rate || 0.9, 0.5, 1.6);
    u.pitch = seg.pitch || 1;
    u.volume = 0.95;
    Speech.speak(u);
  }

  function speechTick(t) {
    const sp = state.speech;
    if (!sp.enabled || !hasSpeech) return;
    while (sp.next < sp.segments.length && sp.segments[sp.next].start <= t + 120) {
      speakSegment(sp.segments[sp.next]);
      sp.next++;
    }
  }

  function speakFromCurrent() {
    const sp = state.speech;
    if (!sp.enabled || !hasSpeech || !sp.segments.length) return;
    let idx = -1;
    for (let i = 0; i < sp.segments.length; i++) {
      if (sp.segments[i].start <= state.t + 120) idx = i;
    }
    Speech.cancel();
    if (idx >= 0) {
      speakSegment(sp.segments[idx]);
      sp.next = idx + 1;
    } else {
      sp.next = 0;
    }
  }

  function cancelSpeech() {
    if (hasSpeech) {
      try {
        Speech.cancel();
      } catch (e) {
        /* ignore */
      }
    }
  }

  function resetSpeechAt(t) {
    const sp = state.speech;
    if (!sp || !hasSpeech || !sp.enabled) return;
    Speech.cancel();
    sp.next = sp.segments.findIndex((s) => s.start >= t - 200);
    if (sp.next < 0) sp.next = sp.segments.length;
  }

  function setReading(on) {
    const sp = state.speech;
    if (!hasSpeech) {
      showToast('当前浏览器不支持朗读', true);
      return;
    }
    if (on && !sp.voices.length) {
      loadVoices();
      if (!sp.voices.length) {
        showToast('没有找到中文语音，请先在系统里安装中文语音', true);
        return;
      }
    }
    sp.enabled = !!on;
    updateSpeechMenu();
    if (sp.enabled) {
      speakFromCurrent();
      closeSpeechMenu();
      showToast('朗读已开启');
    } else {
      cancelSpeech();
      showToast('朗读已关闭');
    }
  }

  function positionSpeechMenu() {
    if (!els.speechMenu || !els.btnRead) return;
    const r = els.btnRead.getBoundingClientRect();
    const m = els.speechMenu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = r.left + r.width / 2 - m.width / 2;
    left = clamp(left, 12, vw - m.width - 12);
    let top = r.top - m.height - 12;
    if (top < 12) top = clamp(r.bottom + 12, 12, vh - m.height - 12);
    els.speechMenu.style.left = Math.round(left) + 'px';
    els.speechMenu.style.top = Math.round(top) + 'px';
  }

  function openSpeechMenu() {
    if (!els.speechMenu || document.body.classList.contains('clean')) return;
    closeSealMenu();
    closeColorMenu();
    loadVoices();
    updateSpeechMenu();
    els.speechMenu.hidden = false;
    positionSpeechMenu();
  }

  function closeSpeechMenu() {
    if (els.speechMenu) els.speechMenu.hidden = true;
  }

  function toggleSpeechMenu() {
    if (!els.speechMenu) return;
    if (els.speechMenu.hidden) openSpeechMenu();
    else closeSpeechMenu();
  }

  /* ---------------- 放大镜 / 书写焦点 ---------------- */

  function updateSheen() {
    if (!els.paper) return;
    const cell = els.text && els.text.querySelector('.cell.writing');
    if (!cell) return;
    const pr = els.paper.getBoundingClientRect();
    if (!pr.width) return;
    const cr = cell.getBoundingClientRect();
    const k = pr.width / (state.paperW || pr.width);
    const x = (cr.left + cr.width / 2 - pr.left) / k;
    const y = (cr.top + cr.height / 2 - pr.top) / k;
    els.paper.style.setProperty('--lx', x.toFixed(0) + 'px');
    els.paper.style.setProperty('--ly', y.toFixed(0) + 'px');
  }

  function applyLens() {
    document.body.classList.toggle('lens-on', !!state.lens);
    [els.btnLens, els.mLens].forEach((btn) => {
      if (!btn) return;
      btn.classList.toggle('on', !!state.lens);
      btn.title = state.lens ? '放大镜：开（突出正在写的字）' : '放大镜：关';
    });
  }

  function toggleLens() {
    state.lens = !state.lens;
    try {
      localStorage.setItem('shufa:lens', state.lens ? '1' : '0');
    } catch (e) {
      /* ignore */
    }
    applyLens();
    showToast(state.lens ? '放大镜：开' : '放大镜：关');
  }

  /* ---------------- 控件 ---------------- */

  function fillPoemSelect() {
    els.poemSelect.innerHTML = '';
    (window.SHUFA_POEMS || []).forEach((poem) => {
      const opt = document.createElement('option');
      opt.value = poem.id;
      opt.textContent =
        poem.title +
        (poem.subtitle ? ' · ' + poem.subtitle : '') +
        ' · ' +
        poem.author;
      els.poemSelect.appendChild(opt);
    });
    const custom = document.createElement('option');
    custom.value = 'custom-new';
    custom.textContent = '写自己的…';
    els.poemSelect.appendChild(custom);
  }

  function bindControls() {
    document.querySelectorAll('#modes button').forEach((b) => {
      b.addEventListener('click', () => setMode(b.dataset.mode, false));
    });

    if (els.quickOpen) {
      els.quickOpen.addEventListener('click', () => openCompose(true));
    }
    if (els.btnLens) els.btnLens.addEventListener('click', toggleLens);
    if (els.mLens) els.mLens.addEventListener('click', toggleLens);
    if (els.btnRead) {
      els.btnRead.addEventListener('click', (e) => {
        e.stopPropagation();
        if (document.body.classList.contains('clean')) return;
        toggleSpeechMenu();
      });
    }
    if (els.speechToggle) els.speechToggle.addEventListener('click', () => setReading(!state.speech.enabled));
    if (els.voiceSelect) {
      els.voiceSelect.addEventListener('change', () => {
        state.speech.voiceName = els.voiceSelect.value;
        try {
          localStorage.setItem('shufa:voice', state.speech.voiceName);
        } catch (e) {
          /* ignore */
        }
      });
    }
    if (els.speechRate) {
      els.speechRate.addEventListener('change', () => {
        const r = parseFloat(els.speechRate.value);
        if (Number.isFinite(r)) state.speech.rate = r;
        try {
          localStorage.setItem('shufa:speechRate', String(state.speech.rate));
        } catch (e) {
          /* ignore */
        }
      });
    }
    if (els.speechTest) {
      els.speechTest.addEventListener('click', () => {
        if (!hasSpeech) return;
        if (!state.speech.voices.length) loadVoices();
        if (!state.speech.voices.length) {
          showToast('没有找到中文语音', true);
          return;
        }
        const voice = currentVoice();
        if (!voice) return;
        const sample =
          state.poem && state.poem.lines && state.poem.lines[0]
            ? state.poem.lines[0].text
            : '庐山烟雨浙江潮。';
        Speech.cancel();
        const u = new SpeechSynthesisUtterance(sample);
        u.voice = voice;
        u.lang = voice.lang || 'zh-CN';
        u.rate = clamp(0.92 * state.speech.rate, 0.5, 1.6);
        u.pitch = 0.99;
        u.volume = 0.95;
        Speech.speak(u);
      });
    }
    if (els.mReplay) els.mReplay.addEventListener('click', () => replay());
    if (els.mPause) els.mPause.addEventListener('click', () => togglePause());
    if (els.mMore) els.mMore.addEventListener('click', () => toggleSheet());
    if (els.sheetClose) els.sheetClose.addEventListener('click', () => closeSheet());
    if (els.sheetBackdrop) els.sheetBackdrop.addEventListener('click', () => closeSheet());
    const mq = window.matchMedia(MOBILE_QUERY);
    const onMobileChange = () => {
      layoutForViewport();
      fitPaper();
    };
    if (mq.addEventListener) mq.addEventListener('change', onMobileChange);
    else if (mq.addListener) mq.addListener(onMobileChange);
    if (els.sceneSelect) {
      els.sceneSelect.addEventListener('change', () => setScene(els.sceneSelect.value, true));
    }

    els.seal.addEventListener('click', (e) => {
      e.stopPropagation();
      if (document.body.classList.contains('clean')) return;
      toggleSealMenu();
    });
    els.seal.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        if (!document.body.classList.contains('clean')) openSealMenu();
      }
    });
    if (els.sealForm) {
      els.sealForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = [...els.sealInput.value.trim()].slice(0, 2).join('');
        if (!text) {
          els.sealInput.focus();
          return;
        }
        setSeal(text);
      });
    }
    if (els.sealOff) els.sealOff.addEventListener('click', () => setSeal(''));
    if (els.btnColor) {
      els.btnColor.addEventListener('click', (e) => {
        e.stopPropagation();
        if (document.body.classList.contains('clean')) return;
        toggleColorMenu();
      });
    }
    if (els.colorInput) {
      els.colorInput.addEventListener('change', () => setInk(els.colorInput.value, true));
    }
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (els.sealMenu && !els.sealMenu.hidden) {
          if (!els.sealMenu.contains(e.target) && !els.seal.contains(e.target)) closeSealMenu();
        }
        if (els.colorMenu && !els.colorMenu.hidden) {
          if (!els.colorMenu.contains(e.target) && !els.btnColor.contains(e.target)) closeColorMenu();
        }
        if (els.speechMenu && !els.speechMenu.hidden) {
          if (!els.speechMenu.contains(e.target) && !els.btnRead.contains(e.target)) closeSpeechMenu();
        }
      },
      true
    );

    els.btnReplay.addEventListener('click', replay);
    els.btnPause.addEventListener('click', () => togglePause());

    if (els.quick) {
      els.quick.addEventListener('submit', (e) => {
        e.preventDefault();
        quickSubmit();
      });
      els.quickMore.addEventListener('click', () => {
        const text = els.quickText.value.trim();
        openCompose(true);
        if (text) els.cText.value = text;
        setTimeout(() => els.cText.focus(), 60);
      });
    }

    let scrubTimer = 0;
    const endScrub = () => {
      if (!state.scrubbing) return;
      state.scrubbing = false;
      state.lastTs = performance.now();
      window.clearTimeout(scrubTimer);
    };
    els.timeRange.addEventListener('pointerdown', () => {
      if (state.timeline) state.scrubbing = true;
    });
    els.timeRange.addEventListener('input', () => {
      if (!state.timeline) return;
      state.scrubbing = true;
      window.clearTimeout(scrubTimer);
      scrubTimer = window.setTimeout(endScrub, 800);
      seek(parseFloat(els.timeRange.value) * state.timeline.duration);
    });
    els.timeRange.addEventListener('change', endScrub);
    window.addEventListener('pointerup', endScrub);
    window.addEventListener('pointercancel', endScrub);

    els.speedRange.addEventListener('input', () => {
      setSpeed(parseFloat(els.speedRange.value), true);
    });

    els.btnSave.addEventListener('click', async () => {
      if (els.btnSave.disabled) return;
      els.btnSave.disabled = true;
      els.btnSave.textContent = '…';
      try {
        await exportPNG();
      } finally {
        els.btnSave.disabled = false;
        els.btnSave.textContent = '存图';
      }
    });

    els.fontSelect.addEventListener('change', () => {
      setFont(els.fontSelect.value, true);
    });

    els.btnGrid.addEventListener('click', () => {
      const on = els.paper.classList.toggle('show-grid');
      els.btnGrid.classList.toggle('on', on);
    });

    els.btnSound.addEventListener('click', () => {
      audio.enabled = !audio.enabled;
      if (audio.enabled) audio.init();
      els.btnSound.classList.toggle('on', audio.enabled);
      els.btnSound.textContent = audio.enabled ? '声' : '静';
      els.btnSound.title = audio.enabled ? '笔触声：开' : '笔触声：关';
    });

    els.poemSelect.addEventListener('change', () => {
      const v = els.poemSelect.value;
      if (v === 'custom-new') {
        openCompose();
        return;
      }
      if (v === 'custom') {
        if (state.customPoem) show(state.customPoem, { animate: true });
        return;
      }
      show(v, { animate: true });
    });

    if (els.compose) {
      els.cCancel.addEventListener('click', () => els.compose.close());
      els.cText.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          submitCompose();
        }
      });
      els.cGo.addEventListener('click', submitCompose);
      const form = els.compose.querySelector('form');
      if (form) {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          submitCompose();
        });
      }
      els.compose.addEventListener('close', () => {
        const v = els.poemSelect.value;
        if (v === 'custom-new' || v === 'custom') {
          els.poemSelect.value = state.poem && state.poem.id === 'custom' ? 'custom' : state.poemId;
        }
      });
    }

    window.addEventListener('keydown', (e) => {
      if (els.compose && els.compose.open) return;
      if (
        (els.sealMenu && !els.sealMenu.hidden) ||
        (els.colorMenu && !els.colorMenu.hidden) ||
        (els.speechMenu && !els.speechMenu.hidden)
      ) {
        if (e.key === 'Escape') {
          closeSealMenu();
          closeColorMenu();
          closeSpeechMenu();
        }
        return;
      }
      if (els.sheet && !els.sheet.hidden) {
        if (e.key === 'Escape') closeSheet();
        /* 面板打开时仍允许空格 / R / G，只是 Esc 先收起 */
      }
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
      if (e.target && e.target.isContentEditable) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePause();
      } else if (e.key === 'r' || e.key === 'R') {
        replay();
      } else if (e.key === 'g' || e.key === 'G') {
        els.btnGrid.click();
      } else if (e.key === '[') {
        setSpeed(state.speed - 0.1, true);
      } else if (e.key === ']') {
        setSpeed(state.speed + 0.1, true);
      } else if (e.key === 'Home') {
        seek(0);
      } else if (e.key === 'End' && state.timeline) {
        seek(state.timeline.duration);
      }
    });

    document.addEventListener(
      'pointerdown',
      () => {
        if (audio.enabled) audio.init();
      },
      { passive: true }
    );

    let tiltFrame = 0;
    window.addEventListener(
      'pointermove',
      (e) => {
        if (tiltFrame) return;
        tiltFrame = window.requestAnimationFrame(() => {
          tiltFrame = 0;
          const x = e.clientX / window.innerWidth - 0.5;
          const y = e.clientY / window.innerHeight - 0.5;
          els.paper.style.setProperty('--ry', (x * 1.2).toFixed(2) + 'deg');
          els.paper.style.setProperty('--rx', (-y * 0.8).toFixed(2) + 'deg');
        });
      },
      { passive: true }
    );

    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        const vertical = chooseVertical();
        if (vertical !== state.vertical) {
          show(state.poem, isFinished() ? { still: 1 } : { animate: true });
        } else {
          fitPaper();
        }
      }, 220);
    });

    window.addEventListener('load', fitPaper);
    document.fonts && document.fonts.ready.then(fitPaper);
  }

  /* ---------------- 启动 ---------------- */

  function boot() {
    window.HANZI_STROKES = window.HANZI_STROKES || {};
    fillPoemSelect();
    buildFontSelect();
    buildSceneSelect();
    buildSealMenu();
    buildColorMenu();
    bindControls();
    layoutForViewport();
    initSpeech();
    setPausedLabel(false);

    let savedFont = 'kai';
    try {
      savedFont = localStorage.getItem('shufa:font') || 'kai';
    } catch (e) {
      /* ignore */
    }
    setFont(savedFont);

    let savedSpeed = 1;
    try {
      const v = parseFloat(localStorage.getItem('shufa:speed'));
      if (Number.isFinite(v)) savedSpeed = v;
    } catch (e) {
      /* ignore */
    }
    setSpeed(savedSpeed);

    const params = new URLSearchParams(location.search);
    if (params.has('clean')) document.body.classList.add('clean');

    try {
      const savedSeal = localStorage.getItem('shufa:seal');
      if (savedSeal !== null) state.seal = savedSeal;
    } catch (e) {
      /* ignore */
    }

    try {
      const savedInk = localStorage.getItem('shufa:ink');
      if (savedInk && /^#[0-9a-f]{6}$/i.test(savedInk)) state.ink = savedInk;
    } catch (e) {
      /* ignore */
    }

    try {
      const savedLens = localStorage.getItem('shufa:lens');
      if (savedLens === '0') state.lens = false;
    } catch (e) {
      /* ignore */
    }
    applyLens();

    let savedMode = 'write';
    try {
      savedMode = localStorage.getItem('shufa:mode') || 'write';
    } catch (e) {
      /* ignore */
    }
    const modeParam = params.get('mode');
    state.mode = ['write', 'brush', 'ink'].includes(modeParam)
      ? modeParam
      : ['write', 'brush', 'ink'].includes(savedMode)
        ? savedMode
        : 'write';
    let savedScene = 'zhu';
    try {
      savedScene = localStorage.getItem('shufa:scene') || 'zhu';
    } catch (e) {
      /* ignore */
    }
    const sceneParam = params.get('scene');
    state.scene = SCENES[sceneParam] ? sceneParam : SCENES[savedScene] ? savedScene : 'zhu';
    setMode(state.mode, true);
    setScene(state.scene, false);

    const wanted = params.get('poem');
    if (wanted && (window.SHUFA_POEMS || []).some((p) => p.id === wanted)) {
      state.poemId = wanted;
    }

    const stillParam = params.get('p');
    const reduced =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const textParam = params.get('text');
    if (textParam) {
      if (els.loading) {
        els.loading.hidden = false;
        els.loading.textContent = '正在取字…';
      }
      loadPoemFromText(
        textParam,
        params.get('title') || '',
        params.get('author') || '',
        (msg) => {
          if (els.loading) els.loading.textContent = msg;
        }
      )
        .then((poem) => {
          if (els.loading) els.loading.hidden = true;
          state.customPoem = poem;
          state.customRaw = textParam;
          ensureCustomOption(poem);
          if (stillParam !== null) {
            let val = parseFloat(stillParam);
            if (!Number.isFinite(val)) val = 1;
            show(poem, { still: clamp(val, 0, 1) });
          } else {
            show(poem, { animate: !reduced, still: reduced ? 1 : null });
          }
        })
        .catch((err) => {
          if (els.loading) {
            els.loading.textContent = '取字失败：' + (err.message || '');
          }
          setTimeout(() => {
            if (els.loading) els.loading.hidden = true;
            show(state.poemId, { animate: !reduced, still: reduced ? 1 : null });
          }, 1800);
        });
      return;
    }

    if (stillParam !== null) {
      let val = parseFloat(stillParam);
      if (!Number.isFinite(val)) val = 1;
      show(state.poemId, { still: clamp(val, 0, 1) });
      return;
    }

    show(state.poemId, { animate: !reduced, still: reduced ? 1 : null });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
