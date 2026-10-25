/**
 * Canvas pages for the sample-media stills (milestone 21). Each page defines
 * `window.pulpRender(state)` like a template and draws one picture chosen by
 * `state.params.variant`, from the size it is handed. Deterministic: positions
 * come from a seeded hash, never from Math.random. The main process loads a
 * page as a data URL in an offscreen window and captures it once.
 */

const SHARED = `
  'use strict';
  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d');
  function hash(i) { var x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); }
  function size(state) {
    if (canvas.width !== state.width || canvas.height !== state.height) { canvas.width = state.width; canvas.height = state.height; }
    return { W: state.width, H: state.height, s: Math.min(state.width, state.height) / 1080 };
  }
  function grain(W, H, amount, seed) {
    var img = ctx.getImageData(0, 0, W, H), d = img.data, n = W * H;
    for (var i = 0; i < n; i += 1) {
      var g = (hash(i * 7 + seed) - 0.5) * amount;
      d[i * 4] += g; d[i * 4 + 1] += g; d[i * 4 + 2] += g;
    }
    ctx.putImageData(img, 0, 0);
  }
`;

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}canvas{display:block;width:100%;height:100%}</style></head><body><canvas id="c"></canvas><script>${SHARED}${body}</script></body></html>`;
}

/** Photo-style pictures: layered gradients, bokeh, light beams, a little grain. */
export const PHOTO_PAGE = page(
  'Sample photo',
  `
  var LOOKS = {
    sunset: { sky: ['#1b1030', '#7a2b4d', '#f0804a', '#ffd27a'], horizon: 0.64, ground: ['#1a0f1c', '#2a1626'], sun: { x: 0.62, y: 0.6, r: 0.11, c: '#ffe6a8' }, bokeh: 10, haze: 'rgba(255,170,110,0.25)' },
    ocean: { sky: ['#0a1a3a', '#1f4a7a', '#4f8fb8', '#b7d7e8'], horizon: 0.58, ground: ['#0b2a4a', '#145a86'], sun: { x: 0.5, y: 0.52, r: 0.07, c: '#fff4d6' }, bokeh: 26, haze: 'rgba(120,180,220,0.2)' },
    forest: { sky: ['#0f1f12', '#1f4a26', '#5d8f3a', '#cfe29a'], horizon: 0.72, ground: ['#0a150c', '#173019'], sun: { x: 0.3, y: 0.18, r: 0.16, c: '#f6f2c9' }, bokeh: 18, haze: 'rgba(200,230,150,0.18)' },
    city: { sky: ['#07101f', '#16304f', '#3f6d8f', '#9fc3d8'], horizon: 0.66, ground: ['#060b14', '#101d2e'], sun: { x: 0.78, y: 0.56, r: 0.05, c: '#ffd9a0' }, bokeh: 34, haze: 'rgba(130,170,210,0.22)' },
    desert: { sky: ['#2a1407', '#8a4418', '#d98b3a', '#f4d79a'], horizon: 0.7, ground: ['#2b1708', '#6b3d16'], sun: { x: 0.44, y: 0.63, r: 0.13, c: '#fff0c4' }, bokeh: 6, haze: 'rgba(230,180,110,0.26)' },
    snow: { sky: ['#1b2436', '#43566f', '#8fa4b8', '#e6eef5'], horizon: 0.6, ground: ['#b9c6d2', '#eef4f8'], sun: { x: 0.68, y: 0.3, r: 0.09, c: '#ffffff' }, bokeh: 14, haze: 'rgba(220,235,245,0.3)' }
  };
  window.pulpRender = function (state) {
    var d = size(state), W = d.W, H = d.H;
    var look = LOOKS[state.params.variant] || LOOKS.sunset;
    var sky = ctx.createLinearGradient(0, 0, 0, H * look.horizon);
    for (var i = 0; i < look.sky.length; i++) sky.addColorStop(i / (look.sky.length - 1), look.sky[i]);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    var ground = ctx.createLinearGradient(0, H * look.horizon, 0, H);
    ground.addColorStop(0, look.ground[1]); ground.addColorStop(1, look.ground[0]);
    ctx.fillStyle = ground; ctx.fillRect(0, H * look.horizon, W, H);
    // The sun or moon, with a wide glow.
    var sx = W * look.sun.x, sy = H * look.sun.y, sr = Math.min(W, H) * look.sun.r;
    var glow = ctx.createRadialGradient(sx, sy, sr * 0.2, sx, sy, sr * 4);
    glow.addColorStop(0, look.sun.c); glow.addColorStop(0.25, look.haze); glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = look.sun.c; ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
    // A reflection or beams below the horizon.
    ctx.save(); ctx.globalAlpha = 0.35;
    for (var k = 0; k < 14; k++) {
      var y = H * look.horizon + k * (H * (1 - look.horizon) / 14);
      var w = sr * (1.2 + hash(k) * 1.6) * (1 + k * 0.08);
      ctx.fillStyle = look.sun.c; ctx.fillRect(sx - w / 2, y, w, Math.max(1, H * 0.004));
    }
    ctx.restore();
    // Bokeh discs.
    for (var b = 0; b < look.bokeh; b++) {
      var bx = hash(b * 3 + 1) * W, by = hash(b * 3 + 2) * H * look.horizon, br = (0.01 + hash(b * 3 + 3) * 0.03) * Math.min(W, H);
      var bg = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      bg.addColorStop(0, 'rgba(255,245,220,0.35)'); bg.addColorStop(0.8, 'rgba(255,245,220,0.18)'); bg.addColorStop(1, 'rgba(255,245,220,0)');
      ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
    }
    // Vignette and grain finish the photographic look.
    var vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    grain(W, H, 18, { ocean: 11, forest: 23, city: 31, desert: 37, snow: 41 }[state.params.variant] || 5);
  };
`,
);

/** Flat-shape illustrations. */
export const ILLUSTRATION_PAGE = page(
  'Sample illustration',
  `
  function hills(W, H) {
    var sky = ctx.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#bfe3ff'); sky.addColorStop(1, '#f6f4e8');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc(W * 0.78, H * 0.28, Math.min(W, H) * 0.11, 0, Math.PI * 2); ctx.fill();
    var greens = ['#9fcf6b', '#78b35a', '#4f8f45', '#2f6b3a'];
    for (var i = 0; i < greens.length; i++) {
      ctx.fillStyle = greens[i]; ctx.beginPath(); ctx.moveTo(0, H);
      for (var x = 0; x <= W; x += W / 40) {
        var y = H * (0.55 + i * 0.1) + Math.sin(x / W * Math.PI * (1.5 + i * 0.6) + i) * H * 0.05;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    }
    for (var c = 0; c < 5; c++) {
      var cx = W * (0.1 + c * 0.2) + hash(c) * W * 0.05, cy = H * (0.18 + hash(c + 9) * 0.15), cr = Math.min(W, H) * 0.045;
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.arc(cx + cr, cy + cr * 0.3, cr * 0.8, 0, Math.PI * 2); ctx.arc(cx - cr, cy + cr * 0.3, cr * 0.7, 0, Math.PI * 2); ctx.fill();
    }
  }
  function skyline(W, H) {
    var sky = ctx.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#0b1026'); sky.addColorStop(1, '#2b2a5e');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    for (var st = 0; st < 120; st++) { ctx.fillStyle = 'rgba(255,255,255,' + (0.3 + hash(st) * 0.7) + ')'; ctx.fillRect(hash(st * 2) * W, hash(st * 2 + 1) * H * 0.5, 2, 2); }
    ctx.fillStyle = '#f5e6b8'; ctx.beginPath(); ctx.arc(W * 0.2, H * 0.22, Math.min(W, H) * 0.07, 0, Math.PI * 2); ctx.fill();
    var x = 0, i = 0;
    while (x < W) {
      var bw = W * (0.03 + hash(i) * 0.06), bh = H * (0.2 + hash(i + 50) * 0.5);
      ctx.fillStyle = i % 2 ? '#141a3a' : '#1c2450';
      ctx.fillRect(x, H - bh, bw, bh);
      for (var wy = H - bh + H * 0.03; wy < H - H * 0.02; wy += H * 0.04) {
        for (var wx = x + bw * 0.15; wx < x + bw * 0.85; wx += bw * 0.3) {
          if (hash(wx * 0.37 + wy * 0.91) > 0.45) { ctx.fillStyle = '#ffd98a'; ctx.fillRect(wx, wy, bw * 0.12, H * 0.015); }
        }
      }
      x += bw + W * 0.004; i++;
    }
    ctx.fillStyle = '#0a0d1e'; ctx.fillRect(0, H * 0.97, W, H * 0.03);
  }
  function rocket(W, H) {
    ctx.fillStyle = '#0d0b2b'; ctx.fillRect(0, 0, W, H);
    for (var st = 0; st < 160; st++) { ctx.fillStyle = 'rgba(255,255,255,' + (0.2 + hash(st) * 0.8) + ')'; var r = 1 + hash(st + 7) * 2.5; ctx.beginPath(); ctx.arc(hash(st * 3) * W, hash(st * 3 + 1) * H, r, 0, Math.PI * 2); ctx.fill(); }
    var cx = W * 0.5, cy = H * 0.5, u = Math.min(W, H) / 1080;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-Math.PI / 5);
    ctx.fillStyle = '#ff7b54'; ctx.beginPath(); ctx.moveTo(-70 * u, 180 * u); ctx.lineTo(-150 * u, 300 * u); ctx.lineTo(-70 * u, 260 * u); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(70 * u, 180 * u); ctx.lineTo(150 * u, 300 * u); ctx.lineTo(70 * u, 260 * u); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f4f4f8'; ctx.beginPath(); ctx.moveTo(0, -320 * u); ctx.bezierCurveTo(130 * u, -140 * u, 110 * u, 160 * u, 70 * u, 280 * u); ctx.lineTo(-70 * u, 280 * u); ctx.bezierCurveTo(-110 * u, 160 * u, -130 * u, -140 * u, 0, -320 * u); ctx.fill();
    ctx.fillStyle = '#ff7b54'; ctx.beginPath(); ctx.moveTo(0, -320 * u); ctx.bezierCurveTo(70 * u, -230 * u, 80 * u, -160 * u, 75 * u, -120 * u); ctx.lineTo(-75 * u, -120 * u); ctx.bezierCurveTo(-80 * u, -160 * u, -70 * u, -230 * u, 0, -320 * u); ctx.fill();
    ctx.fillStyle = '#4fc3f7'; ctx.beginPath(); ctx.arc(0, -20 * u, 48 * u, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 12 * u; ctx.strokeStyle = '#d8dbe6'; ctx.stroke();
    var flame = ctx.createLinearGradient(0, 280 * u, 0, 520 * u); flame.addColorStop(0, '#ffe066'); flame.addColorStop(1, 'rgba(255,90,40,0)');
    ctx.fillStyle = flame; ctx.beginPath(); ctx.moveTo(-50 * u, 280 * u); ctx.quadraticCurveTo(0, 560 * u, 50 * u, 280 * u); ctx.fill();
    ctx.restore();
  }
  function mountains(W, H) {
    var sky = ctx.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#102a43'); sky.addColorStop(1, '#f0b429');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff3c4'; ctx.beginPath(); ctx.arc(W * 0.72, H * 0.3, Math.min(W, H) * 0.09, 0, Math.PI * 2); ctx.fill();
    var bands = [['#243b53', 0.52, 0.22], ['#334e68', 0.64, 0.3], ['#486581', 0.78, 0.18]];
    for (var b = 0; b < bands.length; b++) {
      ctx.fillStyle = bands[b][0]; ctx.beginPath(); ctx.moveTo(0, H);
      for (var px = 0; px <= W; px += W / 14) {
        var peak = H * bands[b][1] - Math.abs(Math.sin(px / W * 6 + b * 2)) * H * bands[b][2];
        ctx.lineTo(px, peak);
      }
      ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    }
  }
  function waves(W, H) {
    var sky = ctx.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#003f5c'); sky.addColorStop(1, '#2f4b7c');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    for (var w = 0; w < 7; w++) {
      ctx.fillStyle = ['#2f4b7c', '#3d6a9a', '#4f88b8', '#6aa5cf', '#8cc0e0', '#b0d8ee', '#d6edf8'][w];
      ctx.beginPath(); ctx.moveTo(0, H);
      for (var px = 0; px <= W; px += W / 40) {
        ctx.lineTo(px, H * (0.42 + w * 0.085) + Math.sin(px / W * 9 + w) * H * 0.022);
      }
      ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    }
  }
  function leaves(W, H) {
    ctx.fillStyle = '#f7f3e8'; ctx.fillRect(0, 0, W, H);
    var u = Math.min(W, H) / 1080;
    for (var i = 0; i < 26; i++) {
      var x = hash(i * 5) * W, y = hash(i * 5 + 1) * H, r = (40 + hash(i * 5 + 2) * 90) * u;
      ctx.save(); ctx.translate(x, y); ctx.rotate(hash(i * 5 + 3) * Math.PI * 2);
      ctx.fillStyle = ['#2f6b3f', '#4a8a52', '#7cb07a', '#bcd4a0'][i % 4];
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.quadraticCurveTo(r * 0.7, 0, 0, r); ctx.quadraticCurveTo(-r * 0.7, 0, 0, -r); ctx.fill();
      ctx.restore();
    }
  }
  window.pulpRender = function (state) {
    var d = size(state);
    ctx.clearRect(0, 0, d.W, d.H);
    var v = state.params.variant;
    if (v === 'skyline') skyline(d.W, d.H);
    else if (v === 'rocket') rocket(d.W, d.H);
    else if (v === 'mountains') mountains(d.W, d.H);
    else if (v === 'waves') waves(d.W, d.H);
    else if (v === 'leaves') leaves(d.W, d.H);
    else hills(d.W, d.H);
  };
`,
);

/** Layered graphics: shapes on a transparent background, for compositing. */
export const LAYERED_PAGE = page(
  'Sample layered graphic',
  `
  function badge(W, H) {
    var cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.36;
    ctx.fillStyle = '#c0392b'; ctx.beginPath();
    for (var i = 0; i < 48; i++) { var a = i / 48 * Math.PI * 2, r = i % 2 ? R : R * 0.9; ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f4d35e'; ctx.beginPath(); ctx.arc(cx, cy, R * 0.74, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.arc(cx, cy, R * 0.62, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f4d35e'; ctx.beginPath();
    for (var k = 0; k < 10; k++) { var b = -Math.PI / 2 + k / 10 * Math.PI * 2, rr = k % 2 ? R * 0.16 : R * 0.38; ctx.lineTo(cx + Math.cos(b) * rr, cy + Math.sin(b) * rr); }
    ctx.closePath(); ctx.fill();
  }
  function ribbon(W, H) {
    var u = Math.min(W, H) / 1080, w = W * 0.7, h = 180 * u, x = (W - w) / 2, y = H / 2 - h / 2;
    ctx.fillStyle = '#8e2430'; ctx.beginPath(); ctx.moveTo(x - 90 * u, y + 40 * u); ctx.lineTo(x + 60 * u, y + 40 * u); ctx.lineTo(x + 60 * u, y + h + 40 * u); ctx.lineTo(x - 90 * u, y + h + 40 * u); ctx.lineTo(x - 30 * u, y + h / 2 + 40 * u); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + w + 90 * u, y + 40 * u); ctx.lineTo(x + w - 60 * u, y + 40 * u); ctx.lineTo(x + w - 60 * u, y + h + 40 * u); ctx.lineTo(x + w + 90 * u, y + h + 40 * u); ctx.lineTo(x + w + 30 * u, y + h / 2 + 40 * u); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#5e1620'; ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + 60 * u, y + h + 40 * u); ctx.lineTo(x + 60 * u, y + h); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + w, y + h); ctx.lineTo(x + w - 60 * u, y + h + 40 * u); ctx.lineTo(x + w - 60 * u, y + h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c8353f'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x, y, w, h * 0.12);
  }
  function bubble(W, H) {
    var u = Math.min(W, H) / 1080, w = W * 0.72, h = H * 0.5, x = (W - w) / 2, y = H * 0.14, r = 70 * u;
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#1d1d1f'; ctx.lineWidth = 10 * u; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + w * 0.42, y + h); ctx.lineTo(x + w * 0.28, y + h + 150 * u); ctx.lineTo(x + w * 0.3, y + h); ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#1d1d1f';
    for (var i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(x + w / 2 + (i - 1) * 90 * u, y + h / 2, 22 * u, 0, Math.PI * 2); ctx.fill(); }
  }
  function arrowMark(W, H) {
    var u = Math.min(W, H) / 1080;
    ctx.save(); ctx.translate(W / 2, H / 2);
    ctx.fillStyle = '#ff6b35';
    ctx.beginPath(); ctx.moveTo(-260 * u, -70 * u); ctx.lineTo(90 * u, -70 * u); ctx.lineTo(90 * u, -170 * u); ctx.lineTo(300 * u, 0);
    ctx.lineTo(90 * u, 170 * u); ctx.lineTo(90 * u, 70 * u); ctx.lineTo(-260 * u, 70 * u); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  function starBurst(W, H) {
    var u = Math.min(W, H) / 1080, points = 16;
    ctx.save(); ctx.translate(W / 2, H / 2);
    ctx.fillStyle = '#ffd23f'; ctx.beginPath();
    for (var i = 0; i < points * 2; i++) {
      var a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2, r = (i % 2 ? 190 : 330) * u;
      if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ee4266'; ctx.beginPath(); ctx.arc(0, 0, 150 * u, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function tagLabel(W, H) {
    var u = Math.min(W, H) / 1080;
    ctx.save(); ctx.translate(W / 2, H / 2);
    ctx.fillStyle = '#1f7a8c';
    ctx.beginPath(); ctx.moveTo(-420 * u, -110 * u); ctx.lineTo(300 * u, -110 * u); ctx.lineTo(430 * u, 0);
    ctx.lineTo(300 * u, 110 * u); ctx.lineTo(-420 * u, 110 * u); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e8f6f8'; ctx.beginPath(); ctx.arc(320 * u, 0, 26 * u, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(-420 * u, -110 * u, 720 * u, 36 * u);
    ctx.restore();
  }
  window.pulpRender = function (state) {
    var d = size(state);
    ctx.clearRect(0, 0, d.W, d.H);
    var v = state.params.variant;
    if (v === 'ribbon') ribbon(d.W, d.H);
    else if (v === 'bubble') bubble(d.W, d.H);
    else if (v === 'arrow') arrowMark(d.W, d.H);
    else if (v === 'starburst') starBurst(d.W, d.H);
    else if (v === 'tag') tagLabel(d.W, d.H);
    else badge(d.W, d.H);
  };
`,
);

export const STILL_PAGES = { photo: PHOTO_PAGE, illustration: ILLUSTRATION_PAGE, layered: LAYERED_PAGE } as const;

/** The data URL an offscreen window loads for a page. */
export function stillPageUrl(page: keyof typeof STILL_PAGES): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(STILL_PAGES[page])}`;
}
