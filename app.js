/* CAPTURE8 Photobooth — web app for iPad (Safari / Add to Home Screen). */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* =========================================================
 * Storage (IndexedDB)
 * ======================================================= */
const DB = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('capture8', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('kv');
      d.createObjectStore('templates', { keyPath: 'id' });
      d.createObjectStore('sessions', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const run = (store, mode, fn) => open().then((d) => new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req ? req.result : undefined);
    t.onerror = t.onabort = () => rej(t.error);
  }));
  return {
    get: (s, k) => run(s, 'readonly', (o) => o.get(k)),
    put: (s, v, k) => run(s, 'readwrite', (o) => (k === undefined ? o.put(v) : o.put(v, k))),
    del: (s, k) => run(s, 'readwrite', (o) => o.delete(k)),
    all: (s) => run(s, 'readonly', (o) => o.getAll()),
    clear: (s) => run(s, 'readwrite', (o) => o.clear()),
  };
})();

/* =========================================================
 * Settings
 * ======================================================= */
const DEFAULTS = {
  eventName: 'Selamat Datang!',
  subtitle: 'Ayo abadikan momen seru kamu',
  buttonText: 'Sentuh untuk Mulai',
  frameTitle: 'CAPTURE8',
  thanksText: 'Terima kasih!',
  themeColor: '#ff3d7f',
  cameraId: '',
  resolution: '1080',
  rotation: '0',
  mirrorPreview: true,
  mirrorPhoto: false,
  countdown: '3',
  betweenShots: '2',
  liveSeconds: '2',
  idleTimeout: '60',
  enableLive: true,
  enablePrint: true,
  enableShare: true,
  enableFilters: true,
  enableRetake: true,
  sound: true,
  flash: true,
  showCounter: true,
  maxPrints: '2',
  pin: '1234',
  disabledBuiltins: [],
  sessionCount: 0,
  firstRunDone: false,
};
let S = { ...DEFAULTS };
const saveSettings = () => DB.put('kv', S, 'settings');

/* =========================================================
 * UI helpers
 * ======================================================= */
let toastTimer;
function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}
let currentScreen = 'welcome';
function show(name) {
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
  currentScreen = name;
  document.body.classList.toggle('blur-preview', ['welcome', 'templates', 'processing', 'review', 'thanks'].includes(name));
  if (name === 'welcome') Preview.setAspect(null);
}
function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
function drawCover(ctx, img, x, y, w, h) {
  const iw = img.width || img.videoWidth, ih = img.height || img.videoHeight;
  const s = Math.max(w / iw, h / ih);
  const dw = iw * s, dh = ih * s;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}
const canvasToBlob = (c, type = 'image/jpeg', q = 0.93) => new Promise((r) => c.toBlob(r, type, q));
function loadImage(blobOrUrl) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
}
function applyTheme() {
  document.documentElement.style.setProperty('--accent', S.themeColor);
}
const fmtDate = () => new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

/* =========================================================
 * Sound (WebAudio, unlocked on first touch)
 * ======================================================= */
const Sound = (() => {
  let ac;
  const ctx = () => (ac ||= new (window.AudioContext || window.webkitAudioContext)());
  function beep(freq = 880, dur = 0.12, vol = 0.25) {
    if (!S.sound) return;
    const a = ctx(), o = a.createOscillator(), g = a.createGain();
    o.frequency.value = freq; o.type = 'sine';
    g.gain.setValueAtTime(vol, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
    o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + dur);
  }
  function shutter() {
    if (!S.sound) return;
    const a = ctx(), len = a.sampleRate * 0.18, buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = a.createBufferSource(), g = a.createGain();
    g.gain.value = 0.5; src.buffer = buf; src.connect(g).connect(a.destination); src.start();
  }
  return { beep, shutter, unlock: () => { try { ctx().resume(); } catch {} } };
})();

/* =========================================================
 * Camera
 * ======================================================= */
const Camera = {
  stream: null,
  video: $('#video'),
  async start() {
    this.stop();
    const h = +S.resolution, w = Math.round((h * 16) / 9);
    const video = { width: { ideal: w }, height: { ideal: h } };
    if (S.cameraId) video.deviceId = { exact: S.cameraId };
    else video.facingMode = 'user';
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (e) {
      if (S.cameraId) { // chosen camera unplugged → fall back to built-in
        toast('Kamera terpilih tidak ditemukan, memakai kamera iPad.');
        this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: w }, height: { ideal: h } } });
      } else throw e;
    }
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});
    const track = this.stream.getVideoTracks()[0];
    track.onended = () => { toast('Kamera terputus. Mencoba menyambung ulang…'); setTimeout(() => this.start().catch(() => {}), 1500); };
    const st = track.getSettings ? track.getSettings() : {};
    $('#cameraInfo').textContent = `Aktif: ${track.label || 'kamera'} — ${st.width || '?'}×${st.height || '?'}`;
  },
  stop() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
  },
  async list() {
    const devs = await navigator.mediaDevices.enumerateDevices();
    return devs.filter((d) => d.kind === 'videoinput');
  },
  ready() { return this.video.videoWidth > 0; },
  /** Oriented source size (after rotation). */
  size() {
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    return (+S.rotation) % 180 ? [vh, vw] : [vw, vh];
  },
  /** Draws the camera frame, cover-cropped and centered, into a rect. */
  draw(ctx, x, y, w, h, mirror) {
    const v = this.video, [ow, oh] = this.size();
    const s = Math.max(w / ow, h / oh);
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.scale(mirror ? -s : s, s);
    ctx.rotate((+S.rotation * Math.PI) / 180);
    ctx.drawImage(v, -v.videoWidth / 2, -v.videoHeight / 2);
    ctx.restore();
  },
  /** Grabs a frame cropped to `aspect` (w/h), longest side ≤ maxDim. */
  grab(aspect, maxDim = 2400, mirror = S.mirrorPhoto) {
    const [ow, oh] = this.size();
    let cw, ch;
    if (ow / oh > aspect) { ch = oh; cw = oh * aspect; } else { cw = ow; ch = ow / aspect; }
    const k = Math.min(1, maxDim / Math.max(cw, ch));
    const c = newCanvas(cw * k, ch * k);
    this.draw(c.getContext('2d'), 0, 0, c.width, c.height, mirror);
    return c;
  },
};

/* Live preview canvas — shows exactly the crop that will be captured. */
const Preview = (() => {
  const c = $('#preview'), ctx = c.getContext('2d');
  let aspect = null;
  function loop() {
    requestAnimationFrame(loop);
    if (!Camera.ready()) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(c.clientWidth * dpr), H = Math.round(c.clientHeight * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (!aspect) { Camera.draw(ctx, 0, 0, W, H, S.mirrorPreview); return; }
    // fit the capture area as large as possible, dim outside
    let w = W, h = W / aspect;
    if (h > H) { h = H; w = H * aspect; }
    const x = (W - w) / 2, y = (H - h) / 2;
    Camera.draw(ctx, x, y, w, h, S.mirrorPreview);
  }
  requestAnimationFrame(loop);
  return { setAspect: (a) => { aspect = a; } };
})();

/* =========================================================
 * Filters (pixel based — works on every Safari version)
 * ======================================================= */
const FILTERS = [
  { id: 'normal', name: 'Normal' },
  { id: 'bw', name: 'Hitam Putih' },
  { id: 'vintage', name: 'Vintage' },
  { id: 'warm', name: 'Hangat' },
  { id: 'cool', name: 'Sejuk' },
  { id: 'pop', name: 'Pop' },
];
function applyFilter(src, id) {
  if (id === 'normal') return src;
  const c = newCanvas(src.width, src.height), ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height), d = img.data;
  const contrast = (v, k) => (v - 128) * k + 128;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    switch (id) {
      case 'bw': r = g = b = contrast(l, 1.25); break;
      case 'vintage': {
        const sr = l * 1.07 + 25, sg = l * 0.95 + 12, sb = l * 0.78;
        r = r * 0.35 + sr * 0.65; g = g * 0.35 + sg * 0.65; b = b * 0.35 + sb * 0.65;
        r = r * 0.88 + 22; g = g * 0.88 + 18; b = b * 0.88 + 14; // faded blacks
        break;
      }
      case 'warm': r = r * 1.08 + 6; g = g * 1.02; b = b * 0.88; break;
      case 'cool': r = r * 0.9; g = g * 1.0; b = b * 1.1 + 8; break;
      case 'pop': {
        r = l + (r - l) * 1.4; g = l + (g - l) * 1.4; b = l + (b - l) * 1.4;
        r = contrast(r, 1.12); g = contrast(g, 1.12); b = contrast(b, 1.12);
        break;
      }
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b; // Uint8ClampedArray clamps
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/* =========================================================
 * Templates
 *  t = { id, name, w, h, slots:[{x,y,w,h}], shots, mode:'photo'|'live',
 *        builtin, enabled, overlay: Image|Canvas, blob? }
 * ======================================================= */
const Templates = (() => {
  let list = [];

  // ---- built-in frames, drawn from settings (event name / theme color) ----
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function frameCanvas(w, h, slots, bg, decorate, radius = 0) {
    const c = newCanvas(w, h), ctx = c.getContext('2d');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    decorate && decorate(ctx);
    ctx.globalCompositeOperation = 'destination-out';
    slots.forEach((s) => { roundRect(ctx, s.x, s.y, s.w, s.h, radius); ctx.fill(); });
    ctx.globalCompositeOperation = 'source-over';
    return c;
  }
  function text(ctx, str, x, y, size, color, weight = 800, maxW) {
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let s = size;
    do { ctx.font = `${weight} ${s}px -apple-system, "Helvetica Neue", Arial, sans-serif`; s -= 2; }
    while (maxW && ctx.measureText(str).width > maxW && s > 10);
    ctx.fillText(str, x, y);
  }
  const BUILTINS = {
    strip: () => { // 4x6 with two identical 2x6 strips, 3 photos each
      const W = 1200, H = 1800, m = 45, sw = 600, gap = 30, ph = 410, slots = [];
      for (let col = 0; col < 2; col++) for (let i = 0; i < 3; i++)
        slots.push({ x: col * sw + m, y: m + i * (ph + gap), w: sw - m * 2, h: ph });
      const overlay = frameCanvas(W, H, slots, '#ffffff', (ctx) => {
        for (let col = 0; col < 2; col++) {
          const cx = col * sw + sw / 2, y0 = m + 3 * (ph + gap);
          ctx.fillStyle = S.themeColor; ctx.fillRect(col * sw + m, y0 + 20, sw - m * 2, 6);
          text(ctx, S.frameTitle, cx, y0 + 110, 64, '#111', 900, sw - m * 2 - 20);
          text(ctx, fmtDate(), cx, y0 + 180, 30, '#666', 600);
          text(ctx, '♥', cx, y0 + 240, 40, S.themeColor, 900);
        }
        ctx.strokeStyle = '#ddd'; ctx.setLineDash([10, 10]); ctx.beginPath(); ctx.moveTo(sw, 0); ctx.lineTo(sw, H); ctx.stroke();
      }, 8);
      return { name: 'Strip Klasik (2×6, 3 foto)', w: W, h: H, slots, shots: 3, overlay, mode: 'photo' };
    },
    grid: () => { // 4x6 landscape, 2x2
      const W = 1800, H = 1200, m = 50, gap = 26, bar = 170;
      const pw = (W - m * 2 - gap) / 2, ph = (H - m * 2 - gap - bar) / 2, slots = [];
      for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) slots.push({ x: m + c * (pw + gap), y: m + r * (ph + gap), w: pw, h: ph });
      const overlay = frameCanvas(W, H, slots, '#111118', (ctx) => {
        text(ctx, S.frameTitle, W / 2, H - m - bar / 2 + 5, 72, '#fff', 900, W - 400);
        text(ctx, fmtDate(), W / 2, H - m - 22, 28, S.themeColor, 700);
      }, 18);
      return { name: 'Grid 2×2 (4R landscape)', w: W, h: H, slots, shots: 4, overlay, mode: 'photo' };
    },
    polaroid: () => { // single photo polaroid 4x6 portrait
      const W = 1200, H = 1800, m = 80, slots = [{ x: m, y: m, w: W - m * 2, h: 1300 }];
      const overlay = frameCanvas(W, H, slots, '#fbf8f2', (ctx) => {
        text(ctx, S.frameTitle, W / 2, 1530, 96, '#222', 900, W - 200);
        text(ctx, fmtDate(), W / 2, 1650, 36, '#888', 600);
      });
      return { name: 'Polaroid (1 foto)', w: W, h: H, slots, shots: 1, overlay, mode: 'photo' };
    },
    live: () => { // 4:5 frame for live photo / boomerang
      const W = 1080, H = 1350, m = 40, bar = 150, slots = [{ x: m, y: m, w: W - m * 2, h: H - m * 2 - bar }];
      const overlay = frameCanvas(W, H, slots, '#ffffff', (ctx) => {
        text(ctx, S.frameTitle, W / 2, H - bar - 40 + 75, 62, '#111', 900, W - 160);
        text(ctx, fmtDate(), W / 2, H - 45, 26, S.themeColor, 700);
      }, 14);
      return { name: 'Live Photo Frame', w: W, h: H, slots, shots: 1, overlay, mode: 'live' };
    },
  };

  // ---- detect transparent "holes" in an uploaded PNG ----
  function detectSlots(img) {
    const scale = Math.min(1, 360 / Math.max(img.width, img.height));
    const sw = Math.round(img.width * scale), sh = Math.round(img.height * scale);
    const c = newCanvas(sw, sh), ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, sw, sh);
    const a = ctx.getImageData(0, 0, sw, sh).data;
    const mask = new Uint8Array(sw * sh);
    for (let i = 0; i < sw * sh; i++) mask[i] = a[i * 4 + 3] < 128 ? 1 : 0;
    const seen = new Uint8Array(sw * sh), comps = [], stack = [];
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i] || seen[i]) continue;
      let minX = sw, minY = sh, maxX = 0, maxY = 0, area = 0;
      stack.push(i); seen[i] = 1;
      while (stack.length) {
        const p = stack.pop(), x = p % sw, y = (p / sw) | 0;
        area++;
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
        const nb = [x > 0 ? p - 1 : -1, x < sw - 1 ? p + 1 : -1, y > 0 ? p - sw : -1, y < sh - 1 ? p + sw : -1];
        for (const q of nb) if (q >= 0 && mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
      if (area > sw * sh * 0.01) comps.push({ x: minX / scale, y: minY / scale, w: (maxX - minX + 1) / scale, h: (maxY - minY + 1) / scale });
    }
    // order: two identical columns (double strip) → column by column, else row by row
    const colTol = img.width * 0.08;
    const cols = [];
    comps.forEach((s) => {
      const cx = s.x + s.w / 2;
      let col = cols.find((c) => Math.abs(c.cx - cx) < colTol);
      if (!col) cols.push((col = { cx, items: [] }));
      col.items.push(s);
    });
    let shots = comps.length, slots;
    const isDouble = cols.length === 2 && cols[0].items.length === cols[1].items.length && cols[0].items.length >= 2;
    if (isDouble) {
      cols.sort((a, b) => a.cx - b.cx);
      cols.forEach((c) => c.items.sort((a, b) => a.y - b.y));
      slots = [...cols[0].items, ...cols[1].items];
      shots = cols[0].items.length;
    } else {
      const rowTol = img.height * 0.04;
      slots = comps.sort((a, b) => (Math.abs(a.y - b.y) < rowTol ? a.x - b.x : a.y - b.y));
    }
    return { slots, shots };
  }

  async function load() {
    const out = [];
    for (const [key, make] of Object.entries(BUILTINS)) {
      const t = make();
      out.push({ ...t, id: 'builtin-' + key, builtin: true, enabled: !S.disabledBuiltins.includes('builtin-' + key) });
    }
    const stored = await DB.all('templates');
    stored.sort((a, b) => a.created - b.created);
    for (const rec of stored) {
      try {
        const overlay = await loadImage(rec.blob);
        out.push({ ...rec, overlay, builtin: false });
      } catch { /* skip broken */ }
    }
    list = out;
    return list;
  }

  async function addFromFile(file) {
    const img = await loadImage(file);
    const { slots, shots } = detectSlots(img);
    if (!slots.length) throw new Error(`"${file.name}" tidak punya area transparan. Simpan dari Canva sebagai PNG dengan "Latar belakang transparan".`);
    const rec = {
      id: 'tpl-' + Date.now() + Math.random().toString(36).slice(2, 6),
      name: file.name.replace(/\.png$/i, ''), w: img.width, h: img.height, slots, shots,
      mode: 'photo', enabled: true, blob: file, created: Date.now(),
    };
    await DB.put('templates', rec);
    return rec;
  }

  async function update(t, patch) {
    Object.assign(t, patch);
    if (t.builtin) {
      if ('enabled' in patch) {
        S.disabledBuiltins = S.disabledBuiltins.filter((x) => x !== t.id);
        if (!t.enabled) S.disabledBuiltins.push(t.id);
        await saveSettings();
      }
    } else {
      const { overlay, builtin, ...rec } = t;
      await DB.put('templates', rec);
    }
  }

  const forMode = (mode) => list.filter((t) => t.enabled && (mode === 'live' ? t.mode === 'live' : t.mode !== 'live'));

  /** Slot aspect for shot i (first slot that shows shot i). */
  const shotAspect = (t, i) => { const s = t.slots[i % t.slots.length]; return s.w / s.h; };

  /** Composite shots into the template. Returns a canvas at scale k of template size. */
  function compose(t, shots, k = 1) {
    const c = newCanvas(t.w * k, t.h * k);
    composeInto(c.getContext('2d'), t, shots, k);
    return c;
  }
  function composeInto(ctx, t, shots, k) {
    const c = ctx.canvas;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    t.slots.forEach((s, j) => {
      const shot = shots[j % t.shots];
      if (shot) drawCover(ctx, shot, s.x * k, s.y * k, s.w * k, s.h * k);
      else { ctx.fillStyle = '#3a3a48'; ctx.fillRect(s.x * k, s.y * k, s.w * k, s.h * k); }
    });
    ctx.drawImage(t.overlay, 0, 0, c.width, c.height);
  }

  /** Preview with numbered placeholders. */
  function preview(t, height = 400) {
    const k = height / t.h, c = newCanvas(t.w * k, height), ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    t.slots.forEach((s, j) => {
      const hue = ((j % t.shots) * 67 + 200) % 360;
      ctx.fillStyle = `hsl(${hue} 45% 55%)`;
      ctx.fillRect(s.x * k, s.y * k, s.w * k, s.h * k);
      ctx.fillStyle = '#fff'; ctx.font = `800 ${Math.max(14, s.h * k * 0.3)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String((j % t.shots) + 1), (s.x + s.w / 2) * k, (s.y + s.h / 2) * k);
    });
    ctx.drawImage(t.overlay, 0, 0, c.width, c.height);
    return c;
  }

  return { load, addFromFile, update, forMode, shotAspect, compose, composeInto, preview, get list() { return list; },
    remove: async (t) => { await DB.del('templates', t.id); list = list.filter((x) => x !== t); } };
})();

/* =========================================================
 * Session flow
 * ======================================================= */
const Session = {
  token: 0, mode: 'photo', template: null, shots: [], frames: [], filter: 'normal',
  result: null, liveBlob: null, prints: 0, savedId: null,
};
let idleTimer, idleTick;

function stopIdle() { clearTimeout(idleTimer); clearInterval(idleTick); $('#autoClose').textContent = ''; }
function startIdle() {
  stopIdle();
  let left = +S.idleTimeout;
  const upd = () => { $('#autoClose').textContent = `Kembali otomatis dalam ${left} detik`; };
  upd();
  idleTick = setInterval(() => { left--; upd(); if (left <= 0) finish(); }, 1000);
}

function goHome() {
  Session.token++;
  stopIdle();
  Live.stop();
  $('#flash').classList.remove('on');
  show('welcome');
}

async function chooseMode(mode) {
  Sound.unlock();
  if (!Camera.ready()) {
    try { await Camera.start(); } catch { toast('Kamera belum diizinkan. Buka Pengaturan iPad → Safari → Kamera → Izinkan.'); return; }
  }
  const opts = Templates.forMode(mode);
  if (!opts.length) { toast('Belum ada template aktif untuk mode ini. Aktifkan di Pengaturan → Template.'); return; }
  Session.mode = mode;
  if (opts.length === 1) return startSession(opts[0]);
  const box = $('#templateChoices');
  box.innerHTML = '';
  opts.forEach((t) => {
    const b = document.createElement('button');
    b.className = 'template-choice';
    b.append(Templates.preview(t, 520));
    const sp = document.createElement('span');
    sp.textContent = t.name;
    b.append(sp);
    b.onclick = () => startSession(t);
    box.append(b);
  });
  show('templates');
}

async function startSession(t) {
  const token = ++Session.token;
  const alive = () => token === Session.token;
  Object.assign(Session, { template: t, shots: [], frames: [], filter: 'normal', result: null, liveBlob: null, prints: 0, savedId: null });
  show('capture');

  const thumbs = $('#thumbs');
  thumbs.innerHTML = '';
  const total = Session.mode === 'live' ? 0 : t.shots;
  for (let i = 0; i < total; i++) {
    const d = document.createElement('div');
    d.className = 'slot';
    d.style.aspectRatio = Templates.shotAspect(t, i);
    thumbs.append(d);
  }
  Preview.setAspect(Templates.shotAspect(t, 0));

  // Get ready
  $('#shotLabel').textContent = Session.mode === 'live' ? 'Live Photo ✨' : `${t.shots} foto`;
  $('#getReadySub').textContent = Session.mode === 'live'
    ? 'Siapkan gerakan seru: lompat, lempar confetti, tos!'
    : `Akan ada ${t.shots} foto. Ganti gaya di setiap foto ya!`;
  $('#getReady').classList.remove('hidden');
  await sleep(2200);
  $('#getReady').classList.add('hidden');
  if (!alive()) return;

  if (Session.mode === 'live') {
    await countdown(alive);
    if (!alive()) return;
    await recordLive(alive);
  } else {
    for (let i = 0; i < t.shots; i++) {
      if (!alive()) return;
      Preview.setAspect(Templates.shotAspect(t, i));
      $('#shotLabel').textContent = `Foto ${i + 1} dari ${t.shots}`;
      await countdown(alive);
      if (!alive()) return;
      const shot = Camera.grab(Templates.shotAspect(t, i));
      await doFlash();
      Session.shots.push(shot);
      const th = newCanvas(shot.width * (180 / shot.height), 180);
      th.getContext('2d').drawImage(shot, 0, 0, th.width, th.height);
      thumbs.children[i].replaceWith(th);
      if (i < t.shots - 1) {
        const cheer = $('#cheer');
        cheer.textContent = ['Keren! 😍', 'Mantap! 🔥', 'Cakep! ✨', 'Lagi! 🤩', 'Wow! 💫'][i % 5];
        cheer.classList.remove('hidden');
        await sleep(+S.betweenShots * 1000);
        cheer.classList.add('hidden');
      }
    }
  }
  if (!alive()) return;
  show('processing');
  $('#processingText').textContent = Session.mode === 'live' ? 'Membuat Live Photo…' : 'Menyusun photo strip…';
  await sleep(60);
  await openReview(alive);
}

async function countdown(alive) {
  const el = $('#countdown');
  for (let n = +S.countdown; n > 0; n--) {
    if (!alive()) { el.textContent = ''; return; }
    el.textContent = n;
    el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick');
    Sound.beep(n === 1 ? 1320 : 880);
    await sleep(1000);
  }
  el.textContent = '';
}

async function doFlash() {
  Sound.shutter();
  if (!S.flash) return;
  const f = $('#flash');
  f.classList.add('on');
  await sleep(90);
  f.classList.remove('on');
}

/* ---------- Live Photo (boomerang) ---------- */
async function recordLive(alive) {
  const t = Session.template, aspect = Templates.shotAspect(t, 0);
  const fps = 12, n = Math.round(+S.liveSeconds * fps);
  $('#recordingBadge').classList.remove('hidden');
  Sound.shutter();
  const start = performance.now();
  for (let i = 0; i < n; i++) {
    if (!alive()) break;
    Session.frames.push(Camera.grab(aspect, 640));
    const next = start + ((i + 1) * 1000) / fps;
    await sleep(Math.max(0, next - performance.now()));
  }
  $('#recordingBadge').classList.add('hidden');
}

const Live = (() => {
  let raf = 0, rec = null;
  function sequence(frames) { // forward + backward, without repeating ends
    return frames.length > 2 ? [...frames, ...frames.slice(1, -1).reverse()] : frames;
  }
  /** Plays frames as a boomerang; draw(ctx, frame) renders one frame into the canvas. */
  function play(canvas, frames, draw, fps = 12) {
    stop();
    const ctx = canvas.getContext('2d');
    const seq = sequence(frames);
    let i = 0, last = 0;
    const loop = (ts) => {
      raf = requestAnimationFrame(loop);
      if (ts - last < 1000 / fps) return;
      last = ts;
      draw(ctx, seq[i % seq.length]);
      i++;
    };
    raf = requestAnimationFrame(loop);
    return seq.length;
  }
  /** Records the playing canvas into a video (3 loops). */
  function record(canvas, seqLen, fps = 12) {
    if (!canvas.captureStream || !window.MediaRecorder) return Promise.resolve(null);
    const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    const mimeType = types.find((m) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m));
    if (!mimeType) return Promise.resolve(null);
    return new Promise((res) => {
      const chunks = [];
      try {
        rec = new MediaRecorder(canvas.captureStream(30), { mimeType, videoBitsPerSecond: 6e6 });
      } catch { return res(null); }
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => res(chunks.length ? new Blob(chunks, { type: mimeType.split(';')[0] }) : null);
      rec.start(250);
      setTimeout(() => rec && rec.state !== 'inactive' && rec.stop(), (seqLen * 3 * 1000) / fps + 200);
    });
  }
  function stop() {
    cancelAnimationFrame(raf); raf = 0;
    if (rec && rec.state !== 'inactive') { rec.onstop = null; try { rec.stop(); } catch {} }
    rec = null;
  }
  return { play, record, stop };
})();

/* ---------- Review ---------- */
async function openReview(alive) {
  const t = Session.template;
  const canvas = $('#reviewCanvas');
  const k = Session.mode === 'live' ? Math.min(1, 960 / Math.max(t.w, t.h)) : 1;
  canvas.width = Math.round(t.w * k); canvas.height = Math.round(t.h * k);
  $('#reviewNote').textContent = '';
  $('#btnPrint').classList.toggle('hidden', !S.enablePrint || Session.mode === 'live');
  $('#btnShare').classList.toggle('hidden', !S.enableShare);
  $('#btnRetake').classList.toggle('hidden', !S.enableRetake);
  $('#btnPrint').disabled = false;
  $('#btnShare').disabled = false;
  buildFilterRow();
  await renderResult(alive);
  if (!alive()) return;
  show('review');
  startIdle();
}

async function renderResult(alive = () => true) {
  const t = Session.template, canvas = $('#reviewCanvas'), ctx = canvas.getContext('2d');
  const token = Session.token;
  Live.stop();
  if (Session.mode === 'live') {
    $('#btnShare').disabled = true;
    $('#reviewNote').textContent = 'Menyiapkan video…';
    const k = canvas.width / t.w;
    const frames = Session.frames.map((f) => applyFilter(f, Session.filter));
    const len = Live.play(canvas, frames, (c, f) => Templates.composeInto(c, t, [f], k));
    const blob = await Live.record(canvas, len);
    if (!alive() || token !== Session.token) return;
    Session.liveBlob = blob;
    $('#btnShare').disabled = !blob;
    $('#reviewNote').textContent = blob ? '' : 'Perangkat ini tidak bisa menyimpan video, tapi Live Photo tetap bisa dilihat.';
    await saveSession();
  } else {
    const shots = Session.shots.map((s) => applyFilter(s, Session.filter));
    const out = Templates.compose(t, shots, 1);
    ctx.drawImage(out, 0, 0);
    Session.result = await canvasToBlob(out);
    await saveSession();
  }
}

function buildFilterRow() {
  const row = $('#filterRow');
  row.innerHTML = '';
  row.classList.toggle('hidden', !S.enableFilters);
  if (!S.enableFilters) return;
  const sample = Session.mode === 'live' ? Session.frames[Math.floor(Session.frames.length / 2)] : Session.shots[0];
  if (!sample) return;
  const small = newCanvas(120, 120);
  drawCover(small.getContext('2d'), sample, 0, 0, 120, 120);
  FILTERS.forEach((f) => {
    const b = document.createElement('button');
    b.className = 'filter-chip' + (f.id === Session.filter ? ' active' : '');
    b.append(applyFilter(small, f.id));
    b.append(document.createTextNode(f.name));
    b.onclick = async () => {
      if (Session.filter === f.id) return;
      Session.filter = f.id;
      $$('.filter-chip', row).forEach((x) => x.classList.toggle('active', x === b));
      startIdle();
      await renderResult();
    };
    row.append(b);
  });
}

/** Saves (or replaces) this session's output in the on-device gallery. */
async function saveSession() {
  const blob = Session.mode === 'live' ? Session.liveBlob : Session.result;
  if (!blob) return;
  const first = !Session.savedId;
  if (first) Session.savedId = 's-' + Date.now();
  await DB.put('sessions', { id: Session.savedId, created: Date.now(), type: Session.mode, blob, template: Session.template.name });
  if (first) { S.sessionCount++; saveSettings(); }
}

async function shareResult() {
  startIdle();
  const isLive = Session.mode === 'live';
  const blob = isLive ? Session.liveBlob : Session.result;
  if (!blob) return;
  const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('webm') ? 'webm' : 'jpg';
  const file = new File([blob], `${S.frameTitle.replace(/[^\w-]+/g, '_') || 'photobooth'}-${Date.now()}.${ext}`, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: S.frameTitle }); } catch { /* cancelled */ }
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  }
}

async function printResult() {
  startIdle();
  if (!Session.result) return;
  if (Session.prints >= +S.maxPrints) { $('#reviewNote').textContent = 'Batas cetak untuk sesi ini sudah tercapai.'; return; }
  const t = Session.template, ratio = t.w / t.h;
  const size = ratio < 0.45 ? '2in 6in' : ratio < 1 ? '4in 6in' : '6in 4in';
  let st = $('#pageStyle');
  if (!st) { st = document.createElement('style'); st.id = 'pageStyle'; document.head.append(st); }
  st.textContent = `@page { size: ${size}; margin: 0; }`;
  const img = $('#printImg');
  await new Promise((r) => { img.onload = r; img.onerror = r; img.src = URL.createObjectURL(Session.result); });
  Session.prints++;
  window.print();
  $('#reviewNote').textContent = 'Foto dikirim ke printer. Ambil di meja printer ya! 🖨️';
}

function finish() {
  stopIdle();
  Live.stop();
  Session.token++;
  $('#thanksTitle').textContent = S.thanksText;
  show('thanks');
  const tk = Session.token;
  setTimeout(() => { if (tk === Session.token && currentScreen === 'thanks') goHome(); }, 3500);
  updateWelcome();
}

/* =========================================================
 * Welcome screen
 * ======================================================= */
async function updateWelcome() {
  $('#welcomeTitle').textContent = S.eventName;
  $('#welcomeSubtitle').textContent = S.subtitle;
  $('#welcomeButtonText').textContent = S.buttonText;
  $('#liveModeBtn').classList.toggle('hidden', !S.enableLive);
  $('#sessionCounter').textContent = S.showCounter && S.sessionCount ? `📸 ${S.sessionCount} sesi` : '';
  const bgBox = $('#welcomeBg');
  bgBox.innerHTML = ''; bgBox.style.backgroundImage = '';
  const bg = await DB.get('kv', 'welcomeBg');
  if (bg) {
    const url = URL.createObjectURL(bg);
    if (bg.type.startsWith('video')) {
      const v = document.createElement('video');
      Object.assign(v, { src: url, muted: true, loop: true, autoplay: true, playsInline: true });
      v.setAttribute('playsinline', '');
      bgBox.append(v);
      v.play().catch(() => {});
    } else bgBox.style.backgroundImage = `url(${url})`;
  }
  const logo = await DB.get('kv', 'logo');
  const li = $('#welcomeLogo');
  li.classList.toggle('hidden', !logo);
  if (logo) li.src = URL.createObjectURL(logo);
}

function makeSparkles() {
  const box = $('.sparkles');
  for (let i = 0; i < 26; i++) {
    const s = document.createElement('i');
    const size = 3 + Math.random() * 7;
    Object.assign(s.style, {
      left: Math.random() * 100 + '%', width: size + 'px', height: size + 'px',
      animationDuration: 7 + Math.random() * 9 + 's', animationDelay: -Math.random() * 14 + 's',
    });
    box.append(s);
  }
}

/* =========================================================
 * Admin (PIN + settings)
 * ======================================================= */
let pinEntry = '';
function openPin() {
  pinEntry = '';
  renderPinDots();
  $('#pinModal').classList.remove('hidden');
}
function renderPinDots() {
  $('#pinDots').innerHTML = [0, 1, 2, 3].map((i) => `<i class="${i < pinEntry.length ? 'on' : ''}"></i>`).join('');
}
function buildPinPad() {
  const pad = $('#pinPad');
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].forEach((k) => {
    const b = document.createElement('button');
    b.textContent = k;
    if (!k) b.style.visibility = 'hidden';
    b.onclick = () => {
      if (k === '⌫') pinEntry = pinEntry.slice(0, -1);
      else if (pinEntry.length < 4) pinEntry += k;
      renderPinDots();
      if (pinEntry.length === 4) {
        if (pinEntry === S.pin) { $('#pinModal').classList.add('hidden'); openAdmin(); }
        else { const d = $('#pinDots'); d.classList.add('shake'); setTimeout(() => { d.classList.remove('shake'); pinEntry = ''; renderPinDots(); }, 400); }
      }
    };
    pad.append(b);
  });
}

function bindSettingsForm() {
  $$('[data-key]').forEach((el) => {
    const key = el.dataset.key;
    if (el.type === 'checkbox') el.checked = !!S[key]; else el.value = S[key];
    el.onchange = el.oninput = async () => {
      if (key === 'pin' && !/^\d{4}$/.test(el.value)) return;
      S[key] = el.type === 'checkbox' ? el.checked : el.value;
      await saveSettings();
      if (key === 'themeColor') applyTheme();
      if (key === 'frameTitle' || key === 'themeColor') { await Templates.load(); renderTemplateList(); }
      if (key === 'resolution' || key === 'rotation') Camera.start().catch(() => {});
    };
  });
}

async function openAdmin() {
  stopIdle();
  bindSettingsForm();
  await renderCameraList();
  renderTemplateList();
  renderGallery();
  $('#adminModal').classList.remove('hidden');
}
async function closeAdmin() {
  $('#adminModal').classList.add('hidden');
  await updateWelcome();
  goHome();
}

async function renderCameraList() {
  const sel = $('#cameraSelect');
  let cams = [];
  try { cams = await Camera.list(); } catch {}
  sel.innerHTML = '<option value="">Kamera depan iPad (bawaan)</option>' +
    cams.map((c, i) => `<option value="${c.deviceId}">${c.label || 'Kamera ' + (i + 1)}</option>`).join('');
  sel.value = cams.some((c) => c.deviceId === S.cameraId) ? S.cameraId : '';
  sel.onchange = async () => {
    S.cameraId = sel.value; await saveSettings();
    try { await Camera.start(); toast('Kamera diganti ✅'); } catch (e) { toast('Gagal membuka kamera: ' + e.message); }
  };
}

function renderTemplateList() {
  const box = $('#templateList');
  box.innerHTML = '';
  Templates.list.forEach((t) => {
    const card = document.createElement('div');
    card.className = 'tpl-card';
    card.append(Templates.preview(t, 520));
    card.insertAdjacentHTML('beforeend', `
      <div class="tpl-name"></div>
      <div class="tpl-meta">${t.w}×${t.h}px · ${t.slots.length} lubang foto${t.builtin ? ' · bawaan' : ''}</div>
      <label class="check"><input type="checkbox" class="en"> Aktif</label>
      <label>Mode <select class="mode"><option value="photo">Foto</option><option value="live">Live Photo</option></select></label>
      <label>Jumlah jepretan <select class="shots"></select></label>
      ${t.builtin ? '' : '<button class="btn small danger del">Hapus template</button>'}`);
    $('.tpl-name', card).textContent = t.name;
    const en = $('.en', card), mode = $('.mode', card), shots = $('.shots', card);
    en.checked = t.enabled;
    mode.value = t.mode;
    for (let n = 1; n <= t.slots.length; n++) if (t.slots.length % n === 0) shots.add(new Option(n + ' foto', n));
    shots.value = t.shots;
    if (t.builtin) { mode.disabled = true; shots.disabled = true; }
    en.onchange = () => Templates.update(t, { enabled: en.checked });
    mode.onchange = () => Templates.update(t, { mode: mode.value });
    shots.onchange = async () => { await Templates.update(t, { shots: +shots.value }); renderTemplateList(); };
    const del = $('.del', card);
    if (del) del.onclick = async () => { if (confirm(`Hapus template "${t.name}"?`)) { await Templates.remove(t); renderTemplateList(); } };
    box.append(card);
  });
}

async function renderGallery() {
  const box = $('#gallery');
  box.innerHTML = '';
  const items = (await DB.all('sessions')).sort((a, b) => b.created - a.created);
  let est = '';
  try { const e = await navigator.storage.estimate(); est = ` · Terpakai ${(e.usage / 1e6).toFixed(0)} MB`; } catch {}
  $('#galleryStats').textContent = `${items.length} hasil tersimpan di iPad ini${est}`;
  items.slice(0, 120).forEach((it) => {
    const b = document.createElement('button');
    b.className = 'g-item';
    const url = URL.createObjectURL(it.blob);
    if (it.type === 'live') b.innerHTML = `<video src="${url}" muted loop autoplay playsinline></video><span class="g-badge">LIVE</span>`;
    else b.innerHTML = `<img src="${url}" loading="lazy" alt="">`;
    b.onclick = async () => {
      const ext = it.type === 'live' ? (it.blob.type.includes('mp4') ? 'mp4' : 'webm') : 'jpg';
      const f = new File([it.blob], `${it.id}.${ext}`, { type: it.blob.type });
      if (navigator.canShare && navigator.canShare({ files: [f] })) navigator.share({ files: [f] }).catch(() => {});
    };
    box.append(b);
  });
}

/* =========================================================
 * Wiring
 * ======================================================= */
function wire() {
  $$('.mode-card').forEach((b) => (b.onclick = () => chooseMode(b.dataset.mode)));
  $('#screen-welcome').addEventListener('click', (e) => { if (!e.target.closest('.mode-card')) chooseMode('photo'); });
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    ({ home: goHome, closePin: () => $('#pinModal').classList.add('hidden'), closeAdmin })[a.dataset.action]?.();
  });
  $('#btnDone').onclick = finish;
  $('#btnRetake').onclick = () => { stopIdle(); Live.stop(); if (Session.savedId) { DB.del('sessions', Session.savedId); S.sessionCount = Math.max(0, S.sessionCount - 1); saveSettings(); } startSession(Session.template); };
  $('#btnShare').onclick = shareResult;
  $('#btnPrint').onclick = printResult;
  $('#screen-review').addEventListener('pointerdown', () => startIdle());

  // long-press top-left corner → PIN
  let lp;
  const hs = $('#adminHotspot');
  hs.addEventListener('pointerdown', () => { lp = setTimeout(openPin, 2000); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => hs.addEventListener(ev, () => clearTimeout(lp)));
  buildPinPad();

  // admin tabs
  $$('#adminTabs button').forEach((b) => (b.onclick = () => {
    $$('#adminTabs button').forEach((x) => x.classList.toggle('active', x === b));
    $$('.admin-body .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === b.dataset.tab));
    if (b.dataset.tab === 'gallery') renderGallery();
  }));

  // uploads
  $('#upTemplate').onchange = async (e) => {
    for (const f of e.target.files) {
      try { const r = await Templates.addFromFile(f); toast(`✅ "${r.name}": ${r.slots.length} lubang foto terdeteksi`); }
      catch (err) { toast('⚠️ ' + err.message, 6000); }
    }
    e.target.value = '';
    await Templates.load(); renderTemplateList();
  };
  $('#upWelcomeBg').onchange = async (e) => { const f = e.target.files[0]; if (f) { await DB.put('kv', f, 'welcomeBg'); toast('Background disimpan'); updateWelcome(); } };
  $('#upLogo').onchange = async (e) => { const f = e.target.files[0]; if (f) { await DB.put('kv', f, 'logo'); toast('Logo disimpan'); updateWelcome(); } };
  $('#clearWelcomeBg').onclick = async () => { await DB.del('kv', 'welcomeBg'); updateWelcome(); toast('Background dihapus'); };
  $('#clearLogo').onclick = async () => { await DB.del('kv', 'logo'); updateWelcome(); toast('Logo dihapus'); };
  $('#refreshCameras').onclick = async () => {
    try { if (!Camera.ready()) await Camera.start(); } catch {}
    await renderCameraList(); toast('Daftar kamera diperbarui');
  };
  $('#btnFullscreen').onclick = () => {
    const d = document.documentElement;
    (d.requestFullscreen || d.webkitRequestFullscreen)?.call(d);
  };

  // gallery
  $('#deleteAll').onclick = async () => {
    if (!confirm('Hapus SEMUA foto di galeri? Tidak bisa dibatalkan.')) return;
    await DB.clear('sessions'); S.sessionCount = 0; await saveSettings(); renderGallery(); toast('Galeri dikosongkan');
  };
  $('#shareAll').onclick = async () => {
    const items = await DB.all('sessions');
    const files = items.map((it) => new File([it.blob], `${it.id}.${it.type === 'live' ? (it.blob.type.includes('mp4') ? 'mp4' : 'webm') : 'jpg'}`, { type: it.blob.type }));
    if (!files.length) return toast('Galeri masih kosong');
    if (navigator.canShare && navigator.canShare({ files })) navigator.share({ files }).catch(() => {});
    else toast('Browser ini tidak mendukung bagikan banyak file');
  };

  // keep screen awake
  const wake = async () => { try { await navigator.wakeLock?.request('screen'); } catch {} };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { wake(); if (!Camera.ready() || !Camera.stream?.active) Camera.start().catch(() => {}); }
    else goHome();
  });
  document.addEventListener('pointerdown', wake, { once: true });
  // block pinch zoom / double-tap zoom
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
}

async function init() {
  const saved = await DB.get('kv', 'settings').catch(() => null);
  S = { ...DEFAULTS, ...(saved || {}) };
  applyTheme();
  makeSparkles();
  wire();
  await Templates.load();
  await updateWelcome();
  show('welcome');
  navigator.storage?.persist?.().catch(() => {});
  try { await Camera.start(); } catch { toast('Sentuh layar untuk mengizinkan kamera', 5000); }
  if (!S.firstRunDone) {
    toast('Tips: tekan & tahan pojok kiri atas 2 detik untuk Pengaturan (PIN awal 1234)', 8000);
    S.firstRunDone = true; saveSettings();
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
init();
