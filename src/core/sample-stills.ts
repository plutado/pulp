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


/** Backdrops: still backgrounds and flat textures, drawn edge to edge (milestone 24). */
export const BACKDROP_PAGE = page(
  'Sample backdrop',
  `
  function meshGradient(W, H) {
    var g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#13223f'); g.addColorStop(0.5, '#2b4a74'); g.addColorStop(1, '#6a86a8');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (var i = 0; i < 5; i++) {
      var x = hash(i) * W, y = hash(i + 9) * H, r = Math.min(W, H) * (0.3 + hash(i + 17) * 0.4);
      var blob = ctx.createRadialGradient(x, y, 0, x, y, r);
      blob.addColorStop(0, 'rgba(120,170,220,0.22)'); blob.addColorStop(1, 'rgba(120,170,220,0)');
      ctx.fillStyle = blob; ctx.fillRect(0, 0, W, H);
    }
  }
  function paperGrain(W, H) {
    ctx.fillStyle = '#efe7d7'; ctx.fillRect(0, 0, W, H);
    var warm = ctx.createRadialGradient(W * 0.4, H * 0.35, 0, W * 0.4, H * 0.35, Math.max(W, H) * 0.8);
    warm.addColorStop(0, 'rgba(255,250,238,0.9)'); warm.addColorStop(1, 'rgba(190,175,150,0.35)');
    ctx.fillStyle = warm; ctx.fillRect(0, 0, W, H);
    grain(W, H, 26, 3);
  }
  function duskBands(W, H) {
    var stops = ['#1a1033', '#43246b', '#8d3f6e', '#d9705a', '#f3b562'];
    for (var i = 0; i < stops.length; i++) {
      var y0 = H * (i / stops.length), y1 = H * ((i + 1) / stops.length);
      var g = ctx.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, stops[i]); g.addColorStop(1, stops[Math.min(i + 1, stops.length - 1)]);
      ctx.fillStyle = g; ctx.fillRect(0, y0 - 1, W, y1 - y0 + 2);
    }
    grain(W, H, 10, 11);
  }
  function canvasWeave(W, H) {
    ctx.fillStyle = '#d9cfbb'; ctx.fillRect(0, 0, W, H);
    var step = Math.max(4, Math.min(W, H) / 150);
    ctx.strokeStyle = 'rgba(120,105,80,0.25)'; ctx.lineWidth = Math.max(1, step * 0.35);
    for (var x = 0; x < W; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (var y = 0; y < H; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    grain(W, H, 18, 23);
  }
  function concrete(W, H) {
    ctx.fillStyle = '#9aa0a3'; ctx.fillRect(0, 0, W, H);
    for (var i = 0; i < 90; i++) {
      var x = hash(i * 3) * W, y = hash(i * 3 + 1) * H, r = Math.min(W, H) * (0.02 + hash(i * 3 + 2) * 0.09);
      var p = ctx.createRadialGradient(x, y, 0, x, y, r);
      var tint = hash(i + 200) > 0.5 ? '255,255,255' : '60,60,65';
      p.addColorStop(0, 'rgba(' + tint + ',0.1)'); p.addColorStop(1, 'rgba(' + tint + ',0)');
      ctx.fillStyle = p; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    grain(W, H, 34, 29);
  }
  function noiseGrid(W, H) {
    ctx.fillStyle = '#10151c'; ctx.fillRect(0, 0, W, H);
    var cell = Math.max(10, Math.min(W, H) / 48);
    for (var y = 0, r = 0; y < H; y += cell, r++) {
      for (var x = 0, c = 0; x < W; x += cell, c++) {
        var v = hash(r * 97 + c * 31);
        if (v > 0.72) { ctx.fillStyle = 'rgba(80,200,180,' + (0.1 + v * 0.3).toFixed(3) + ')'; ctx.fillRect(x, y, cell - 1, cell - 1); }
      }
    }
  }
  var DRAW = {
    'mesh-gradient': meshGradient, 'paper-grain': paperGrain, 'dusk-bands': duskBands,
    'canvas-weave': canvasWeave, 'concrete': concrete, 'noise-grid': noiseGrid
  };
  window.pulpRender = function (state) {
    var d = size(state);
    ctx.clearRect(0, 0, d.W, d.H);
    (DRAW[state.params.variant] || meshGradient)(d.W, d.H);
  };
`,
);

/** Overlay plates: frames, vignettes, grunge, light leaks and logo bugs, on transparency (milestone 24). */
export const OVERLAY_PAGE = page(
  'Sample overlay plate',
  `
  function frameThin(W, H) {
    var i = Math.min(W, H) * 0.045;
    ctx.strokeStyle = 'rgba(245,245,240,0.92)'; ctx.lineWidth = Math.max(2, Math.min(W, H) * 0.004);
    ctx.strokeRect(i, i, W - i * 2, H - i * 2);
    ctx.lineWidth = Math.max(1, Math.min(W, H) * 0.0015);
    ctx.strokeRect(i * 1.5, i * 1.5, W - i * 3, H - i * 3);
  }
  function frameCorners(W, H) {
    var i = Math.min(W, H) * 0.05, len = Math.min(W, H) * 0.12;
    ctx.strokeStyle = 'rgba(255,214,120,0.95)'; ctx.lineWidth = Math.max(3, Math.min(W, H) * 0.007); ctx.lineCap = 'square';
    var pts = [[i, i, 1, 1], [W - i, i, -1, 1], [i, H - i, 1, -1], [W - i, H - i, -1, -1]];
    for (var k = 0; k < 4; k++) {
      var P = pts[k];
      ctx.beginPath(); ctx.moveTo(P[0] + len * P[2], P[1]); ctx.lineTo(P[0], P[1]); ctx.lineTo(P[0], P[1] + len * P[3]); ctx.stroke();
    }
  }
  function frameDeco(W, H) {
    var i = Math.min(W, H) * 0.06;
    ctx.strokeStyle = 'rgba(210,180,140,0.9)'; ctx.lineWidth = Math.max(2, Math.min(W, H) * 0.005);
    ctx.strokeRect(i, i, W - i * 2, H - i * 2);
    ctx.fillStyle = 'rgba(210,180,140,0.9)';
    var r = Math.min(W, H) * 0.012;
    var corners = [[i, i], [W - i, i], [i, H - i], [W - i, H - i]];
    for (var k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(corners[k][0], corners[k][1], r, 0, Math.PI * 2); ctx.fill(); }
  }
  function vignetteSoft(W, H) { plateVignette(W, H, 0.45, 0.72); }
  function vignetteHeavy(W, H) { plateVignette(W, H, 0.3, 0.92); }
  function plateVignette(W, H, inner, alpha) {
    var g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * inner, W / 2, H / 2, Math.max(W, H) * 0.78);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,' + alpha + ')');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  function vignetteOval(W, H) {
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(1, H / W);
    var g = ctx.createRadialGradient(0, 0, W * 0.3, 0, 0, W * 0.62);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(10,6,2,0.88)');
    ctx.fillStyle = g; ctx.fillRect(-W, -W, W * 2, W * 2); ctx.restore();
  }
  function grungeDust(W, H) {
    for (var i = 0; i < 900; i++) {
      var x = hash(i * 2) * W, y = hash(i * 2 + 1) * H, r = Math.min(W, H) * (0.0004 + hash(i + 400) * 0.0022);
      ctx.fillStyle = 'rgba(255,255,255,' + (0.05 + hash(i + 700) * 0.25).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }
  function grungeScratch(W, H) {
    ctx.lineWidth = Math.max(1, Math.min(W, H) * 0.0014);
    for (var i = 0; i < 26; i++) {
      var x = hash(i * 5) * W;
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.06 + hash(i + 60) * 0.22).toFixed(3) + ')';
      ctx.beginPath(); ctx.moveTo(x, 0);
      for (var y = 0; y < H; y += H / 10) ctx.lineTo(x + (hash(i * 13 + y) - 0.5) * W * 0.012, y);
      ctx.stroke();
    }
  }
  function grungeStain(W, H) {
    for (var i = 0; i < 14; i++) {
      var x = hash(i * 7) * W, y = hash(i * 7 + 3) * H, r = Math.min(W, H) * (0.06 + hash(i + 90) * 0.22);
      var g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(120,86,40,0.16)'); g.addColorStop(1, 'rgba(120,86,40,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }
  function leakWarm(W, H) { leak(W, H, '255,160,80', 0.8); }
  function leakCool(W, H) { leak(W, H, '120,180,255', 0.55); }
  function leak(W, H, rgb, strength) {
    var g = ctx.createLinearGradient(W, 0, W * 0.25, H);
    g.addColorStop(0, 'rgba(' + rgb + ',' + (0.55 * strength) + ')');
    g.addColorStop(0.5, 'rgba(' + rgb + ',' + (0.18 * strength) + ')');
    g.addColorStop(1, 'rgba(' + rgb + ',0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  function sparkMotes(W, H) {
    for (var i = 0; i < 90; i++) {
      var x = hash(i * 3) * W, y = hash(i * 3 + 1) * H, r = Math.min(W, H) * (0.002 + hash(i + 300) * 0.009);
      var g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,240,200,' + (0.3 + hash(i + 11) * 0.5).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(255,240,200,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }
  function bugRound(W, H) { bug(W, H, 'round'); }
  function bugSquare(W, H) { bug(W, H, 'square'); }
  function bugStrip(W, H) { bug(W, H, 'strip'); }
  function bug(W, H, shape) {
    var u = Math.min(W, H), m = u * 0.05;
    ctx.fillStyle = 'rgba(14,20,30,0.78)';
    if (shape === 'round') { ctx.beginPath(); ctx.arc(W - m - u * 0.09, m + u * 0.09, u * 0.09, 0, Math.PI * 2); ctx.fill(); }
    else if (shape === 'square') { ctx.fillRect(W - m - u * 0.18, m, u * 0.18, u * 0.18); }
    else { ctx.fillRect(W - m - u * 0.3, m, u * 0.3, u * 0.075); }
    ctx.fillStyle = 'rgba(245,250,255,0.95)';
    var cx = shape === 'strip' ? W - m - u * 0.15 : W - m - u * 0.09;
    var cy = shape === 'strip' ? m + u * 0.037 : m + u * 0.09;
    ctx.beginPath(); ctx.moveTo(cx - u * 0.03, cy + u * 0.025); ctx.lineTo(cx, cy - u * 0.03); ctx.lineTo(cx + u * 0.03, cy + u * 0.025); ctx.closePath(); ctx.fill();
  }
  var DRAW = {
    'frame-thin': frameThin, 'frame-corners': frameCorners, 'frame-deco': frameDeco,
    'vignette-soft': vignetteSoft, 'vignette-heavy': vignetteHeavy, 'vignette-oval': vignetteOval,
    'grunge-dust': grungeDust, 'grunge-scratch': grungeScratch, 'grunge-stain': grungeStain,
    'leak-warm': leakWarm, 'leak-cool': leakCool, 'spark-motes': sparkMotes,
    'bug-round': bugRound, 'bug-square': bugSquare, 'bug-strip': bugStrip
  };
  window.pulpRender = function (state) {
    var d = size(state);
    ctx.clearRect(0, 0, d.W, d.H);
    (DRAW[state.params.variant] || frameThin)(d.W, d.H);
  };
`,
);

/** Design elements: shapes, icons, arrows and charts, on transparency (milestone 24). */
export const ELEMENT_PAGE = page(
  'Sample design element',
  `
  function shapeStack(W, H) {
    var u = Math.min(W, H);
    var cols = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2'];
    for (var i = 0; i < 4; i++) {
      ctx.fillStyle = cols[i];
      ctx.beginPath(); ctx.arc(W / 2 + (i - 1.5) * u * 0.17, H / 2, u * 0.14, 0, Math.PI * 2); ctx.fill();
    }
  }
  function shapeChevrons(W, H) {
    var u = Math.min(W, H);
    ctx.strokeStyle = '#f4a261'; ctx.lineWidth = u * 0.035; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (var i = 0; i < 3; i++) {
      var x = W / 2 + (i - 1) * u * 0.18;
      ctx.beginPath(); ctx.moveTo(x - u * 0.07, H / 2 - u * 0.1); ctx.lineTo(x + u * 0.05, H / 2); ctx.lineTo(x - u * 0.07, H / 2 + u * 0.1); ctx.stroke();
    }
  }
  function shapeRings(W, H) {
    var u = Math.min(W, H);
    for (var i = 0; i < 4; i++) {
      ctx.strokeStyle = 'rgba(99,102,241,' + (1 - i * 0.2).toFixed(2) + ')';
      ctx.lineWidth = u * 0.016;
      ctx.beginPath(); ctx.arc(W / 2, H / 2, u * (0.09 + i * 0.06), 0, Math.PI * 2); ctx.stroke();
    }
  }
  function iconPlay(W, H) {
    var u = Math.min(W, H);
    ctx.fillStyle = '#22c55e'; ctx.beginPath(); ctx.arc(W / 2, H / 2, u * 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(W / 2 - u * 0.1, H / 2 - u * 0.14); ctx.lineTo(W / 2 + u * 0.16, H / 2); ctx.lineTo(W / 2 - u * 0.1, H / 2 + u * 0.14); ctx.closePath(); ctx.fill();
  }
  function iconPin(W, H) {
    var u = Math.min(W, H);
    ctx.fillStyle = '#ef4444';
    ctx.beginPath(); ctx.arc(W / 2, H / 2 - u * 0.08, u * 0.2, Math.PI, 0); 
    ctx.lineTo(W / 2, H / 2 + u * 0.28); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(W / 2, H / 2 - u * 0.08, u * 0.075, 0, Math.PI * 2); ctx.fill();
  }
  function iconStar(W, H) {
    var u = Math.min(W, H);
    ctx.fillStyle = '#facc15'; ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var a = (i / 10) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? u * 0.12 : u * 0.28;
      if (i === 0) ctx.moveTo(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r); else ctx.lineTo(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r);
    }
    ctx.closePath(); ctx.fill();
  }
  function arrowCurved(W, H) {
    var u = Math.min(W, H);
    ctx.strokeStyle = '#0ea5e9'; ctx.lineWidth = u * 0.03; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(W * 0.2, H * 0.68); ctx.quadraticCurveTo(W * 0.5, H * 0.2, W * 0.78, H * 0.5); ctx.stroke();
    ctx.fillStyle = '#0ea5e9';
    ctx.save(); ctx.translate(W * 0.78, H * 0.5); ctx.rotate(0.9);
    ctx.beginPath(); ctx.moveTo(0, -u * 0.07); ctx.lineTo(u * 0.1, 0); ctx.lineTo(0, u * 0.07); ctx.closePath(); ctx.fill(); ctx.restore();
  }
  function arrowBlock(W, H) {
    var u = Math.min(W, H);
    ctx.fillStyle = '#334155';
    ctx.beginPath(); ctx.moveTo(W * 0.22, H / 2 - u * 0.07); ctx.lineTo(W * 0.6, H / 2 - u * 0.07); ctx.lineTo(W * 0.6, H / 2 - u * 0.17);
    ctx.lineTo(W * 0.8, H / 2); ctx.lineTo(W * 0.6, H / 2 + u * 0.17); ctx.lineTo(W * 0.6, H / 2 + u * 0.07); ctx.lineTo(W * 0.22, H / 2 + u * 0.07);
    ctx.closePath(); ctx.fill();
  }
  function arrowSketch(W, H) {
    var u = Math.min(W, H);
    ctx.strokeStyle = '#1f2937'; ctx.lineWidth = u * 0.018; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (var i = 0; i <= 20; i++) {
      var f = i / 20, x = W * (0.2 + 0.58 * f), y = H * 0.5 + Math.sin(f * 3) * u * 0.05 + (hash(i) - 0.5) * u * 0.012;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W * 0.72, H * 0.5 - u * 0.08); ctx.lineTo(W * 0.79, H * 0.5); ctx.lineTo(W * 0.72, H * 0.5 + u * 0.08); ctx.stroke();
  }
  function chartBars(W, H) {
    var u = Math.min(W, H), vals = [0.35, 0.62, 0.48, 0.8, 0.55];
    var bw = W * 0.1, base = H * 0.78;
    for (var i = 0; i < vals.length; i++) {
      ctx.fillStyle = ['#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe'][i];
      var h = (base - H * 0.2) * vals[i];
      ctx.fillRect(W * 0.16 + i * bw * 1.4, base - h, bw, h);
    }
    ctx.strokeStyle = 'rgba(15,23,42,0.6)'; ctx.lineWidth = Math.max(2, u * 0.004);
    ctx.beginPath(); ctx.moveTo(W * 0.1, base); ctx.lineTo(W * 0.9, base); ctx.stroke();
  }
  function chartDonut(W, H) {
    var u = Math.min(W, H), parts = [0.42, 0.28, 0.18, 0.12], cols = ['#f97316', '#fbbf24', '#34d399', '#60a5fa'];
    var a0 = -Math.PI / 2;
    for (var i = 0; i < parts.length; i++) {
      var a1 = a0 + parts[i] * Math.PI * 2;
      ctx.fillStyle = cols[i]; ctx.beginPath(); ctx.moveTo(W / 2, H / 2);
      ctx.arc(W / 2, H / 2, u * 0.3, a0, a1); ctx.closePath(); ctx.fill();
      a0 = a1;
    }
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.arc(W / 2, H / 2, u * 0.16, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  function chartLine(W, H) {
    var u = Math.min(W, H), pts = [0.3, 0.45, 0.38, 0.6, 0.52, 0.75, 0.68];
    ctx.strokeStyle = '#10b981'; ctx.lineWidth = u * 0.016; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var x = W * (0.14 + (0.72 * i) / (pts.length - 1)), y = H * (0.82 - pts[i] * 0.6);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = '#065f46';
    for (var k = 0; k < pts.length; k++) {
      var px = W * (0.14 + (0.72 * k) / (pts.length - 1)), py = H * (0.82 - pts[k] * 0.6);
      ctx.beginPath(); ctx.arc(px, py, u * 0.015, 0, Math.PI * 2); ctx.fill();
    }
  }
  var DRAW = {
    'shape-stack': shapeStack, 'shape-chevrons': shapeChevrons, 'shape-rings': shapeRings,
    'icon-play': iconPlay, 'icon-pin': iconPin, 'icon-star': iconStar,
    'arrow-curved': arrowCurved, 'arrow-block': arrowBlock, 'arrow-sketch': arrowSketch,
    'chart-bars': chartBars, 'chart-donut': chartDonut, 'chart-line': chartLine
  };
  window.pulpRender = function (state) {
    var d = size(state);
    ctx.clearRect(0, 0, d.W, d.H);
    (DRAW[state.params.variant] || shapeStack)(d.W, d.H);
  };
`,
);

export const STILL_PAGES = { photo: PHOTO_PAGE, illustration: ILLUSTRATION_PAGE, layered: LAYERED_PAGE, backdrop: BACKDROP_PAGE, overlay: OVERLAY_PAGE, element: ELEMENT_PAGE } as const;

/** The data URL an offscreen window loads for a page. */
export function stillPageUrl(page: keyof typeof STILL_PAGES): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(STILL_PAGES[page])}`;
}
