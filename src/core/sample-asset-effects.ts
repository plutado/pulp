/**
 * The asset page's later Effects (milestone 26): the four that take each of
 * the ten Effects categories from two examples to six. Plain JavaScript for
 * the page's script, spliced in after its helpers (`blob`, `flame`, `puff`,
 * `rgba`, `hash`) and before `window.pulpRender`, so everything here draws
 * with the same vocabulary as the first twenty. `P` is the clip's progress
 * (0 at a still), `U` the shorter side.
 */
export const ASSET_EFFECTS_JS = `
  /* A bolt: a jagged polyline between two points, forked once. */
  function bolt(x0, y0, x1, y1, seed, colour, lw, alpha) {
    ctx.strokeStyle = rgba(colour, alpha); ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y0);
    var n = 9;
    for (var i = 1; i < n; i++) {
      var f = i / n, nx = -(y1 - y0), ny = x1 - x0, len = Math.sqrt(nx * nx + ny * ny) || 1;
      var off = (hash(i * 3 + seed) - 0.5) * len * 0.16;
      ctx.lineTo(x0 + (x1 - x0) * f + nx / len * off, y0 + (y1 - y0) * f + ny / len * off);
    }
    ctx.lineTo(x1, y1); ctx.stroke();
  }
  /* A leaf shape pointing along angle a. */
  function leaf(x, y, r, a, colour) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.fillStyle = colour;
    ctx.beginPath(); ctx.moveTo(0, -r); ctx.quadraticCurveTo(r * 0.8, -r * 0.2, 0, r); ctx.quadraticCurveTo(-r * 0.8, -r * 0.2, 0, -r); ctx.fill();
    ctx.restore();
  }
  var MORE_EFFECTS = {
    // --- Fire and flames
    'campfire': function (W, H) {
      ctx.lineCap = 'round'; ctx.lineWidth = W * 0.045; ctx.strokeStyle = '#6b4226';
      ctx.beginPath(); ctx.moveTo(W * 0.28, H * 0.9); ctx.lineTo(W * 0.72, H * 0.78); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(W * 0.72, H * 0.9); ctx.lineTo(W * 0.28, H * 0.78); ctx.stroke();
      flame(W * 0.5, H * 0.8, H * 0.5, W * 0.2, 0.7, 1);
      flame(W * 0.42, H * 0.82, H * 0.32, W * 0.11, 2.9, 0.8);
      flame(W * 0.58, H * 0.82, H * 0.36, W * 0.12, 4.1, 0.8);
      for (var i = 0; i < 12; i++) {
        var f = ((hash(i) + P * (0.5 + hash(i + 5) * 0.4)) % 1);
        blob(W * 0.5 + Math.sin(f * 6 + i) * W * 0.12, H * (0.6 - f * 0.55), W * 0.008, '255,170,70', (1 - f) * 0.9);
      }
    },
    'match-flare': function (W, H) {
      ctx.lineCap = 'round'; ctx.lineWidth = W * 0.035; ctx.strokeStyle = '#d9b98a';
      ctx.beginPath(); ctx.moveTo(W * 0.5, H * 0.95); ctx.lineTo(W * 0.5, H * 0.55); ctx.stroke();
      blob(W * 0.5, H * 0.53, W * 0.045, '120,40,30', 1);
      var k = P < 0.25 ? P / 0.25 : 1 - (P - 0.25) / 0.75 * 0.55;
      blob(W * 0.5, H * 0.5, W * (0.05 + 0.35 * k * (P < 0.3 ? 1 : 0.35)), '255,200,120', 0.5 * k);
      flame(W * 0.5, H * 0.56, H * (0.12 + 0.3 * k), W * (0.05 + 0.06 * k), 1.1, 0.6 + 0.4 * k);
    },
    'fireball': function (W, H) {
      for (var i = 0; i < 14; i++) {
        var f = i / 14;
        blob(W * (0.7 - f * 0.6), H / 2 + Math.sin(f * 7 + P * 6) * H * 0.08 * f, H * (0.22 - f * 0.17), f < 0.3 ? '255,230,150' : '255,120,30', (1 - f) * 0.7);
      }
      blob(W * 0.7, H / 2, H * 0.2, '255,250,230', 0.85);
    },
    'flame-burst': function (W, H) {
      for (var i = 0; i < 9; i++) {
        var x = W * (0.1 + i * 0.1);
        flame(x, H * 0.95, H * (0.45 + hash(i) * 0.4), W * (0.05 + hash(i + 3) * 0.03), i * 1.7, 0.9);
      }
    },
    // --- Smoke and steam
    'smoke-puff': function (W, H) {
      var f = P;
      for (var i = 0; i < 9; i++) {
        var a = (i / 9) * Math.PI * 2;
        var d = W * 0.3 * f * (0.5 + hash(i) * 0.7);
        puff(W / 2 + Math.cos(a) * d, H * 0.6 - f * H * 0.25 + Math.sin(a) * d * 0.6, W * (0.08 + f * 0.1), (1 - f) * 0.5, '190,190,195');
      }
    },
    'smoke-trail': function (W, H) {
      for (var i = 0; i < 16; i++) {
        var f = i / 16;
        puff(W * (0.1 + f * 0.8), H * (0.75 - f * 0.45) + Math.sin(f * 8) * H * 0.06, H * (0.05 + f * 0.14), (1 - f * 0.7) * 0.45, '200,200,205');
      }
    },
    'fog-patch': function (W, H) {
      for (var i = 0; i < 18; i++) {
        var f = ((hash(i) + P * 0.25) % 1);
        puff(W * (f * 1.2 - 0.1), H * (0.7 + hash(i + 9) * 0.25), W * (0.08 + hash(i + 2) * 0.1), 0.3, '210,215,225');
      }
    },
    'smoke-ring': function (W, H) {
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(1, 0.45);
      for (var i = 0; i < 24; i++) {
        var a = (i / 24) * Math.PI * 2;
        blob(Math.cos(a) * W * 0.28, Math.sin(a) * W * 0.28, W * 0.09, '200,200,205', 0.35);
      }
      ctx.restore();
    },
    // --- Sparks and embers
    'welding-sparks': function (W, H) {
      blob(W * 0.3, H * 0.5, W * 0.03, '255,255,255', 0.9);
      blob(W * 0.3, H * 0.5, W * 0.1, '180,220,255', 0.3 + 0.2 * Math.sin(P * Math.PI * 12));
      for (var i = 0; i < 80; i++) {
        var f = ((hash(i) + P * (1.2 + hash(i + 7))) % 1);
        var a = (hash(i + 30) - 0.5) * 1.6;
        var sp = W * (0.3 + hash(i + 60) * 0.5);
        var x = W * 0.3 + Math.cos(a) * sp * f, y = H * 0.5 + Math.sin(a) * sp * f + H * 0.8 * f * f;
        blob(x, y, W * 0.005, '255,230,140', (1 - f) * 0.95);
      }
    },
    'sparkler': function (W, H) {
      ctx.lineCap = 'round'; ctx.lineWidth = W * 0.012; ctx.strokeStyle = '#9a9aa0';
      ctx.beginPath(); ctx.moveTo(W / 2, H * 0.95); ctx.lineTo(W / 2, H * 0.45); ctx.stroke();
      blob(W / 2, H * 0.42, W * 0.08, '255,250,220', 0.9);
      for (var i = 0; i < 70; i++) {
        var f = ((hash(i) + P * (2 + hash(i + 3) * 2)) % 1);
        var a = hash(i + 10) * Math.PI * 2;
        var r = W * 0.3 * f;
        ctx.strokeStyle = rgba('255,240,180', (1 - f) * 0.9); ctx.lineWidth = Math.max(1, W * 0.004);
        ctx.beginPath(); ctx.moveTo(W / 2 + Math.cos(a) * r * 0.85, H * 0.42 + Math.sin(a) * r * 0.85); ctx.lineTo(W / 2 + Math.cos(a) * r, H * 0.42 + Math.sin(a) * r); ctx.stroke();
      }
    },
    'firework-burst': function (W, H) {
      var f = P;
      for (var i = 0; i < 48; i++) {
        var a = (i / 48) * Math.PI * 2 + hash(i) * 0.1;
        var r = W * 0.42 * Math.sqrt(f);
        var x = W / 2 + Math.cos(a) * r, y = H * 0.45 + Math.sin(a) * r + H * 0.3 * f * f;
        blob(x, y, W * 0.012 * (1 - f * 0.5), i % 2 ? '255,120,120' : '120,160,255', (1 - f) * 0.95);
        ctx.strokeStyle = rgba(i % 2 ? '255,120,120' : '120,160,255', (1 - f) * 0.4); ctx.lineWidth = Math.max(1, W * 0.004);
        ctx.beginPath(); ctx.moveTo(W / 2 + Math.cos(a) * r * 0.75, H * 0.45 + Math.sin(a) * r * 0.75 + H * 0.3 * f * f * 0.6); ctx.lineTo(x, y); ctx.stroke();
      }
      blob(W / 2, H * 0.45, W * 0.12 * (1 - f), '255,255,230', (1 - f) * 0.8);
    },
    'electric-arc': function (W, H) {
      blob(W * 0.15, H / 2, W * 0.04, '200,230,255', 0.9); blob(W * 0.85, H / 2, W * 0.04, '200,230,255', 0.9);
      bolt(W * 0.15, H / 2, W * 0.85, H / 2, 1, '120,190,255', W * 0.012, 0.5);
      bolt(W * 0.15, H / 2, W * 0.85, H / 2, 1, '230,245,255', W * 0.004, 1);
      bolt(W * 0.15, H / 2, W * 0.85, H / 2, 7, '160,210,255', W * 0.003, 0.7);
    },
    // --- Explosions and impacts
    'fireball-blast': function (W, H) {
      var f = P;
      for (var i = 0; i < 16; i++) {
        var a = (i / 16) * Math.PI * 2;
        var d = W * 0.3 * f * (0.5 + hash(i) * 0.6);
        var hot = f < 0.4;
        puff(W / 2 + Math.cos(a) * d, H * 0.6 - f * H * 0.2 + Math.sin(a) * d * 0.7, W * (0.08 + f * 0.1), (1 - f) * 0.6, hot ? '255,160,60' : '110,90,80');
      }
      blob(W / 2, H * 0.6 - f * H * 0.15, W * 0.25 * (1 - f * 0.6), '255,240,180', (1 - f) * 0.8);
    },
    'debris-scatter': function (W, H) {
      ctx.fillStyle = '#5a5048';
      for (var i = 0; i < 40; i++) {
        var a = -Math.PI / 2 + (hash(i) - 0.5) * 2.6, d = W * (0.08 + hash(i + 9) * 0.4);
        var x = W / 2 + Math.cos(a) * d, y = H * 0.7 + Math.sin(a) * d * 0.8;
        ctx.save(); ctx.translate(x, y); ctx.rotate(hash(i + 3) * 6);
        ctx.fillRect(-W * 0.012, -W * 0.008, W * 0.024 * (0.5 + hash(i + 5)), W * 0.016);
        ctx.restore();
      }
      puff(W / 2, H * 0.72, W * 0.1, 0.5, '150,135,120');
    },
    'energy-burst': function (W, H) {
      var f = P;
      for (var i = 0; i < 18; i++) {
        var a = (i / 18) * Math.PI * 2 + hash(i) * 0.3;
        var d = W * 0.45 * f;
        ctx.save(); ctx.translate(W / 2 + Math.cos(a) * d, H / 2 + Math.sin(a) * d); ctx.rotate(a);
        ctx.fillStyle = rgba(i % 3 ? '120,230,255' : '255,255,255', 1 - f);
        ctx.beginPath(); ctx.moveTo(-W * 0.03, 0); ctx.lineTo(0, -W * 0.012); ctx.lineTo(W * 0.05, 0); ctx.lineTo(0, W * 0.012); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      blob(W / 2, H / 2, W * 0.2 * (1 - f * 0.5), '160,240,255', (1 - f) * 0.8);
    },
    'starburst-flash': function (W, H) {
      for (var i = 0; i < 16; i++) {
        var a = (i / 16) * Math.PI * 2, r = W * (i % 2 ? 0.25 : 0.45);
        ctx.strokeStyle = rgba('255,250,230', 0.9); ctx.lineWidth = W * 0.012; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(W / 2 + Math.cos(a) * W * 0.06, H / 2 + Math.sin(a) * W * 0.06); ctx.lineTo(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r); ctx.stroke();
      }
      blob(W / 2, H / 2, W * 0.22, '255,245,200', 0.85);
    },
    // --- Energy and magic
    'portal-ring': function (W, H) {
      var r = W * 0.34;
      blob(W / 2, H / 2, r * 0.9, '120,60,220', 0.35);
      for (var k = 0; k < 3; k++) {
        ctx.strokeStyle = rgba(k ? '200,160,255' : '255,240,255', 0.8 - k * 0.2); ctx.lineWidth = W * (0.02 - k * 0.005);
        ctx.beginPath(); ctx.arc(W / 2, H / 2, r - k * W * 0.04, 0, Math.PI * 2); ctx.stroke();
      }
      for (var i = 0; i < 14; i++) {
        var a = P * Math.PI * 2 * (i % 2 ? 1 : -1) + (i / 14) * Math.PI * 2;
        blob(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r, W * 0.02, '255,230,255', 0.9);
      }
    },
    'plasma-beam': function (W, H) {
      var g = ctx.createLinearGradient(0, H * 0.4, 0, H * 0.6);
      g.addColorStop(0, rgba('120,80,255', 0)); g.addColorStop(0.5, rgba('180,140,255', 0.8)); g.addColorStop(1, rgba('120,80,255', 0));
      ctx.fillStyle = g; ctx.fillRect(0, H * 0.4, W, H * 0.2);
      ctx.fillStyle = rgba('255,255,255', 0.95); ctx.fillRect(0, H * 0.485, W, H * 0.03);
      bolt(0, H / 2, W, H / 2, 3, '230,220,255', W * 0.004, 0.8);
      blob(W * 0.12, H / 2, H * 0.3, '200,170,255', 0.6);
    },
    'glow-pulse': function (W, H) {
      for (var k = 0; k < 3; k++) {
        var f = (P + k / 3) % 1;
        ctx.strokeStyle = rgba('120,255,200', (1 - f) * 0.8); ctx.lineWidth = W * 0.02 * (1 - f) + 1;
        ctx.beginPath(); ctx.arc(W / 2, H / 2, W * 0.08 + W * 0.4 * f, 0, Math.PI * 2); ctx.stroke();
      }
      blob(W / 2, H / 2, W * 0.12, '180,255,220', 0.9);
    },
    'magic-bolt': function (W, H) {
      bolt(W * 0.05, H * 0.55, W * 0.95, H * 0.45, 5, '255,120,220', W * 0.03, 0.4);
      bolt(W * 0.05, H * 0.55, W * 0.95, H * 0.45, 5, '255,220,250', W * 0.008, 1);
      for (var i = 0; i < 20; i++) blob(W * hash(i), H * (0.3 + hash(i + 4) * 0.4), W * 0.008, '255,200,255', 0.8);
    },
    // --- Light and flares
    'light-rays': function (W, H) {
      for (var i = 0; i < 9; i++) {
        var a = Math.PI / 2 + (i - 4) * 0.17 + Math.sin(P * Math.PI * 2 + i) * 0.03;
        var w = 0.04 + hash(i) * 0.05;
        ctx.fillStyle = rgba('255,245,200', 0.18 + 0.1 * Math.sin(P * Math.PI * 2 * 2 + i));
        ctx.beginPath(); ctx.moveTo(W / 2, -H * 0.2);
        ctx.lineTo(W / 2 + Math.cos(a - w) * H * 1.6, -H * 0.2 + Math.sin(a - w) * H * 1.6);
        ctx.lineTo(W / 2 + Math.cos(a + w) * H * 1.6, -H * 0.2 + Math.sin(a + w) * H * 1.6); ctx.closePath(); ctx.fill();
      }
      blob(W / 2, 0, H * 0.5, '255,250,220', 0.5);
    },
    'neon-flicker': function (W, H) {
      var on = (hash(Math.floor(P * 24)) > 0.2 || P > 0.5) ? 1 : 0.3;
      ctx.lineCap = 'round'; ctx.lineWidth = H * 0.05; ctx.strokeStyle = rgba('255,80,180', 0.35 * on);
      ctx.beginPath(); ctx.moveTo(W * 0.1, H / 2); ctx.lineTo(W * 0.9, H / 2); ctx.stroke();
      ctx.lineWidth = H * 0.018; ctx.strokeStyle = rgba('255,230,250', on);
      ctx.beginPath(); ctx.moveTo(W * 0.1, H / 2); ctx.lineTo(W * 0.9, H / 2); ctx.stroke();
      var g = ctx.createLinearGradient(0, H * 0.3, 0, H * 0.7);
      g.addColorStop(0, rgba('255,80,180', 0)); g.addColorStop(0.5, rgba('255,80,180', 0.25 * on)); g.addColorStop(1, rgba('255,80,180', 0));
      ctx.fillStyle = g; ctx.fillRect(W * 0.08, H * 0.3, W * 0.84, H * 0.4);
    },
    'bokeh-cluster': function (W, H) {
      var cols = ['255,220,160', '255,160,200', '160,200,255', '200,255,200'];
      for (var i = 0; i < 26; i++) {
        var x = W * (0.1 + hash(i) * 0.8), y = H * (0.1 + hash(i + 7) * 0.8), r = H * (0.04 + hash(i + 3) * 0.08);
        var g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rgba(cols[i % 4], 0.35)); g.addColorStop(0.85, rgba(cols[i % 4], 0.25)); g.addColorStop(1, rgba(cols[i % 4], 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
    },
    'flashlight-beam': function (W, H) {
      var g = ctx.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, rgba('255,250,230', 0.9)); g.addColorStop(1, rgba('255,250,230', 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(0, H * 0.45); ctx.lineTo(W, H * 0.05); ctx.lineTo(W, H * 0.95); ctx.lineTo(0, H * 0.55); ctx.closePath(); ctx.fill();
      blob(0, H / 2, H * 0.3, '255,255,240', 0.9);
    },
    // --- Weather effects
    'rain-cloud': function (W, H) {
      puff(W * 0.5, H * 0.32, W * 0.2, 1.6, '225,230,240');
      blob(W * 0.36, H * 0.34, W * 0.14, '225,230,240', 1); blob(W * 0.64, H * 0.34, W * 0.14, '225,230,240', 1); blob(W * 0.5, H * 0.26, W * 0.17, '235,240,248', 1);
      ctx.strokeStyle = rgba('150,190,240', 0.8); ctx.lineWidth = W * 0.012; ctx.lineCap = 'round';
      for (var i = 0; i < 14; i++) {
        var f = ((hash(i) + P * 1.5) % 1);
        var x = W * (0.3 + hash(i + 5) * 0.4), y = H * (0.48 + f * 0.45);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - W * 0.01, y + H * 0.06); ctx.stroke();
      }
    },
    'falling-leaves': function (W, H) {
      var cols = ['#d9742b', '#c94c2b', '#e0a83a', '#8f5a2b'];
      for (var i = 0; i < 22; i++) {
        var f = ((hash(i) + P * (0.4 + hash(i + 3) * 0.3)) % 1);
        var x = W * hash(i + 9) + Math.sin(f * 5 + i) * W * 0.06, y = H * (f * 1.2 - 0.1);
        leaf(x, y, H * 0.05, f * 9 + i, cols[i % 4]);
      }
    },
    'hail': function (W, H) {
      for (var i = 0; i < 60; i++) {
        var x = W * hash(i), y = H * hash(i + 7), r = W * (0.006 + hash(i + 3) * 0.008);
        ctx.fillStyle = rgba('235,245,255', 0.9); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = rgba('220,235,255', 0.5); ctx.lineWidth = r * 0.8;
        ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + W * 0.008, y - H * 0.08); ctx.stroke();
      }
    },
    'drifting-cloud': function (W, H) {
      var cx = W * 0.5, cy = H * 0.55;
      blob(cx, cy, W * 0.3, '240,244,250', 0.4);
      ctx.fillStyle = '#f4f7fb';
      ctx.beginPath(); ctx.arc(cx - W * 0.18, cy, H * 0.17, 0, Math.PI * 2); ctx.arc(cx - W * 0.04, cy - H * 0.12, H * 0.22, 0, Math.PI * 2); ctx.arc(cx + W * 0.14, cy - H * 0.02, H * 0.19, 0, Math.PI * 2); ctx.arc(cx + W * 0.24, cy + H * 0.06, H * 0.13, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx - W * 0.18, cy, W * 0.42, H * 0.17);
      ctx.fillStyle = rgba('200,210,225', 0.5); ctx.fillRect(cx - W * 0.18, cy + H * 0.12, W * 0.42, H * 0.05);
    },
    // --- Liquids and splashes
    'paint-splash': function (W, H) {
      ctx.fillStyle = '#ff5a8a';
      ctx.beginPath(); ctx.arc(W / 2, H / 2, W * 0.2, 0, Math.PI * 2); ctx.fill();
      for (var i = 0; i < 26; i++) {
        var a = (i / 26) * Math.PI * 2 + hash(i), d = W * (0.22 + hash(i + 7) * 0.22), r = W * (0.01 + hash(i + 3) * 0.035);
        ctx.beginPath(); ctx.arc(W / 2 + Math.cos(a) * d, H / 2 + Math.sin(a) * d, r, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = r * 0.9; ctx.strokeStyle = '#ff5a8a';
        ctx.beginPath(); ctx.moveTo(W / 2 + Math.cos(a) * W * 0.18, H / 2 + Math.sin(a) * W * 0.18); ctx.lineTo(W / 2 + Math.cos(a) * d * 0.9, H / 2 + Math.sin(a) * d * 0.9); ctx.stroke();
      }
    },
    'drip': function (W, H) {
      var f = P;
      var col = '140,200,245';
      if (f < 0.4) { var g2 = f / 0.4; blob(W / 2, H * 0.12 + H * 0.03 * g2, W * (0.02 + 0.03 * g2), col, 0.95); }
      else if (f < 0.7) { var g3 = (f - 0.4) / 0.3; blob(W / 2, H * 0.15 + H * 0.65 * g3 * g3, W * 0.045, col, 0.95); }
      else {
        var g4 = (f - 0.7) / 0.3;
        ctx.save(); ctx.translate(W / 2, H * 0.82); ctx.scale(1, 0.3);
        ctx.strokeStyle = rgba(col, (1 - g4) * 0.9); ctx.lineWidth = W * 0.015;
        for (var k = 0; k < 2; k++) { ctx.beginPath(); ctx.arc(0, 0, W * (0.06 + 0.3 * g4) * (1 - k * 0.4), 0, Math.PI * 2); ctx.stroke(); }
        ctx.restore();
      }
    },
    'rising-bubbles': function (W, H) {
      for (var i = 0; i < 22; i++) {
        var f = ((hash(i) + P * (0.3 + hash(i + 5) * 0.3)) % 1);
        var x = W * (0.2 + hash(i + 9) * 0.6) + Math.sin(f * 6 + i) * W * 0.04, y = H * (1.05 - f * 1.1), r = W * (0.015 + hash(i + 3) * 0.035);
        ctx.strokeStyle = rgba('200,235,255', 0.85); ctx.lineWidth = Math.max(1, r * 0.18);
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
        blob(x - r * 0.35, y - r * 0.35, r * 0.35, '255,255,255', 0.7);
      }
    },
    'pouring-stream': function (W, H) {
      var g = ctx.createLinearGradient(W * 0.42, 0, W * 0.58, 0);
      g.addColorStop(0, rgba('140,200,245', 0.5)); g.addColorStop(0.5, rgba('200,235,255', 0.95)); g.addColorStop(1, rgba('140,200,245', 0.5));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(W * 0.4, 0); ctx.lineTo(W * 0.6, 0); ctx.lineTo(W * 0.55, H * 0.8); ctx.lineTo(W * 0.45, H * 0.8); ctx.closePath(); ctx.fill();
      ctx.save(); ctx.translate(W / 2, H * 0.82); ctx.scale(1, 0.35);
      for (var k = 0; k < 3; k++) { ctx.strokeStyle = rgba('170,220,250', 0.8 - k * 0.25); ctx.lineWidth = W * 0.015; ctx.beginPath(); ctx.arc(0, 0, W * (0.08 + k * 0.1), 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore();
      for (var i = 0; i < 10; i++) blob(W / 2 + (hash(i) - 0.5) * W * 0.5, H * (0.72 + hash(i + 3) * 0.12), W * 0.012, '200,235,255', 0.9);
    },
    // --- Confetti and celebration
    'balloon-release': function (W, H) {
      var cols = ['#ff5a7a', '#ffc53d', '#4fd1a5', '#5aa9ff', '#c678ff'];
      for (var i = 0; i < 9; i++) {
        var f = P * (0.7 + hash(i) * 0.5);
        var x = W * (0.15 + hash(i + 3) * 0.7) + Math.sin(P * 5 + i) * W * 0.03, y = H * (1.1 - f * 1.1);
        ctx.strokeStyle = rgba('90,90,100', 0.7); ctx.lineWidth = Math.max(1, W * 0.003);
        ctx.beginPath(); ctx.moveTo(x, y + W * 0.08); ctx.quadraticCurveTo(x + W * 0.03, y + W * 0.16, x, y + W * 0.26); ctx.stroke();
        ctx.fillStyle = cols[i % 5];
        ctx.beginPath(); ctx.ellipse(x, y, W * 0.06, W * 0.075, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x - W * 0.012, y + W * 0.085); ctx.lineTo(x + W * 0.012, y + W * 0.085); ctx.lineTo(x, y + W * 0.07); ctx.fill();
        blob(x - W * 0.02, y - W * 0.03, W * 0.025, '255,255,255', 0.5);
      }
    },
    'streamers': function (W, H) {
      var cols = ['#ff5a7a', '#ffc53d', '#4fd1a5', '#5aa9ff', '#c678ff'];
      ctx.lineCap = 'round'; ctx.lineWidth = H * 0.025;
      for (var i = 0; i < 12; i++) {
        var x = W * (0.05 + i * 0.085);
        ctx.strokeStyle = cols[i % 5];
        ctx.beginPath(); ctx.moveTo(x, 0);
        for (var k = 1; k <= 12; k++) ctx.lineTo(x + Math.sin(k * 1.3 + i) * W * 0.025, H * (k / 12) * (0.5 + hash(i) * 0.5));
        ctx.stroke();
      }
    },
    'petal-shower': function (W, H) {
      for (var i = 0; i < 30; i++) {
        var f = ((hash(i) + P * (0.35 + hash(i + 3) * 0.3)) % 1);
        var x = W * hash(i + 9) + Math.sin(f * 4 + i) * W * 0.05, y = H * (f * 1.2 - 0.1);
        leaf(x, y, H * 0.04, f * 7 + i, i % 2 ? '#ffb3c6' : '#ffd6e0');
      }
    },
    'star-burst': function (W, H) {
      var cols = ['#ffd23d', '#ff7a59', '#5aa9ff', '#4fd1a5'];
      for (var i = 0; i < 18; i++) {
        var a = (i / 18) * Math.PI * 2 + hash(i) * 0.2, d = W * (0.12 + hash(i + 7) * 0.3), r = W * (0.02 + hash(i + 3) * 0.035);
        var x = W / 2 + Math.cos(a) * d, y = H / 2 + Math.sin(a) * d;
        ctx.fillStyle = cols[i % 4]; ctx.beginPath();
        for (var k = 0; k < 10; k++) { var b = -Math.PI / 2 + (k / 10) * Math.PI * 2 + a, rr = k % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.cos(b) * rr, y + Math.sin(b) * rr); }
        ctx.closePath(); ctx.fill();
      }
    },
    // --- Brush and ink strokes
    'ink-scribble': function (W, H) {
      ctx.strokeStyle = rgba('30,34,46', 0.95); ctx.lineWidth = W * 0.014; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      var n = Math.max(2, Math.floor(60 * (P === 0 ? 1 : P)));
      for (var i = 0; i <= n; i++) {
        var t = i / 60;
        var x = W * (0.15 + t * 0.7) + Math.sin(t * 40) * W * 0.06, y = H / 2 + Math.sin(t * 23) * H * 0.22 + Math.cos(t * 9) * H * 0.1;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    },
    'hand-drawn-circle': function (W, H) {
      ctx.strokeStyle = rgba('220,50,60', 0.95); ctx.lineWidth = W * 0.02; ctx.lineCap = 'round';
      ctx.beginPath();
      var end = (P === 0 ? 1 : Math.min(1, P * 1.15)) * Math.PI * 2.3;
      for (var a = 0; a <= end; a += 0.05) {
        var r = W * 0.34 * (1 + Math.sin(a * 1.7) * 0.04) + a * W * 0.006;
        var x = W / 2 + Math.cos(a - Math.PI * 0.7) * r, y = H / 2 + Math.sin(a - Math.PI * 0.7) * r * 0.8;
        if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    },
    'paint-splatter': function (W, H) {
      var cols = ['#2d7ff9', '#ff4f79', '#ffc53d'];
      for (var k = 0; k < 3; k++) {
        ctx.fillStyle = cols[k];
        var cx = W * (0.25 + k * 0.25), cy = H * (0.4 + hash(k) * 0.3);
        ctx.beginPath(); ctx.arc(cx, cy, H * 0.14, 0, Math.PI * 2); ctx.fill();
        for (var i = 0; i < 16; i++) {
          var a = hash(i + k * 20) * Math.PI * 2, d = H * (0.15 + hash(i + k * 20 + 5) * 0.25);
          ctx.beginPath(); ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, H * (0.008 + hash(i + 3) * 0.03), 0, Math.PI * 2); ctx.fill();
        }
      }
    },
    'roller-stroke': function (W, H) {
      ctx.fillStyle = '#2d9c6f';
      ctx.beginPath(); ctx.moveTo(W * 0.08, H * 0.3); ctx.lineTo(W * 0.92, H * 0.28); ctx.lineTo(W * 0.9, H * 0.72); ctx.lineTo(W * 0.1, H * 0.7); ctx.closePath(); ctx.fill();
      for (var i = 0; i < 14; i++) {
        ctx.fillStyle = rgba('40,120,90', 0.35);
        ctx.fillRect(W * 0.1, H * (0.3 + i * 0.03), W * 0.8 * (0.9 + hash(i) * 0.1), H * 0.006);
      }
      for (var k = 0; k < 10; k++) { var y = H * (0.3 + hash(k) * 0.4); ctx.fillStyle = '#2d9c6f'; ctx.fillRect(W * 0.9 + W * 0.02 * hash(k + 3), y, W * 0.02, H * 0.03); }
    }
  };
  Object.keys(MORE_EFFECTS).forEach(function (k) { DRAW[k] = MORE_EFFECTS[k]; });
`;
