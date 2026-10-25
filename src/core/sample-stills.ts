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


/** Motifs: flat themed emblems on transparency, one per variant (milestone 24's themed media). */
export const MOTIF_PAGE = page(
  'Sample motif',
  `
  var U;
  function disc(color, r) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0, 0, r * U, 0, Math.PI * 2); ctx.fill(); }
  function ringAt(color, r, w) { ctx.strokeStyle = color; ctx.lineWidth = w * U; ctx.beginPath(); ctx.arc(0, 0, r * U, 0, Math.PI * 2); ctx.stroke(); }
  function box(color, x, y, w, h, r) { ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect((x - w / 2) * U, (y - h / 2) * U, w * U, h * U, (r || 0) * U); ctx.fill(); }
  function poly(color, pts) {
    ctx.fillStyle = color; ctx.beginPath();
    for (var i = 0; i < pts.length; i++) { var P = pts[i]; if (i === 0) ctx.moveTo(P[0] * U, P[1] * U); else ctx.lineTo(P[0] * U, P[1] * U); }
    ctx.closePath(); ctx.fill();
  }
  function starPts(n, r0, r1) {
    var pts = [];
    for (var i = 0; i < n * 2; i++) { var a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? r0 : r1; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
    return pts;
  }
  var DRAW = {
    'medical-cross': function () { disc('#ffffff', 300); ringAt('#d33c3c', 300, 26); box('#d33c3c', 0, 0, 340, 110, 20); box('#d33c3c', 0, 0, 110, 340, 20); },
    'heart-pulse': function () {
      disc('#19243a', 300);
      ctx.strokeStyle = '#49e0b8'; ctx.lineWidth = 22 * U; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.beginPath();
      var pts = [[-230, 0], [-110, 0], [-70, -110], [-10, 130], [40, -60], [70, 0], [230, 0]];
      for (var i = 0; i < pts.length; i++) { if (i === 0) ctx.moveTo(pts[i][0] * U, pts[i][1] * U); else ctx.lineTo(pts[i][0] * U, pts[i][1] * U); }
      ctx.stroke();
    },
    'scales': function () {
      ctx.strokeStyle = '#8a6d2f'; ctx.fillStyle = '#8a6d2f'; ctx.lineWidth = 20 * U; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, -260 * U); ctx.lineTo(0, 240 * U); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-220 * U, -170 * U); ctx.lineTo(220 * U, -170 * U); ctx.stroke();
      box('#8a6d2f', 0, 260, 260, 34, 10);
      for (var s2 = -1; s2 <= 1; s2 += 2) {
        ctx.beginPath(); ctx.moveTo(s2 * 220 * U, -170 * U); ctx.lineTo(s2 * 150 * U, -20 * U); ctx.lineTo(s2 * 290 * U, -20 * U); ctx.closePath(); ctx.stroke();
        ctx.beginPath(); ctx.arc(s2 * 220 * U, -10 * U, 72 * U, 0, Math.PI); ctx.fill();
      }
    },
    'gavel': function () {
      ctx.save(); ctx.rotate(-Math.PI / 5);
      box('#7a4f2a', 0, -140, 300, 140, 26); box('#5d3a1c', 0, 20, 70, 260, 18);
      ctx.restore();
      box('#5d3a1c', 60, 290, 360, 48, 14);
    },
    'dove': function () {
      poly('#f3f1ea', [[-250, 40], [-60, -60], [40, -180], [70, -60], [260, -40], [90, 30], [120, 160], [-10, 70], [-120, 140]]);
      disc('#f3f1ea', 8);
    },
    'candle-remembrance': function () {
      box('#e8dcc2', 0, 120, 140, 320, 24);
      poly('#f4b942', [[0, -260], [46, -170], [26, -110], [-26, -110], [-46, -170]]);
      ringAt('rgba(244, 185, 66, 0.5)', 190, 16);
    },
    'hands-heart': function () {
      poly('#d96c8a', [[0, -40], [60, -110], [140, -100], [170, -20], [0, 150], [-170, -20], [-140, -100], [-60, -110]]);
      ctx.strokeStyle = '#8d5a3b'; ctx.lineWidth = 26 * U; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-220 * U, 240 * U); ctx.quadraticCurveTo(-160 * U, 140 * U, -60 * U, 190 * U); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(220 * U, 240 * U); ctx.quadraticCurveTo(160 * U, 140 * U, 60 * U, 190 * U); ctx.stroke();
    },
    'awareness-ribbon': function () {
      ctx.lineWidth = 64 * U; ctx.strokeStyle = '#4f9dd1'; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-130 * U, 260 * U); ctx.quadraticCurveTo(-180 * U, -80 * U, 0, -220 * U); ctx.quadraticCurveTo(180 * U, -80 * U, 130 * U, 260 * U); ctx.stroke();
    },
    'ballot-box': function () {
      box('#2c5e8a', 0, 90, 380, 260, 20); box('#244d72', 0, -60, 420, 60, 12); box('#11263a', 0, -60, 190, 20, 8);
      ctx.save(); ctx.rotate(-Math.PI / 8); box('#f3f1ea', 10, -170, 170, 110, 10); ctx.restore();
    },
    'planet-ring': function () {
      disc('#c77f4f', 190);
      ctx.strokeStyle = '#e8c89a'; ctx.lineWidth = 30 * U;
      ctx.save(); ctx.scale(1, 0.35); ctx.beginPath(); ctx.arc(0, 0, 300 * U, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    },
    'baseball-diamond': function () {
      poly('#3e7c46', [[0, -300], [300, 0], [0, 300], [-300, 0]]);
      poly('#c98f4e', [[0, -210], [210, 0], [0, 210], [-210, 0]]);
      for (var b = 0; b < 4; b++) { var a = (b / 4) * Math.PI * 2 - Math.PI / 2; box('#f3f1ea', Math.cos(a) * 190, Math.sin(a) * 190, 46, 46, 8); }
    },
    'pennant': function () {
      poly('#b23a3a', [[-260, -200], [280, -40], [-260, 120]]);
      box('#7a5230', -270, 0, 28, 460, 12);
    },
    'hockey-rink': function () {
      box('#dfeefb', 0, 0, 560, 360, 90);
      ctx.strokeStyle = '#b23a3a'; ctx.lineWidth = 14 * U; ctx.beginPath(); ctx.moveTo(0, -180 * U); ctx.lineTo(0, 180 * U); ctx.stroke();
      ringAt('#3a6ab2', 70, 12); disc('#11263a', 16);
    },
    'goalie-mask': function () {
      poly('#e8e4da', [[0, -240], [170, -150], [200, 60], [90, 230], [-90, 230], [-200, 60], [-170, -150]]);
      for (var r2 = 0; r2 < 3; r2++) for (var c2 = 0; c2 < 2; c2++) box('#11263a', c2 ? 70 : -70, -40 + r2 * 80, 40, 40, 20);
      box('#11263a', 0, -140, 46, 46, 23);
    },
    'golf-flag': function () {
      box('#e8e4da', 0, 260, 420, 60, 30);
      box('#9a9a9a', -20, -20, 18, 520, 9);
      poly('#d33c3c', [[-11, -280], [200, -210], [-11, -140]]);
      ctx.fillStyle = '#f3f1ea'; ctx.beginPath(); ctx.arc(90 * U, 250 * U, 36 * U, 0, Math.PI * 2); ctx.fill();
    },
    'golf-green': function () {
      poly('#3e7c46', [[-300, 160], [-120, -60], [80, -160], [300, -60], [240, 180], [-80, 240]]);
      box('#9a9a9a', 120, -140, 10, 220, 5);
      poly('#f2c84b', [[115, -250], [220, -215], [115, -180]]);
      ctx.fillStyle = '#e8f3ea'; ctx.beginPath(); ctx.arc(-80 * U, 120 * U, 26 * U, 0, Math.PI * 2); ctx.fill();
    },
    'tennis-court': function () {
      box('#3e7c8a', 0, 0, 560, 360, 16);
      ctx.strokeStyle = '#f3f1ea'; ctx.lineWidth = 10 * U;
      ctx.strokeRect(-250 * U, -150 * U, 500 * U, 300 * U);
      ctx.beginPath(); ctx.moveTo(0, -150 * U); ctx.lineTo(0, 150 * U); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-250 * U, 0); ctx.lineTo(250 * U, 0); ctx.stroke();
    },
    'racket': function () {
      ctx.save(); ctx.rotate(Math.PI / 6);
      ctx.strokeStyle = '#7a4f2a'; ctx.lineWidth = 34 * U;
      ctx.save(); ctx.scale(0.78, 1); ctx.beginPath(); ctx.arc(0, -90 * U, 190 * U, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      ctx.lineWidth = 6 * U; ctx.strokeStyle = 'rgba(122, 79, 42, 0.6)';
      for (var g2 = -4; g2 <= 4; g2++) {
        ctx.beginPath(); ctx.moveTo(g2 * 30 * U * 0.78, -270 * U); ctx.lineTo(g2 * 30 * U * 0.78, 90 * U); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-148 * U, -90 * U + g2 * 38 * U); ctx.lineTo(148 * U, -90 * U + g2 * 38 * U); ctx.stroke();
      }
      ctx.lineWidth = 34 * U; ctx.strokeStyle = '#7a4f2a';
      ctx.beginPath(); ctx.moveTo(0, 100 * U); ctx.lineTo(0, 300 * U); ctx.stroke();
      ctx.restore();
    },
    'checkered-flag': function () {
      ctx.save(); ctx.rotate(-Math.PI / 14);
      for (var r3 = 0; r3 < 4; r3++) for (var c3 = 0; c3 < 6; c3++) {
        ctx.fillStyle = (r3 + c3) % 2 ? '#16181c' : '#f3f1ea';
        ctx.fillRect((-240 + c3 * 80) * U, (-200 + r3 * 80) * U, 80 * U, 80 * U);
      }
      ctx.restore();
      box('#9a9a9a', -270, 60, 24, 520, 12);
    },
    'dumbbell': function () {
      box('#3c4452', 0, 0, 320, 44, 22);
      for (var s3 = -1; s3 <= 1; s3 += 2) { box('#2a303b', s3 * 200, 0, 70, 240, 20); box('#3c4452', s3 * 270, 0, 44, 170, 16); }
    },
    'whistle': function () {
      disc('#d9a23c', 150); disc('#1c1f26', 48);
      box('#d9a23c', 170, -90, 240, 110, 30);
      ctx.strokeStyle = '#d9a23c'; ctx.lineWidth = 18 * U;
      ctx.beginPath(); ctx.arc(260 * U, -180 * U, 60 * U, Math.PI * 0.2, Math.PI * 1.4); ctx.stroke();
    },
    'egg': function () {
      ctx.save(); ctx.scale(0.78, 1);
      disc('#bfe3f2', 280);
      ctx.restore();
      ctx.fillStyle = '#f2c84b';
      for (var z = -1; z <= 1; z++) box('#f2c84b', z * 110, 20, 70, 70, 35);
      box('#e88aa8', 0, -130, 420, 44, 22);
      box('#e88aa8', 0, 150, 420, 44, 22);
    },
    'tulip': function () {
      ctx.strokeStyle = '#3e7c46'; ctx.lineWidth = 26 * U; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 60 * U); ctx.lineTo(0, 300 * U); ctx.stroke();
      poly('#3e7c46', [[0, 200], [-140, 120], [-20, 260]]);
      poly('#d96c8a', [[-130, -40], [-120, -220], [-40, -110], [0, -250], [40, -110], [120, -220], [130, -40], [0, 80]]);
    },
    'basket': function () {
      ctx.save(); ctx.scale(0.72, 1); disc('#bfe3f2', 150); ctx.translate(-240 * U, -30 * U); disc('#e88aa8', 120); ctx.translate(480 * U, 0); disc('#cdebc0', 120); ctx.restore();
      poly('#8d5a3b', [[-300, -20], [300, -20], [220, 260], [-220, 260]]);
      ctx.strokeStyle = 'rgba(60, 38, 22, 0.35)'; ctx.lineWidth = 10 * U;
      for (var w2 = -2; w2 <= 2; w2++) { ctx.beginPath(); ctx.moveTo(-300 * U + (w2 + 2) * 150 * U, -20 * U); ctx.lineTo(-220 * U + (w2 + 2) * 110 * U, 260 * U); ctx.stroke(); }
    },
    'pumpkin': function () {
      ctx.fillStyle = '#e0762f';
      for (var k = -1; k <= 1; k++) { ctx.save(); ctx.translate(k * 110 * U, 0); ctx.scale(0.62, 1); ctx.beginPath(); ctx.arc(0, 40 * U, 240 * U, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
      box('#3e7c46', 0, -230, 54, 120, 20);
      poly('#2a1a0c', [[-110, -40], [-60, 20], [-160, 20]]);
      poly('#2a1a0c', [[110, -40], [160, 20], [60, 20]]);
      poly('#2a1a0c', [[-120, 120], [-60, 170], [0, 120], [60, 170], [120, 120], [60, 220], [-60, 220]]);
    },
    'bat': function () {
      poly('#241c30', [[0, -60], [60, -140], [120, -80], [260, -140], [190, 0], [260, 120], [90, 70], [0, 180], [-90, 70], [-260, 120], [-190, 0], [-260, -140], [-120, -80], [-60, -140]]);
    },
    'haunted-house': function () {
      poly('#241c30', [[-240, 240], [-240, -40], [-120, -40], [-120, -160], [0, -280], [120, -160], [120, -80], [240, -80], [240, 240]]);
      box('#f2c84b', -60, 40, 70, 70, 6); box('#f2c84b', 130, 60, 70, 70, 6);
      poly('#241c30', [[-320, -20], [-240, -90], [-240, 30]]);
    },
    'turkey': function () {
      ctx.fillStyle = '#b2622f';
      var fans = ['#8a3b2f', '#c98f4e', '#8a3b2f', '#c98f4e', '#8a3b2f'];
      for (var f2 = 0; f2 < 5; f2++) {
        var a2 = Math.PI + (f2 / 4) * Math.PI;
        ctx.save(); ctx.rotate(a2 + Math.PI / 2); ctx.fillStyle = fans[f2];
        ctx.beginPath(); ctx.ellipse(0, -200 * U, 70 * U, 180 * U, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
      disc('#b2622f', 170);
      disc('#8a4a22', 0); ctx.save(); ctx.translate(0, -150 * U); disc('#b2622f', 80); ctx.restore();
      poly('#f2c84b', [[-20, -160], [-70, -130], [-20, -110]]);
    },
    'cornucopia': function () {
      ctx.strokeStyle = '#8d5a3b'; ctx.lineWidth = 90 * U; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(220 * U, -120 * U); ctx.quadraticCurveTo(-240 * U, -160 * U, -160 * U, 120 * U); ctx.quadraticCurveTo(-110 * U, 230 * U, 30 * U, 170 * U); ctx.stroke();
      ctx.save(); ctx.translate(140 * U, 120 * U); disc('#d33c3c', 70); ctx.translate(130 * U, -30 * U); disc('#f2c84b', 60); ctx.translate(-60 * U, 110 * U); disc('#cdebc0', 55); ctx.restore();
    },
    'stars-stripes-shield': function () {
      poly('#f3f1ea', [[-240, -200], [240, -200], [240, 40], [0, 260], [-240, 40]]);
      box('#28406b', 0, -140, 480, 120, 0);
      ctx.fillStyle = '#f3f1ea';
      for (var st = 0; st < 5; st++) { ctx.save(); ctx.translate((-160 + st * 80) * U, -140 * U); ctx.scale(0.22, 0.22); poly('#f3f1ea', starPts(5, 60, 150)); ctx.restore(); }
      ctx.fillStyle = '#b23a3a';
      for (var sp = 0; sp < 3; sp++) box('#b23a3a', 0, -20 + sp * 90, 440 - sp * 60, 44, 22);
    },
    'bunting': function () {
      ctx.strokeStyle = '#5a5e68'; ctx.lineWidth = 12 * U;
      ctx.beginPath(); ctx.moveTo(-300 * U, -160 * U); ctx.quadraticCurveTo(0, -60 * U, 300 * U, -160 * U); ctx.stroke();
      var cols = ['#b23a3a', '#f3f1ea', '#28406b', '#f3f1ea', '#b23a3a'];
      for (var b2 = 0; b2 < 5; b2++) {
        var fx = -260 + b2 * 130, fy = -130 + Math.sin((b2 / 4) * Math.PI) * 70;
        poly(cols[b2], [[fx - 55, fy], [fx + 55, fy], [fx, fy + 150]]);
      }
    },
    'rosette-flag': function () {
      box('#9a9a9a', -200, 20, 20, 460, 10);
      box('#b23a3a', 20, -120, 420, 110, 10);
      box('#f3f1ea', 20, -10, 420, 110, 10);
      box('#28406b', 20, 100, 420, 110, 10);
    },
    'lighthouse': function () {
      poly('#f3f1ea', [[-90, 240], [-50, -120], [50, -120], [90, 240]]);
      box('#b23a3a', 0, 60, 150, 70, 0); box('#b23a3a', 0, 180, 170, 70, 0);
      box('#2a303b', 0, -160, 120, 80, 10);
      poly('#f2c84b', [[-60, -200], [60, -200], [0, -290]]);
      ctx.fillStyle = 'rgba(242, 200, 75, 0.4)';
      poly('rgba(242, 200, 75, 0.4)', [[60, -210], [320, -280], [320, -140]]);
    },
    'wave-crest': function () {
      ctx.fillStyle = '#3a6ab2';
      ctx.beginPath(); ctx.moveTo(-300 * U, 200 * U);
      ctx.quadraticCurveTo(-240 * U, -140 * U, 40 * U, -160 * U);
      ctx.quadraticCurveTo(220 * U, -170 * U, 200 * U, -40 * U);
      ctx.quadraticCurveTo(190 * U, -120 * U, 60 * U, -90 * U);
      ctx.quadraticCurveTo(-80 * U, -40 * U, -40 * U, 200 * U);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#9ec7e8';
      ctx.beginPath(); ctx.arc(120 * U, 60 * U, 60 * U, 0, Math.PI * 2); ctx.arc(220 * U, 120 * U, 40 * U, 0, Math.PI * 2); ctx.fill();
    },
    'shell': function () {
      poly('#e8cba8', [[0, 240], [-220, -60], [-140, -180], [0, -230], [140, -180], [220, -60]]);
      ctx.strokeStyle = 'rgba(140, 100, 60, 0.45)'; ctx.lineWidth = 14 * U; ctx.lineCap = 'round';
      for (var sh = -2; sh <= 2; sh++) { ctx.beginPath(); ctx.moveTo(0, 240 * U); ctx.lineTo(sh * 100 * U, -200 * U + Math.abs(sh) * 30 * U); ctx.stroke(); }
    },
    'sun-cloud': function () {
      ctx.save(); ctx.translate(-90 * U, -90 * U); disc('#f2c84b', 150);
      ctx.strokeStyle = '#f2c84b'; ctx.lineWidth = 22 * U; ctx.lineCap = 'round';
      for (var r4 = 0; r4 < 8; r4++) { var a4 = (r4 / 8) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(Math.cos(a4) * 190 * U, Math.sin(a4) * 190 * U); ctx.lineTo(Math.cos(a4) * 240 * U, Math.sin(a4) * 240 * U); ctx.stroke(); }
      ctx.restore();
      ctx.fillStyle = '#eef2f6';
      ctx.beginPath(); ctx.arc(40 * U, 80 * U, 110 * U, 0, Math.PI * 2); ctx.arc(180 * U, 90 * U, 85 * U, 0, Math.PI * 2); ctx.arc(-80 * U, 110 * U, 85 * U, 0, Math.PI * 2); ctx.fill();
      box('#eef2f6', 50, 150, 340, 80, 40);
    },
    'umbrella': function () {
      ctx.fillStyle = '#d33c3c';
      ctx.beginPath(); ctx.arc(0, -40 * U, 260 * U, Math.PI, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#b23030';
      for (var p2 = -2; p2 <= 2; p2 += 2) { ctx.beginPath(); ctx.arc(p2 * 130 * U, -40 * U, 70 * U, 0, Math.PI); ctx.fill(); }
      ctx.strokeStyle = '#2a303b'; ctx.lineWidth = 20 * U; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, -40 * U); ctx.lineTo(0, 220 * U); ctx.arc(60 * U, 220 * U, 60 * U, Math.PI, 0, true); ctx.stroke();
    },
    'lightning-bolt': function () {
      poly('#f2c84b', [[60, -280], [-140, 40], [-10, 40], [-60, 280], [150, -60], [20, -60]]);
    },
    'neon-sign': function () {
      box('#16181c', 0, 0, 540, 360, 24);
      ctx.strokeStyle = '#ff5ca8'; ctx.lineWidth = 16 * U; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(-80 * U, 0, 110 * U, Math.PI * 0.25, Math.PI * 1.75); ctx.stroke();
      ctx.strokeStyle = '#49e0f2';
      ctx.beginPath(); ctx.moveTo(90 * U, -110 * U); ctx.lineTo(90 * U, 110 * U); ctx.moveTo(90 * U, -110 * U); ctx.quadraticCurveTo(230 * U, -40 * U, 90 * U, 20 * U); ctx.stroke();
      ringAt('rgba(255, 92, 168, 0.3)', 320, 10);
    },
    'metro-lines': function () {
      ctx.lineCap = 'round'; ctx.lineWidth = 26 * U;
      ctx.strokeStyle = '#d33c3c'; ctx.beginPath(); ctx.moveTo(-260 * U, 180 * U); ctx.lineTo(-40 * U, -40 * U); ctx.lineTo(260 * U, -40 * U); ctx.stroke();
      ctx.strokeStyle = '#3a6ab2'; ctx.beginPath(); ctx.moveTo(-260 * U, -180 * U); ctx.lineTo(0, 80 * U); ctx.lineTo(260 * U, 80 * U); ctx.stroke();
      ctx.strokeStyle = '#3e7c46'; ctx.beginPath(); ctx.moveTo(-200 * U, -260 * U); ctx.lineTo(-200 * U, 240 * U); ctx.stroke();
      var stops = [[-200, -180, '#3e7c46'], [-40, -40, '#d33c3c'], [0, 80, '#3a6ab2'], [-200, 120, '#3e7c46'], [140, -40, '#d33c3c']];
      for (var st2 = 0; st2 < stops.length; st2++) { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(stops[st2][0] * U, stops[st2][1] * U, 26 * U, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = stops[st2][2]; ctx.lineWidth = 12 * U; ctx.stroke(); }
      ctx.lineWidth = 26 * U;
    },
    'ornament': function () {
      ringAt('#c9a227', 150, 16); disc('#b23a3a', 150);
      ctx.strokeStyle = '#f3e3b0'; ctx.lineWidth = 14 * U;
      ctx.beginPath(); ctx.arc(0, 0, 150 * U, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
      box('#c9a227', 0, -185, 70, 70, 10); box('#c9a227', 0, -235, 34, 50, 12);
    },
    'christmas-tree': function () {
      for (var i = 0; i < 3; i++) poly('#2f6b3f', [[0, -300 + i * 110], [150 + i * 50, -120 + i * 110], [-150 - i * 50, -120 + i * 110]]);
      box('#7a4f2a', 0, 250, 70, 110, 8);
      ctx.fillStyle = '#f2c84b';
      for (var b = 0; b < 7; b++) { ctx.beginPath(); ctx.arc((hash(b) - 0.5) * 300 * U, (-60 + hash(b + 9) * 230) * U, 18 * U, 0, Math.PI * 2); ctx.fill(); }
      ctx.save(); ctx.translate(0, -320 * U); ctx.scale(0.3, 0.3); poly('#f2c84b', starPts(5, 70, 170)); ctx.restore();
    },
    'champagne-pop': function () {
      ctx.save(); ctx.rotate(-Math.PI / 7);
      poly('#2f4a33', [[-70, 280], [70, 280], [60, -40], [26, -120], [26, -220], [-26, -220], [-26, -120], [-60, -40]]);
      box('#c9a227', 0, 120, 150, 110, 10);
      ctx.restore();
      ctx.fillStyle = '#f3e3b0';
      for (var k = 0; k < 14; k++) { var a = -Math.PI * 0.75 + hash(k) * Math.PI * 0.6; var d2 = (170 + hash(k + 4) * 240) * U; ctx.beginPath(); ctx.arc(120 * U + Math.cos(a) * d2, -200 * U + Math.sin(a) * d2 * 0.6, (8 + hash(k + 20) * 12) * U, 0, Math.PI * 2); ctx.fill(); }
    },
    'midnight-clock': function () {
      disc('#f3f1ea', 300); ringAt('#28406b', 300, 22); disc('#28406b', 18);
      ctx.strokeStyle = '#28406b'; ctx.lineWidth = 20 * U; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -210 * U); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -150 * U); ctx.stroke();
      ctx.lineWidth = 10 * U;
      for (var h = 0; h < 12; h++) { var ah = (h / 12) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(Math.cos(ah) * 250 * U, Math.sin(ah) * 250 * U); ctx.lineTo(Math.cos(ah) * 275 * U, Math.sin(ah) * 275 * U); ctx.stroke(); }
    },
    'heart': function () {
      poly('#d33c5e', [[0, -60], [70, -150], [180, -140], [230, -30], [0, 250], [-230, -30], [-180, -140], [-70, -150]]);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath(); ctx.arc(-110 * U, -70 * U, 40 * U, 0, Math.PI * 2); ctx.fill();
    },
    'rose': function () {
      ctx.strokeStyle = '#2f6b3f'; ctx.lineWidth = 24 * U; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 40 * U); ctx.lineTo(0, 300 * U); ctx.stroke();
      poly('#2f6b3f', [[0, 170], [-150, 100], [-20, 230]]);
      for (var r5 = 4; r5 >= 1; r5--) { disc(r5 % 2 ? '#c2304f' : '#e05070', 40 * r5); }
    },
    'birthday-cake': function () {
      box('#e8cba8', 0, 170, 420, 180, 18); box('#f3e3d0', 0, 60, 340, 110, 16);
      ctx.fillStyle = '#d33c5e';
      for (var c5 = 0; c5 < 5; c5++) ctx.fillRect((-170 + c5 * 85) * U, 90 * U, 26 * U, 60 * U);
      for (var cd = -1; cd <= 1; cd++) {
        box('#f3f1ea', cd * 110, -40, 26, 120, 8);
        poly('#f2c84b', [[cd * 110, -150], [cd * 110 + 24, -105], [cd * 110, -80], [cd * 110 - 24, -105]]);
      }
    },
    'balloons': function () {
      var cols = ['#d33c5e', '#f2c84b', '#3a6ab2'];
      for (var bl = 0; bl < 3; bl++) {
        var bx = (bl - 1) * 160, by = -90 + Math.abs(bl - 1) * 60;
        ctx.save(); ctx.translate(bx * U, by * U); ctx.scale(0.85, 1); disc(cols[bl], 110); ctx.restore();
        ctx.strokeStyle = 'rgba(240,240,235,0.8)'; ctx.lineWidth = 6 * U;
        ctx.beginPath(); ctx.moveTo(bx * U, (by + 105) * U); ctx.quadraticCurveTo((bx + 30) * U, (by + 220) * U, bx * U, 300 * U); ctx.stroke();
      }
    },
    'graduation-cap': function () {
      poly('#1f2430', [[0, -170], [320, -40], [0, 90], [-320, -40]]);
      poly('#2a3040', [[-170, -5], [170, -5], [170, 130], [0, 190], [-170, 130]]);
      ctx.strokeStyle = '#c9a227'; ctx.lineWidth = 12 * U;
      ctx.beginPath(); ctx.moveTo(250 * U, -8 * U); ctx.lineTo(250 * U, 150 * U); ctx.stroke();
      disc('#c9a227', 0); ctx.fillStyle = '#c9a227'; ctx.beginPath(); ctx.arc(250 * U, 175 * U, 34 * U, 0, Math.PI * 2); ctx.fill();
    },
    'diploma': function () {
      ctx.save(); ctx.rotate(-Math.PI / 16);
      box('#f5efe0', 0, 0, 520, 180, 14);
      ctx.strokeStyle = '#d6cdb6'; ctx.lineWidth = 8 * U;
      for (var ln = -1; ln <= 1; ln++) { ctx.beginPath(); ctx.moveTo(-200 * U, ln * 40 * U); ctx.lineTo(200 * U, ln * 40 * U); ctx.stroke(); }
      box('#b23a3a', 0, 0, 60, 200, 0);
      ctx.restore();
    },
    'wedding-rings': function () {
      ctx.lineWidth = 26 * U;
      ctx.strokeStyle = '#c9a227'; ctx.beginPath(); ctx.arc(-70 * U, 20 * U, 150 * U, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#e4d08a'; ctx.beginPath(); ctx.arc(70 * U, 20 * U, 150 * U, 0, Math.PI * 2); ctx.stroke();
      ctx.save(); ctx.translate(70 * U, -130 * U); ctx.scale(0.18, 0.18); poly('#f3f1ea', starPts(4, 60, 180)); ctx.restore();
    },
    'chef-hat': function () {
      ctx.fillStyle = '#f3f1ea';
      ctx.beginPath(); ctx.arc(-120 * U, -80 * U, 110 * U, 0, Math.PI * 2); ctx.arc(0, -140 * U, 130 * U, 0, Math.PI * 2); ctx.arc(120 * U, -80 * U, 110 * U, 0, Math.PI * 2); ctx.fill();
      box('#f3f1ea', 0, 60, 380, 200, 8);
      box('#d9d2c3', 0, 190, 380, 60, 8);
    }
  };
  window.pulpRender = function (state) {
    var d = size(state);
    ctx.clearRect(0, 0, d.W, d.H);
    U = Math.min(d.W, d.H) / 720;
    ctx.save();
    ctx.translate(d.W / 2, d.H / 2);
    (DRAW[state.params.variant] || DRAW['medical-cross'])();
    ctx.restore();
  };
`,
);

/**
 * Assets (milestone 26): isolated elements on transparency, drawn for a moment
 * in time so the same page serves a still and a clip. `state.time` and
 * `state.duration` drive everything; a looping asset is written so the last
 * frame meets the first, a one-shot plays once and clears. Deterministic from
 * the seeded hash, never a random source.
 */
export const ASSET_PAGE = page(
  'Sample asset',
  `
  var U, T, D, P;
  function rgba(c, a) { return 'rgba(' + c + ',' + a.toFixed(3) + ')'; }
  function blob(x, y, r, colour, alpha) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, r));
    g.addColorStop(0, rgba(colour, alpha));
    g.addColorStop(1, rgba(colour, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, Math.max(1, r), 0, Math.PI * 2); ctx.fill();
  }
  /** A flame tongue: stacked blobs narrowing upward, licking on a fixed wobble. */
  function flame(cx, baseY, h, w, seed, bright) {
    for (var i = 0; i < 16; i++) {
      var f = i / 15;
      var lick = Math.sin(P * Math.PI * 2 * 2 + f * 5 + seed) * w * 0.18 * f;
      var x = cx + lick, y = baseY - h * f;
      var r = w * (1 - f * 0.78) * (0.9 + 0.1 * Math.sin(P * Math.PI * 2 + i));
      var hot = f < 0.45;
      blob(x, y, r, hot ? '255,220,130' : '255,120,30', (hot ? 0.5 : 0.35) * (1 - f * 0.55) * bright);
    }
    blob(cx, baseY - h * 0.1, w * 0.6, '255,250,220', 0.5 * bright);
  }
  function puff(cx, cy, r, alpha, tone) {
    for (var i = 0; i < 7; i++) {
      var a = (i / 7) * Math.PI * 2 + P * 0.7;
      blob(cx + Math.cos(a) * r * 0.45, cy + Math.sin(a) * r * 0.3, r * 0.62, tone, alpha * 0.5);
    }
    blob(cx, cy, r * 0.8, tone, alpha * 0.6);
  }
  var DRAW = {
    // --- Fire and flames
    'candle-flame': function (W, H) { flame(W / 2, H * 0.78, H * 0.42, W * 0.08, 1.3, 1); },
    'torch-flame': function (W, H) {
      flame(W / 2, H * 0.72, H * 0.5, W * 0.17, 0.4, 1);
      flame(W / 2 - W * 0.05, H * 0.74, H * 0.34, W * 0.1, 2.1, 0.8);
    },
    // --- Smoke and steam
    'smoke-wisps': function (W, H) {
      for (var i = 0; i < 9; i++) {
        var f = ((i / 9) + P) % 1;
        var x = W / 2 + Math.sin(f * 4 + i) * W * 0.12;
        puff(x, H * (0.92 - f * 0.86), W * (0.07 + f * 0.17), (1 - f) * 0.5 * Math.min(1, f * 6), '200,200,205');
      }
    },
    'steam-cup': function (W, H) {
      for (var i = 0; i < 7; i++) {
        var f = ((i / 7) + P) % 1;
        puff(W / 2 + Math.sin(f * 6 + i * 2) * W * 0.1, H * (0.85 - f * 0.7), W * (0.05 + f * 0.1), (1 - f) * 0.42 * Math.min(1, f * 8), '235,235,240');
      }
    },
    // --- Sparks and embers
    'spark-shower': function (W, H) {
      for (var i = 0; i < 90; i++) {
        var life = 0.3 + hash(i) * 0.5, born = hash(i + 40);
        var f = ((P - born) + 1) % 1;
        if (f > life) continue;
        var t2 = f / life;
        var a = (hash(i + 80) - 0.5) * 2.2 - Math.PI / 2;
        var speed = W * (0.25 + hash(i + 120) * 0.4);
        var x = W / 2 + Math.cos(a) * speed * t2;
        var y = H * 0.55 + Math.sin(a) * speed * t2 + H * 0.9 * t2 * t2;
        blob(x, y, W * 0.008 * (1 - t2 * 0.6), '255,200,90', (1 - t2) * 0.95);
      }
      blob(W / 2, H * 0.55, W * 0.05, '255,230,160', 0.35);
    },
    'drifting-embers': function (W, H) {
      for (var i = 0; i < 46; i++) {
        var f = ((hash(i) + P * (0.3 + hash(i + 11) * 0.4)) % 1);
        var x = W * hash(i + 22) + Math.sin(f * 5 + i) * W * 0.05;
        blob(x, H * (1 - f), W * 0.006, '255,150,60', (1 - Math.abs(f - 0.5) * 2) * 0.9);
      }
    },
    // --- Explosions and impacts
    'shockwave-ring': function (W, H) {
      var f = P;
      var r = Math.min(W, H) * 0.08 + Math.min(W, H) * 0.42 * f;
      ctx.lineWidth = Math.max(1, Math.min(W, H) * 0.035 * (1 - f));
      ctx.strokeStyle = rgba('255,245,220', (1 - f) * 0.9);
      ctx.beginPath(); ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2); ctx.stroke();
      blob(W / 2, H / 2, r * 0.6, '255,200,120', (1 - f) * 0.3);
    },
    'dust-burst': function (W, H) {
      var f = P;
      for (var i = 0; i < 26; i++) {
        var a = (i / 26) * Math.PI * 2;
        var d2 = Math.min(W, H) * 0.42 * f * (0.6 + hash(i) * 0.7);
        puff(W / 2 + Math.cos(a) * d2, H / 2 + Math.sin(a) * d2 * 0.6, Math.min(W, H) * (0.05 + f * 0.09), (1 - f) * 0.4, '206,190,160');
      }
    },
    // --- Energy and magic
    'energy-orb': function (W, H) {
      var pulse = 0.85 + 0.15 * Math.sin(P * Math.PI * 2);
      var r = Math.min(W, H) * 0.22 * pulse;
      blob(W / 2, H / 2, r * 2.1, '80,180,255', 0.3);
      blob(W / 2, H / 2, r, '170,230,255', 0.75);
      ctx.strokeStyle = rgba('210,245,255', 0.6);
      ctx.lineWidth = Math.max(1, Math.min(W, H) * 0.006);
      for (var i = 0; i < 3; i++) {
        var a = P * Math.PI * 2 + (i / 3) * Math.PI * 2;
        ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(a); ctx.scale(1, 0.35);
        ctx.beginPath(); ctx.arc(0, 0, r * 1.7, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      }
    },
    'sparkle-trail': function (W, H) {
      for (var i = 0; i < 40; i++) {
        var f = ((i / 40) + P) % 1;
        var x = W * 0.1 + W * 0.8 * f, y = H / 2 + Math.sin(f * Math.PI * 2) * H * 0.22;
        var tw = 0.4 + 0.6 * Math.abs(Math.sin(P * Math.PI * 6 + i));
        blob(x, y, W * 0.012 * tw, '235,210,255', (1 - f) * 0.9 * tw);
      }
    },
    // --- Light and flares
    'lens-flare': function (W, H) {
      blob(W * 0.32, H / 2, Math.min(W, H) * 0.3, '255,245,220', 0.75);
      var g = ctx.createLinearGradient(0, H / 2, W, H / 2);
      g.addColorStop(0, rgba('255,240,210', 0)); g.addColorStop(0.32, rgba('255,240,210', 0.5)); g.addColorStop(1, rgba('255,240,210', 0));
      ctx.fillStyle = g; ctx.fillRect(0, H / 2 - Math.max(2, H * 0.008), W, Math.max(4, H * 0.016));
      for (var i = 1; i <= 4; i++) blob(W * (0.32 + i * 0.14), H / 2, Math.min(W, H) * (0.05 - i * 0.007), i % 2 ? '160,220,255' : '255,190,160', 0.4);
    },
    'glint': function (W, H) {
      var f = Math.sin(P * Math.PI);
      var r = Math.min(W, H) * 0.3 * f;
      ctx.strokeStyle = rgba('255,255,245', f * 0.95);
      ctx.lineWidth = Math.max(1, Math.min(W, H) * 0.012 * f);
      for (var i = 0; i < 4; i++) {
        var a = (i / 4) * Math.PI;
        ctx.beginPath(); ctx.moveTo(W / 2 - Math.cos(a) * r, H / 2 - Math.sin(a) * r);
        ctx.lineTo(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r); ctx.stroke();
      }
      blob(W / 2, H / 2, r * 0.45, '255,255,240', f * 0.9);
    },
    // --- Weather effects
    'rain-fall': function (W, H) {
      ctx.strokeStyle = rgba('180,210,240', 0.55);
      ctx.lineWidth = Math.max(1, W * 0.003);
      for (var i = 0; i < 120; i++) {
        var f = ((hash(i) + P * (1.4 + hash(i + 9) * 0.5)) % 1);
        var x = W * hash(i + 31) + f * W * 0.06, y = H * f;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - W * 0.01, y + H * 0.06); ctx.stroke();
      }
    },
    'snow-flurry': function (W, H) {
      for (var i = 0; i < 80; i++) {
        var f = ((hash(i) + P * (0.3 + hash(i + 7) * 0.3)) % 1);
        var x = W * hash(i + 17) + Math.sin(f * 4 + i) * W * 0.05;
        blob(x, H * f, W * (0.004 + hash(i + 51) * 0.005), '255,255,255', 0.85);
      }
    },
    // --- Liquids and splashes
    'water-splash': function (W, H) {
      var f = P;
      ctx.fillStyle = rgba('150,210,245', (1 - f) * 0.8);
      for (var i = 0; i < 22; i++) {
        var a = -Math.PI / 2 + (hash(i) - 0.5) * 2.4;
        var d2 = Math.min(W, H) * 0.45 * f * (0.5 + hash(i + 13) * 0.8);
        var x = W / 2 + Math.cos(a) * d2, y = H * 0.72 + Math.sin(a) * d2 + H * 0.6 * f * f;
        ctx.beginPath(); ctx.arc(x, y, Math.min(W, H) * 0.02 * (1 - f * 0.5), 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = rgba('190,230,250', (1 - f) * 0.7);
      ctx.lineWidth = Math.max(1, Math.min(W, H) * 0.012);
      ctx.save(); ctx.translate(W / 2, H * 0.74); ctx.scale(1, 0.3);
      ctx.beginPath(); ctx.arc(0, 0, Math.min(W, H) * 0.12 + Math.min(W, H) * 0.3 * f, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    },
    'ink-bloom': function (W, H) {
      var f = P;
      for (var i = 0; i < 14; i++) {
        var a = (i / 14) * Math.PI * 2 + hash(i);
        var d2 = Math.min(W, H) * 0.3 * f * (0.5 + hash(i + 21) * 0.9);
        blob(W / 2 + Math.cos(a) * d2, H / 2 + Math.sin(a) * d2, Math.min(W, H) * (0.06 + f * 0.08), '30,40,70', 0.5);
      }
      blob(W / 2, H / 2, Math.min(W, H) * (0.1 + f * 0.14), '20,28,55', 0.65);
    },
    // --- Confetti and celebration
    'confetti-burst': function (W, H) {
      var cols = ['244,96,120', '250,200,70', '90,200,160', '120,160,250', '230,140,230'];
      for (var i = 0; i < 90; i++) {
        var f = P;
        var a = (hash(i) - 0.5) * 3 - Math.PI / 2;
        var speed = Math.min(W, H) * (0.4 + hash(i + 5) * 0.6);
        var x = W / 2 + Math.cos(a) * speed * f;
        var y = H * 0.6 + Math.sin(a) * speed * f + H * 1.1 * f * f;
        ctx.save(); ctx.translate(x, y); ctx.rotate(f * 9 + i);
        ctx.fillStyle = rgba(cols[i % 5], 1 - f * 0.4);
        ctx.fillRect(-W * 0.008, -W * 0.014, W * 0.016, W * 0.028);
        ctx.restore();
      }
    },
    'glitter-fall': function (W, H) {
      for (var i = 0; i < 70; i++) {
        var f = ((hash(i) + P * (0.4 + hash(i + 3) * 0.4)) % 1);
        var tw = 0.35 + 0.65 * Math.abs(Math.sin(P * Math.PI * 8 + i));
        blob(W * hash(i + 29) + Math.sin(f * 5 + i) * W * 0.03, H * f, W * 0.006 * tw, '255,228,150', tw * 0.9);
      }
    },
    // --- Brush and ink strokes
    'brush-swipe': function (W, H) {
      var f = P;
      ctx.strokeStyle = rgba('25,30,40', 0.92);
      ctx.lineCap = 'round';
      for (var pass = 0; pass < 7; pass++) {
        ctx.lineWidth = Math.max(1, H * (0.16 - pass * 0.018));
        ctx.globalAlpha = 0.5 - pass * 0.05;
        ctx.beginPath();
        for (var i = 0; i <= 24; i++) {
          var g2 = i / 24;
          if (g2 > f) break;
          var x = W * (0.06 + g2 * 0.88);
          var y = H / 2 + Math.sin(g2 * 2.6) * H * 0.1 + (hash(i + pass * 11) - 0.5) * H * 0.05;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
    'marker-underline': function (W, H) {
      var f = P;
      ctx.strokeStyle = rgba('250,205,60', 0.85);
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(2, H * 0.22);
      ctx.beginPath();
      ctx.moveTo(W * 0.08, H * 0.56);
      ctx.lineTo(W * (0.08 + 0.84 * Math.min(1, f * 1.1)), H * 0.52);
      ctx.stroke();
    }
  };
  window.pulpRender = function (state) {
    var d = size(state);
    ctx.clearRect(0, 0, d.W, d.H);
    U = Math.min(d.W, d.H);
    T = state.time; D = state.duration || 1;
    P = Math.min(1, Math.max(0, T / D));
    (DRAW[state.params.variant] || DRAW['candle-flame'])(d.W, d.H);
  };
`,
);

export const STILL_PAGES = { photo: PHOTO_PAGE, illustration: ILLUSTRATION_PAGE, layered: LAYERED_PAGE, backdrop: BACKDROP_PAGE, overlay: OVERLAY_PAGE, element: ELEMENT_PAGE, motif: MOTIF_PAGE, asset: ASSET_PAGE } as const;

/** The data URL an offscreen window loads for a page. */
export function stillPageUrl(page: keyof typeof STILL_PAGES): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(STILL_PAGES[page])}`;
}
