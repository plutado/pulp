/**
 * The asset page's milestone 36 batch: the four that take each of the ten
 * Effects categories from six to ten, and the handful that do the same for
 * the thin Objects kinds (travel, home, science, nature). Plain JavaScript
 * for the page's script, spliced in after the earlier batches, so everything
 * here draws with the same vocabulary — `blob`, `flame`, `puff`, `rgba`,
 * `hash` and the object helpers `disc`, `oval`, `box`, `poly`, `line`, `arc`,
 * `shadow`. `P` is the clip's progress (0 at a still), `U` the shorter side.
 */
export const ASSET_TEN_JS = `
  var TEN = {
    // --- Fire and flames
    'gas-ring': function (W, H) {
      var cx = W / 2, cy = H * 0.62, r = W * 0.26;
      for (var i = 0; i < 18; i++) {
        var a = (i / 18) * Math.PI * 2;
        var lick = 1 + Math.sin(P * Math.PI * 2 * 2 + i * 1.3) * 0.25;
        var x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.4;
        blob(x, y - H * 0.02 * lick, W * 0.03, '120,180,255', 0.8);
        blob(x, y - H * 0.055 * lick, W * 0.018, '200,230,255', 0.55);
      }
      ctx.strokeStyle = rgba('40,46,58', 0.9); ctx.lineWidth = W * 0.02;
      ctx.beginPath(); ctx.ellipse(cx, cy + H * 0.015, r * 1.12, r * 0.45, 0, 0, Math.PI * 2); ctx.stroke();
    },
    'oil-lamp': function (W, H) {
      ctx.fillStyle = '#8a6a3a';
      ctx.beginPath(); ctx.ellipse(W / 2, H * 0.78, W * 0.2, H * 0.08, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6e5430'; ctx.fillRect(W * 0.47, H * 0.62, W * 0.06, H * 0.1);
      flame(W / 2, H * 0.62, H * 0.26, W * 0.06, 0.8, 0.9);
      blob(W / 2, H * 0.52, W * 0.3, '255,190,110', 0.22);
    },
    'ember-bed': function (W, H) {
      for (var i = 0; i < 60; i++) {
        var x = W * hash(i * 3), y = H * (0.72 + hash(i * 3 + 1) * 0.22);
        var glow = 0.35 + 0.65 * Math.abs(Math.sin(P * Math.PI * 2 + i * 1.7));
        blob(x, y, W * (0.015 + hash(i * 3 + 2) * 0.03), i % 3 ? '255,120,40' : '255,190,80', glow * 0.8);
      }
      for (var k = 0; k < 8; k++) {
        var f = ((hash(k) + P * (0.4 + hash(k + 9) * 0.3)) % 1);
        blob(W * hash(k + 20), H * (0.75 - f * 0.5), W * 0.006, '255,170,70', (1 - f) * 0.8);
      }
    },
    'fire-swirl': function (W, H) {
      var cx = W / 2, cy = H * 0.6;
      for (var i = 0; i < 40; i++) {
        var f = ((i / 40) + P) % 1;
        var a = f * Math.PI * 4;
        var r = W * 0.05 + f * W * 0.3;
        blob(cx + Math.cos(a) * r, cy - f * H * 0.36 + Math.sin(a) * r * 0.3, W * (0.05 - f * 0.035), f < 0.35 ? '255,220,130' : '255,110,30', (1 - f) * 0.7);
      }
    },
    // --- Smoke and steam
    'chimney-smoke': function (W, H) {
      for (var i = 0; i < 10; i++) {
        var f = ((i / 10) + P) % 1;
        var x = W * 0.35 + f * W * 0.3 + Math.sin(f * 5 + i) * W * 0.06;
        puff(x, H * (0.9 - f * 0.8), W * (0.05 + f * 0.14), (1 - f) * 0.45 * Math.min(1, f * 7), '210,210,215');
      }
    },
    'incense-ribbon': function (W, H) {
      ctx.strokeStyle = rgba('215,215,225', 0.5); ctx.lineCap = 'round';
      for (var pass = 0; pass < 3; pass++) {
        ctx.lineWidth = Math.max(1, W * (0.012 - pass * 0.004));
        ctx.beginPath();
        for (var i = 0; i <= 60; i++) {
          var f = i / 60;
          var x = W / 2 + Math.sin(f * 9 + pass * 0.6) * W * 0.1 * f;
          var y = H * (0.92 - f * 0.84);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      blob(W / 2, H * 0.92, W * 0.02, '255,130,60', 0.9);
    },
    'dust-roll': function (W, H) {
      for (var i = 0; i < 12; i++) {
        var f = Math.min(1, P * 1.2 + hash(i) * 0.1);
        var x = W * 0.1 + f * W * 0.7 + hash(i * 3) * W * 0.16;
        puff(x, H * (0.82 - hash(i * 5) * 0.14), W * (0.06 + f * 0.1) * (0.7 + hash(i) * 0.6), (1 - f * 0.8) * 0.5, '190,175,150');
      }
    },
    'vapor-drift': function (W, H) {
      for (var i = 0; i < 9; i++) {
        var x = W * (0.08 + i * 0.1);
        puff(x, H * (0.4 + Math.sin(i * 1.8) * 0.16), W * (0.09 + hash(i) * 0.05), 0.3, '220,225,235');
      }
    },
    // --- Sparks and embers
    'flint-strike': function (W, H) {
      var k = Math.min(1, P * 4);
      for (var i = 0; i < 30; i++) {
        var a = -Math.PI * 0.25 + (hash(i) - 0.5) * 1.2;
        var d = W * (0.05 + 0.4 * k * hash(i + 9));
        var x = W * 0.3 + Math.cos(a) * d, y = H * 0.7 + Math.sin(a) * d;
        blob(x, y, W * 0.006, '255,220,120', (1 - k * 0.8) * 0.95);
      }
      blob(W * 0.3, H * 0.7, W * 0.05 * (1 - k * 0.6), '255,245,210', 0.8 * (1 - k * 0.5));
    },
    'spark-fountain': function (W, H) {
      for (var i = 0; i < 70; i++) {
        var life = 0.4 + hash(i) * 0.5;
        var f = ((P + hash(i + 31)) % 1);
        if (f > life) continue;
        var t2 = f / life;
        var a = -Math.PI / 2 + (hash(i + 61) - 0.5) * 0.9;
        var sp = H * (0.5 + hash(i + 91) * 0.4);
        var x = W / 2 + Math.cos(a) * sp * t2;
        var y = H * 0.92 + Math.sin(a) * sp * t2 + H * 0.7 * t2 * t2;
        blob(x, y, W * 0.007, '255,210,110', (1 - t2) * 0.95);
      }
    },
    'ember-swirl': function (W, H) {
      var cx = W / 2, cy = H / 2;
      for (var i = 0; i < 36; i++) {
        var f = ((hash(i) + P) % 1);
        var a = f * Math.PI * 2 + i;
        var r = W * (0.08 + f * 0.3);
        blob(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8, W * 0.008, '255,150,60', (1 - Math.abs(f - 0.5) * 2) * 0.9);
      }
    },
    'static-sparks': function (W, H) {
      for (var i = 0; i < 9; i++) {
        var x0 = W * hash(i * 7), y0 = H * hash(i * 7 + 1);
        bolt(x0, y0, x0 + (hash(i * 7 + 2) - 0.5) * W * 0.3, y0 + (hash(i * 7 + 3) - 0.5) * H * 0.3, i * 13, '160,210,255', Math.max(1, W * 0.004), 0.7);
      }
    },
    // --- Explosions and impacts
    'ground-burst': function (W, H) {
      var f = P;
      for (var i = 0; i < 16; i++) {
        var a = -Math.PI / 2 + (hash(i) - 0.5) * 1.5;
        var d = Math.min(W, H) * 0.5 * f * (0.6 + hash(i + 7) * 0.4);
        puff(W / 2 + Math.cos(a) * d, H * 0.85 + Math.sin(a) * d, W * (0.05 + f * 0.06), (1 - f) * 0.7, i % 2 ? '150,120,90' : '110,90,70');
      }
      blob(W / 2, H * 0.85, W * 0.2 * (1 - f * 0.7), '255,190,110', (1 - f) * 0.6);
    },
    'flash-pop': function (W, H) {
      var f = P;
      blob(W / 2, H / 2, Math.min(W, H) * (0.1 + f * 0.45), '255,250,235', Math.max(0, 1 - f * 1.4));
      for (var i = 0; i < 10; i++) {
        var a = (i / 10) * Math.PI * 2;
        var len = Math.min(W, H) * (0.2 + f * 0.35);
        ctx.strokeStyle = rgba('255,240,200', Math.max(0, 1 - f * 1.6));
        ctx.lineWidth = Math.max(1, Math.min(W, H) * 0.01 * (1 - f));
        ctx.beginPath(); ctx.moveTo(W / 2 + Math.cos(a) * len * 0.4, H / 2 + Math.sin(a) * len * 0.4);
        ctx.lineTo(W / 2 + Math.cos(a) * len, H / 2 + Math.sin(a) * len); ctx.stroke();
      }
    },
    'debris-ring': function (W, H) {
      var f = P;
      for (var i = 0; i < 40; i++) {
        var a = (i / 40) * Math.PI * 2 + hash(i) * 0.3;
        var d = Math.min(W, H) * (0.1 + f * 0.42) * (0.85 + hash(i + 5) * 0.3);
        var x = W / 2 + Math.cos(a) * d, y = H / 2 + Math.sin(a) * d * 0.7 + H * 0.3 * f * f;
        ctx.save(); ctx.translate(x, y); ctx.rotate(f * 8 + i);
        ctx.fillStyle = rgba('120,105,85', 1 - f * 0.7);
        ctx.fillRect(-W * 0.008, -W * 0.008, W * 0.016, W * 0.016);
        ctx.restore();
      }
      blob(W / 2, H / 2, W * 0.1 * (1 - f * 0.5), '200,170,130', (1 - f) * 0.5);
    },
    'impact-dust': function (W, H) {
      var f = P;
      for (var side = -1; side <= 1; side += 2) {
        for (var i = 0; i < 8; i++) {
          var d = W * (0.06 + f * 0.36) * (0.7 + hash(i) * 0.5);
          puff(W / 2 + side * d, H * 0.78 - hash(i + 3) * H * 0.08 * f, W * (0.04 + f * 0.05), (1 - f) * 0.6, '175,160,140');
        }
      }
    },
    // --- Energy and magic
    'plasma-orb': function (W, H) {
      var cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.26;
      blob(cx, cy, r * 1.4, '120,160,255', 0.3);
      blob(cx, cy, r * 0.8, '200,220,255', 0.7);
      for (var i = 0; i < 7; i++) {
        var a0 = P * Math.PI * 2 + i;
        bolt(cx + Math.cos(a0) * r * 0.2, cy + Math.sin(a0) * r * 0.2, cx + Math.cos(a0 + 1.2) * r, cy + Math.sin(a0 + 1.2) * r, i * 9 + Math.floor(P * 6), '180,210,255', Math.max(1, W * 0.005), 0.8);
      }
    },
    'power-beam': function (W, H) {
      var y = H / 2;
      var g = ctx.createLinearGradient(0, y - H * 0.12, 0, y + H * 0.12);
      g.addColorStop(0, rgba('120,220,200', 0)); g.addColorStop(0.5, rgba('190,255,240', 0.85)); g.addColorStop(1, rgba('120,220,200', 0));
      ctx.fillStyle = g; ctx.fillRect(0, y - H * 0.12, W, H * 0.24);
      for (var i = 0; i < 14; i++) {
        var f = ((hash(i) + P) % 1);
        blob(W * f, y + Math.sin(f * 9 + i) * H * 0.08, W * 0.008, '210,255,245', 0.8);
      }
    },
    'rune-circle': function (W, H) {
      var cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.3;
      ctx.strokeStyle = rgba('190,150,255', 0.85); ctx.lineWidth = Math.max(1, W * 0.008);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(P * Math.PI * 2);
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r * 0.76, 0, Math.PI * 2); ctx.stroke();
      for (var i = 0; i < 8; i++) {
        var a = (i / 8) * Math.PI * 2;
        ctx.save(); ctx.translate(Math.cos(a) * r * 0.88, Math.sin(a) * r * 0.88); ctx.rotate(a + i);
        ctx.strokeRect(-r * 0.045, -r * 0.045, r * 0.09, r * 0.09);
        ctx.restore();
      }
      ctx.restore();
      blob(cx, cy, r * 0.5, '170,120,255', 0.25 + 0.1 * Math.sin(P * Math.PI * 2 * 2));
    },
    'charge-up': function (W, H) {
      var f = P, cx = W / 2, cy = H / 2;
      for (var i = 0; i < 26; i++) {
        var a = hash(i) * Math.PI * 2;
        var d = Math.min(W, H) * 0.45 * (1 - ((f + hash(i + 7)) % 1));
        blob(cx + Math.cos(a) * d, cy + Math.sin(a) * d, W * 0.01, '150,230,255', 0.8);
      }
      blob(cx, cy, Math.min(W, H) * (0.08 + f * 0.14), '220,250,255', 0.5 + f * 0.4);
    },
    // --- Light
    'light-leak-sweep': function (W, H) {
      var g = ctx.createLinearGradient(0, 0, W, H * 0.4);
      g.addColorStop(0, rgba('255,140,90', 0.55)); g.addColorStop(0.5, rgba('255,200,120', 0.2)); g.addColorStop(1, rgba('255,140,90', 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      blob(W * 0.12, H * 0.2, W * 0.3, '255,170,110', 0.5);
      blob(W * 0.85, H * 0.75, W * 0.24, '255,120,140', 0.3);
    },
    'projector-cone': function (W, H) {
      var g = ctx.createLinearGradient(0, 0, W, 0);
      ctx.beginPath(); ctx.moveTo(W * 0.04, H * 0.3);
      ctx.lineTo(W * 0.96, H * 0.08); ctx.lineTo(W * 0.96, H * 0.92); ctx.lineTo(W * 0.04, H * 0.42); ctx.closePath();
      g.addColorStop(0, rgba('235,240,255', 0.75)); g.addColorStop(1, rgba('235,240,255', 0.08));
      ctx.fillStyle = g; ctx.fill();
      for (var i = 0; i < 24; i++) blob(W * (0.1 + hash(i) * 0.8), H * (0.2 + hash(i + 7) * 0.6), W * 0.004, '245,248,255', 0.5);
      blob(W * 0.05, H * 0.36, W * 0.05, '255,255,255', 0.9);
    },
    'flare-streak': function (W, H) {
      var y = H / 2;
      var g = ctx.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, rgba('140,180,255', 0)); g.addColorStop(0.5, rgba('220,235,255', 0.8)); g.addColorStop(1, rgba('140,180,255', 0));
      ctx.fillStyle = g; ctx.fillRect(0, y - Math.max(1, H * 0.012), W, Math.max(2, H * 0.024));
      blob(W * 0.5, y, Math.min(W, H) * 0.16, '220,235,255', 0.8);
      for (var i = 0; i < 5; i++) {
        var f = 0.14 + i * 0.17;
        blob(W * f, y, Math.min(W, H) * (0.02 + hash(i) * 0.05), i % 2 ? '255,200,150' : '160,200,255', 0.3);
      }
    },
    'spot-sweep': function (W, H) {
      var a = -Math.PI / 2 + Math.sin(P * Math.PI * 2) * 0.5;
      ctx.save(); ctx.translate(W / 2, H * 0.98); ctx.rotate(a);
      var g = ctx.createLinearGradient(0, 0, 0, -H * 1.1);
      g.addColorStop(0, rgba('255,245,210', 0.8)); g.addColorStop(1, rgba('255,245,210', 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-W * 0.14, -H * 1.1); ctx.lineTo(W * 0.14, -H * 1.1); ctx.closePath(); ctx.fill();
      ctx.restore();
      blob(W / 2, H * 0.97, W * 0.05, '255,255,240', 0.9);
    },
    // --- Weather
    'rain-streaks': function (W, H) {
      ctx.strokeStyle = rgba('180,205,235', 0.6); ctx.lineCap = 'round';
      for (var i = 0; i < 80; i++) {
        var f = ((hash(i) + P * (0.9 + hash(i + 3) * 0.3)) % 1);
        var x = W * hash(i + 11) - f * W * 0.06;
        var y = f * H * 1.1 - H * 0.05;
        var len = H * (0.04 + hash(i + 17) * 0.05);
        ctx.lineWidth = Math.max(1, W * 0.0035 * (0.6 + hash(i + 23)));
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - len * 0.12, y + len); ctx.stroke();
      }
    },
    'snow-settle': function (W, H) {
      for (var i = 0; i < 90; i++) {
        var f = ((hash(i) + P * (0.3 + hash(i + 7) * 0.3)) % 1);
        var x = W * hash(i + 13) + Math.sin(f * 7 + i) * W * 0.03;
        blob(x, f * H, Math.max(1, W * (0.004 + hash(i + 19) * 0.006)), '250,252,255', 0.9 - f * 0.3);
      }
      var g = ctx.createLinearGradient(0, H * 0.9, 0, H);
      g.addColorStop(0, rgba('245,250,255', 0)); g.addColorStop(1, rgba('245,250,255', 0.8));
      ctx.fillStyle = g; ctx.fillRect(0, H * 0.9, W, H * 0.1);
    },
    'lightning-flash': function (W, H) {
      var k = P < 0.2 ? P / 0.2 : Math.max(0, 1 - (P - 0.2) / 0.5);
      ctx.fillStyle = rgba('225,235,255', 0.25 * k); ctx.fillRect(0, 0, W, H);
      bolt(W * 0.5, 0, W * (0.4 + hash(Math.floor(P * 3)) * 0.2), H * 0.85, 3 + Math.floor(P * 3), '235,242,255', Math.max(2, W * 0.012), 0.95 * Math.max(0.15, k));
      bolt(W * 0.47, H * 0.4, W * 0.3, H * 0.7, 11, '235,242,255', Math.max(1, W * 0.006), 0.7 * k);
    },
    'sun-shafts': function (W, H) {
      var g = ctx.createRadialGradient(W * 0.5, -H * 0.1, 0, W * 0.5, -H * 0.1, H * 1.2);
      g.addColorStop(0, rgba('255,240,200', 0.5)); g.addColorStop(1, rgba('255,240,200', 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      for (var i = 0; i < 6; i++) {
        var x0 = W * (0.1 + i * 0.16);
        ctx.fillStyle = rgba('255,246,214', 0.16 + hash(i) * 0.1);
        ctx.beginPath();
        ctx.moveTo(x0, 0); ctx.lineTo(x0 + W * 0.05, 0);
        ctx.lineTo(x0 + W * 0.18, H); ctx.lineTo(x0 + W * 0.06, H);
        ctx.closePath(); ctx.fill();
      }
    },
    // --- Liquid
    'ripple-rings': function (W, H) {
      var cx = W / 2, cy = H * 0.55;
      for (var i = 0; i < 4; i++) {
        var f = Math.min(1, Math.max(0, P - i * 0.16) * 1.4);
        if (f <= 0) continue;
        ctx.strokeStyle = rgba('170,215,240', (1 - f) * 0.85);
        ctx.lineWidth = Math.max(1, W * 0.012 * (1 - f));
        ctx.beginPath(); ctx.ellipse(cx, cy, W * 0.42 * f, W * 0.16 * f, 0, 0, Math.PI * 2); ctx.stroke();
      }
      blob(cx, cy, W * 0.03 * Math.max(0, 1 - P * 2), '200,235,250', 0.8);
    },
    'bubble-column': function (W, H) {
      for (var i = 0; i < 26; i++) {
        var f = ((hash(i) + P * (0.5 + hash(i + 9) * 0.4)) % 1);
        var x = W / 2 + Math.sin(f * 8 + i) * W * 0.12 * f + (hash(i + 17) - 0.5) * W * 0.16;
        var r = W * (0.01 + hash(i + 23) * 0.025) * (0.6 + f * 0.6);
        ctx.strokeStyle = rgba('185,225,245', (1 - f * 0.5) * 0.85); ctx.lineWidth = Math.max(1, r * 0.3);
        ctx.beginPath(); ctx.arc(x, H * (1 - f), r, 0, Math.PI * 2); ctx.stroke();
        blob(x - r * 0.3, H * (1 - f) - r * 0.3, r * 0.3, '240,250,255', 0.7);
      }
    },
    'splash-crown': function (W, H) {
      var f = P, cy = H * 0.72;
      for (var i = 0; i < 12; i++) {
        var a = -Math.PI / 2 + (i / 11 - 0.5) * 1.8;
        var d = W * 0.3 * f;
        var x = W / 2 + Math.cos(a) * d, y = cy + Math.sin(a) * d + H * 0.5 * f * f;
        blob(x, y, W * (0.025 - f * 0.012), '190,225,245', (1 - f) * 0.9);
        blob(x, y - W * 0.02, W * 0.01, '235,248,255', (1 - f) * 0.8);
      }
      ctx.strokeStyle = rgba('190,225,245', (1 - f) * 0.7); ctx.lineWidth = Math.max(1, W * 0.014 * (1 - f));
      ctx.beginPath(); ctx.ellipse(W / 2, cy, W * 0.16 * (0.4 + f), W * 0.05 * (0.4 + f), 0, 0, Math.PI * 2); ctx.stroke();
    },
    'wave-lap': function (W, H) {
      var ph = P * Math.PI * 2;
      for (var row = 0; row < 3; row++) {
        ctx.fillStyle = rgba(['70,140,185', '95,165,205', '130,195,225'][row], 0.85);
        ctx.beginPath(); ctx.moveTo(0, H);
        for (var x = 0; x <= W; x += W / 50) {
          ctx.lineTo(x, H * (0.5 + row * 0.16) + Math.sin(x / W * 6 + ph * (row % 2 ? 1 : -1) + row * 2) * H * 0.05);
        }
        ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
      }
      for (var c = 0; c < 8; c++) {
        var cx2 = ((hash(c) + P * 0.15) % 1) * W;
        blob(cx2, H * 0.5 + Math.sin(cx2 / W * 6 + ph) * H * 0.05, W * 0.012, '235,248,255', 0.6);
      }
    },
    // --- Confetti and celebration
    'streamer-fall': function (W, H) {
      var cols = ['244,96,120', '250,200,70', '90,200,160', '120,160,250'];
      for (var i = 0; i < 16; i++) {
        var f = ((hash(i) + P * (0.3 + hash(i + 5) * 0.2)) % 1);
        var x = W * hash(i + 11);
        ctx.strokeStyle = rgba(cols[i % 4], 0.9); ctx.lineWidth = Math.max(2, W * 0.012); ctx.lineCap = 'round';
        ctx.beginPath();
        for (var k = 0; k <= 14; k++) {
          var g2 = k / 14;
          var y = (f + g2 * 0.22 - 0.22) * H * 1.3;
          var sx = x + Math.sin(g2 * 9 + f * 12 + i) * W * 0.03;
          if (k === 0) ctx.moveTo(sx, y); else ctx.lineTo(sx, y);
        }
        ctx.stroke();
      }
    },
    'confetti-cannon': function (W, H) {
      var cols = ['244,96,120', '250,200,70', '90,200,160', '120,160,250', '230,140,230'];
      for (var i = 0; i < 80; i++) {
        var f = P;
        var a = -0.5 - hash(i) * 0.7;
        var sp = W * (0.4 + hash(i + 5) * 0.5);
        var x = W * 0.03 + Math.cos(a) * sp * f;
        var y = H * 0.9 + Math.sin(a) * sp * f + H * 0.9 * f * f;
        ctx.save(); ctx.translate(x, y); ctx.rotate(f * 10 + i);
        ctx.fillStyle = rgba(cols[i % 5], 1 - f * 0.3);
        ctx.fillRect(-W * 0.006, -W * 0.01, W * 0.012, W * 0.02);
        ctx.restore();
      }
    },
    'star-twinkle': function (W, H) {
      for (var i = 0; i < 26; i++) {
        var x = W * hash(i * 3), y = H * hash(i * 3 + 1);
        var tw = Math.abs(Math.sin(P * Math.PI * 2 * (1 + hash(i) * 2) + i));
        var r = Math.min(W, H) * (0.01 + hash(i + 9) * 0.02) * (0.5 + tw);
        ctx.fillStyle = rgba('255,235,170', 0.4 + tw * 0.6);
        ctx.beginPath();
        for (var p = 0; p < 8; p++) {
          var a = (p / 8) * Math.PI * 2;
          var rr = p % 2 ? r * 0.38 : r;
          if (p === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        ctx.closePath(); ctx.fill();
      }
    },
    'ticker-tape': function (W, H) {
      var cols = ['235,235,240', '250,200,70', '120,160,250'];
      for (var i = 0; i < 46; i++) {
        var f = ((hash(i) + P * (0.4 + hash(i + 7) * 0.3)) % 1);
        var x = W * hash(i + 13) + Math.sin(f * 6 + i) * W * 0.05;
        ctx.save(); ctx.translate(x, f * H * 1.1 - H * 0.05); ctx.rotate(Math.sin(f * 10 + i) * 1.2);
        ctx.fillStyle = rgba(cols[i % 3], 0.95);
        ctx.fillRect(-W * 0.02, -W * 0.005, W * 0.04, W * 0.01);
        ctx.restore();
      }
    },
    // --- Brush and ink strokes
    'ink-splat': function (W, H) {
      var f = Math.min(1, P * 3), cx = W / 2, cy = H / 2;
      ctx.fillStyle = rgba('28,32,44', 0.95);
      ctx.beginPath();
      for (var i = 0; i <= 36; i++) {
        var a = (i / 36) * Math.PI * 2;
        var r = Math.min(W, H) * 0.2 * f * (1 + (hash(i) - 0.5) * 0.7);
        if (i === 0) ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); else ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      ctx.closePath(); ctx.fill();
      for (var d = 0; d < 14; d++) {
        var a2 = hash(d) * Math.PI * 2;
        var dd = Math.min(W, H) * (0.24 + hash(d + 9) * 0.2) * f;
        blob(cx + Math.cos(a2) * dd, cy + Math.sin(a2) * dd, Math.min(W, H) * (0.008 + hash(d + 17) * 0.014), '28,32,44', 0.95);
      }
    },
    'paint-roller-pass': function (W, H) {
      var f = P === 0 ? 1 : Math.min(1, P * 1.15);
      ctx.fillStyle = rgba('66,133,190', 0.95);
      ctx.beginPath();
      ctx.moveTo(0, H * 0.3);
      for (var x = 0; x <= W * f; x += W / 40) ctx.lineTo(x, H * 0.3 + (hash(x) - 0.5) * H * 0.03);
      for (var x2 = W * f; x2 >= 0; x2 -= W / 40) ctx.lineTo(x2, H * 0.72 + (hash(x2 + 7) - 0.5) * H * 0.03);
      ctx.closePath(); ctx.fill();
      if (P > 0 && P < 1) {
        ctx.fillStyle = rgba('90,96,110', 0.95);
        ctx.fillRect(W * f - W * 0.02, H * 0.26, W * 0.04, H * 0.5);
      }
    },
    'dry-brush': function (W, H) {
      ctx.lineCap = 'round';
      for (var pass = 0; pass < 12; pass++) {
        ctx.strokeStyle = rgba('150,60,50', 0.3 + hash(pass) * 0.3);
        ctx.lineWidth = Math.max(1, H * (0.012 + hash(pass + 5) * 0.02));
        var y0 = H * (0.4 + (pass / 12) * 0.22 + (hash(pass + 9) - 0.5) * 0.04);
        ctx.beginPath(); ctx.moveTo(W * (0.06 + hash(pass) * 0.04), y0);
        ctx.quadraticCurveTo(W * 0.5, y0 + (hash(pass + 13) - 0.5) * H * 0.08, W * (0.9 - hash(pass + 3) * 0.08), y0 + (hash(pass + 17) - 0.5) * H * 0.05);
        ctx.stroke();
      }
    },
    'ink-drips': function (W, H) {
      ctx.fillStyle = rgba('30,34,46', 0.95);
      ctx.fillRect(0, 0, W, H * 0.12);
      for (var i = 0; i < 9; i++) {
        var x = W * (0.06 + i * 0.11);
        var len = H * (0.15 + hash(i) * 0.5) * Math.min(1, (P === 0 ? 1 : P) * (0.8 + hash(i + 5) * 0.5));
        ctx.strokeStyle = rgba('30,34,46', 0.95); ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(2, W * (0.014 + hash(i + 9) * 0.014));
        ctx.beginPath(); ctx.moveTo(x, H * 0.1); ctx.lineTo(x, H * 0.1 + len); ctx.stroke();
        blob(x, H * 0.1 + len, W * 0.016, '30,34,46', 1);
      }
    },
    // --- Objects: travel
    'passport': function (W, H) {
      shadow(W / 2, H * 0.84, U * 0.3, U * 0.07);
      box(W * 0.28, H * 0.18, W * 0.44, H * 0.62, U * 0.03, '#27496d');
      ctx.strokeStyle = 'rgba(230,200,120,0.9)'; ctx.lineWidth = U * 0.008;
      ctx.strokeRect(W * 0.32, H * 0.23, W * 0.36, H * 0.52);
      disc(W / 2, H * 0.42, U * 0.09, 'rgba(0,0,0,0)', U * 0.01);
      ctx.strokeStyle = 'rgba(230,200,120,0.9)';
      ctx.beginPath(); ctx.ellipse(W / 2, H * 0.42, U * 0.04, U * 0.09, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(W / 2 - U * 0.09, H * 0.42); ctx.lineTo(W / 2 + U * 0.09, H * 0.42); ctx.stroke();
      line([W * 0.38, H * 0.62, W * 0.62, H * 0.62], 'rgba(230,200,120,0.9)', U * 0.012);
      line([W * 0.42, H * 0.67, W * 0.58, H * 0.67], 'rgba(230,200,120,0.7)', U * 0.009);
    },
    'postcard': function (W, H) {
      shadow(W / 2, H * 0.78, U * 0.36, U * 0.06);
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(-0.06);
      box(-W * 0.36, -H * 0.24, W * 0.72, H * 0.48, U * 0.015, '#f3eee0');
      box(-W * 0.33, -H * 0.2, W * 0.3, H * 0.4, U * 0.01, '#9fcf6b');
      disc(-W * 0.18, -H * 0.08, U * 0.05, '#ffd166', 0);
      poly([-W * 0.33, H * 0.2, -W * 0.16, -H * 0.02, -W * 0.03, H * 0.2], '#4f8f45', 0);
      box(W * 0.2, -H * 0.17, W * 0.1, H * 0.12, U * 0.008, '#e2574c');
      line([W * 0.02, H * 0.02, W * 0.3, H * 0.02], INK, U * 0.008);
      line([W * 0.02, H * 0.09, W * 0.26, H * 0.09], INK, U * 0.008);
      ctx.restore();
    },
    'sunglasses': function (W, H) {
      shadow(W / 2, H * 0.66, U * 0.34, U * 0.05);
      ctx.lineWidth = U * 0.02; ctx.strokeStyle = '#20242e';
      ctx.beginPath(); ctx.moveTo(W * 0.12, H * 0.42); ctx.lineTo(W * 0.88, H * 0.42); ctx.stroke();
      for (var side = 0; side < 2; side++) {
        var cx = W * (side ? 0.66 : 0.34);
        ctx.fillStyle = '#20242e';
        ctx.beginPath(); ctx.roundRect(cx - W * 0.15, H * 0.42, W * 0.3, H * 0.2, U * 0.05); ctx.fill();
        var g = ctx.createLinearGradient(0, H * 0.42, 0, H * 0.62);
        g.addColorStop(0, 'rgba(120,180,220,0.8)'); g.addColorStop(1, 'rgba(40,60,90,0.9)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.roundRect(cx - W * 0.13, H * 0.44, W * 0.26, H * 0.16, U * 0.04); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath(); ctx.ellipse(cx - W * 0.05, H * 0.48, W * 0.05, H * 0.015, -0.3, 0, Math.PI * 2); ctx.fill();
      }
    },
    'camper-van': function (W, H) {
      shadow(W / 2, H * 0.8, U * 0.38, U * 0.06);
      box(W * 0.12, H * 0.34, W * 0.76, H * 0.34, U * 0.04, '#e8e4da');
      ctx.fillStyle = '#e2574c'; ctx.beginPath();
      ctx.roundRect(W * 0.12, H * 0.5, W * 0.76, H * 0.18, [0, 0, U * 0.04, U * 0.04]); ctx.fill(); edge();
      box(W * 0.2, H * 0.4, W * 0.16, H * 0.12, U * 0.015, '#9fd0e8');
      box(W * 0.44, H * 0.4, W * 0.16, H * 0.12, U * 0.015, '#9fd0e8');
      box(W * 0.68, H * 0.4, W * 0.12, H * 0.12, U * 0.015, '#9fd0e8');
      disc(W * 0.3, H * 0.7, U * 0.07, '#2b2f3a');
      disc(W * 0.7, H * 0.7, U * 0.07, '#2b2f3a');
      disc(W * 0.3, H * 0.7, U * 0.03, '#c9ccd4', 0);
      disc(W * 0.7, H * 0.7, U * 0.03, '#c9ccd4', 0);
      box(W * 0.3, H * 0.28, W * 0.4, H * 0.05, U * 0.01, '#8a6a3a');
    },
    // --- Objects: home
    'armchair': function (W, H) {
      shadow(W / 2, H * 0.84, U * 0.32, U * 0.06);
      box(W * 0.22, H * 0.3, W * 0.56, H * 0.34, U * 0.05, '#4f6d8f');
      box(W * 0.16, H * 0.5, W * 0.14, H * 0.26, U * 0.04, '#41597a');
      box(W * 0.7, H * 0.5, W * 0.14, H * 0.26, U * 0.04, '#41597a');
      box(W * 0.26, H * 0.56, W * 0.48, H * 0.16, U * 0.035, '#5d7fa6');
      line([W * 0.3, H * 0.76, W * 0.3, H * 0.84], '#6e5430', U * 0.02);
      line([W * 0.7, H * 0.76, W * 0.7, H * 0.84], '#6e5430', U * 0.02);
    },
    'alarm-clock': function (W, H) {
      shadow(W / 2, H * 0.82, U * 0.26, U * 0.05);
      disc(W * 0.32, H * 0.26, U * 0.07, '#e2574c');
      disc(W * 0.68, H * 0.26, U * 0.07, '#e2574c');
      disc(W / 2, H * 0.52, U * 0.3, '#f3eee0');
      disc(W / 2, H * 0.52, U * 0.24, '#fdfbf4', 0);
      for (var i = 0; i < 12; i++) {
        var a = (i / 12) * Math.PI * 2;
        line([W / 2 + Math.cos(a) * U * 0.2, H * 0.52 + Math.sin(a) * U * 0.2, W / 2 + Math.cos(a) * U * 0.225, H * 0.52 + Math.sin(a) * U * 0.225], INK, U * 0.01);
      }
      line([W / 2, H * 0.52, W / 2 + U * 0.1, H * 0.52 - U * 0.08], INK, U * 0.016);
      line([W / 2, H * 0.52, W / 2 - U * 0.04, H * 0.52 - U * 0.14], INK, U * 0.016);
      line([W * 0.36, H * 0.78, W * 0.3, H * 0.84], INK, U * 0.02);
      line([W * 0.64, H * 0.78, W * 0.7, H * 0.84], INK, U * 0.02);
    },
    'teapot': function (W, H) {
      shadow(W / 2, H * 0.82, U * 0.3, U * 0.06);
      oval(W / 2, H * 0.58, U * 0.26, U * 0.2, '#6b8f71');
      box(W * 0.42, H * 0.3, W * 0.16, H * 0.08, U * 0.02, '#6b8f71');
      disc(W / 2, H * 0.28, U * 0.035, '#55735a');
      ctx.strokeStyle = INK; ctx.lineWidth = U * 0.035; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(W * 0.26, H * 0.48);
      ctx.quadraticCurveTo(W * 0.1, H * 0.46, W * 0.14, H * 0.62);
      ctx.stroke();
      ctx.strokeStyle = '#55735a'; ctx.lineWidth = U * 0.03;
      ctx.beginPath(); ctx.moveTo(W * 0.74, H * 0.5);
      ctx.quadraticCurveTo(W * 0.92, H * 0.56, W * 0.76, H * 0.68);
      ctx.stroke();
      oval(W / 2, H * 0.56, U * 0.14, U * 0.08, 'rgba(255,255,255,0.14)', 0);
    },
    'framed-photo': function (W, H) {
      shadow(W / 2, H * 0.85, U * 0.3, U * 0.05);
      box(W * 0.24, H * 0.18, W * 0.52, H * 0.62, U * 0.02, '#8a6a3a');
      box(W * 0.29, H * 0.24, W * 0.42, H * 0.5, U * 0.01, '#f3eee0');
      box(W * 0.32, H * 0.27, W * 0.36, H * 0.38, 0, '#9ed0f0');
      poly([W * 0.32, H * 0.65, W * 0.46, H * 0.44, W * 0.56, H * 0.58, W * 0.63, H * 0.5, W * 0.68, H * 0.65], '#4f8f45', 0);
      disc(W * 0.6, H * 0.33, U * 0.035, '#ffd166', 0);
      line([W * 0.42, H * 0.8, W * 0.58, H * 0.8], INK, U * 0.015);
    },
    // --- Objects: science
    'microscope': function (W, H) {
      shadow(W / 2, H * 0.86, U * 0.3, U * 0.05);
      box(W * 0.3, H * 0.82, W * 0.4, H * 0.05, U * 0.02, '#3a4254');
      ctx.strokeStyle = '#3a4254'; ctx.lineWidth = U * 0.05; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(W * 0.42, H * 0.82);
      ctx.quadraticCurveTo(W * 0.34, H * 0.5, W * 0.52, H * 0.34);
      ctx.stroke();
      ctx.save(); ctx.translate(W * 0.56, H * 0.3); ctx.rotate(0.5);
      box(-U * 0.045, -U * 0.14, U * 0.09, U * 0.3, U * 0.02, '#5d7fa6');
      box(-U * 0.03, U * 0.16, U * 0.06, U * 0.08, U * 0.01, '#3a4254');
      ctx.restore();
      box(W * 0.38, H * 0.62, W * 0.26, H * 0.04, U * 0.01, '#8893a8');
      box(W * 0.46, H * 0.6, W * 0.1, H * 0.02, 0, '#bfe3ff');
      disc(W * 0.6, H * 0.75, U * 0.035, '#8893a8');
    },
    'magnet': function (W, H) {
      shadow(W / 2, H * 0.82, U * 0.26, U * 0.05);
      ctx.lineWidth = U * 0.11; ctx.lineCap = 'butt';
      ctx.strokeStyle = '#e2574c';
      ctx.beginPath(); ctx.arc(W / 2, H * 0.46, U * 0.2, Math.PI, 0); ctx.stroke();
      ctx.strokeStyle = '#d04438';
      ctx.beginPath(); ctx.moveTo(W / 2 - U * 0.2, H * 0.46); ctx.lineTo(W / 2 - U * 0.2, H * 0.66); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(W / 2 + U * 0.2, H * 0.46); ctx.lineTo(W / 2 + U * 0.2, H * 0.66); ctx.stroke();
      ctx.fillStyle = '#c9ccd4';
      ctx.fillRect(W / 2 - U * 0.2 - U * 0.055, H * 0.66, U * 0.11, H * 0.09);
      ctx.fillRect(W / 2 + U * 0.2 - U * 0.055, H * 0.66, U * 0.11, H * 0.09);
      for (var i = 0; i < 3; i++) {
        var y = H * (0.8 + i * 0.016);
        line([W / 2 - U * 0.26 + i * U * 0.02, y, W / 2 - U * 0.14 - i * U * 0.01, y], 'rgba(120,160,250,0.8)', U * 0.008);
        line([W / 2 + U * 0.14 + i * U * 0.01, y, W / 2 + U * 0.26 - i * U * 0.02, y], 'rgba(120,160,250,0.8)', U * 0.008);
      }
    },
    // --- Objects: nature
    'acorn': function (W, H) {
      shadow(W / 2, H * 0.82, U * 0.2, U * 0.045);
      ctx.fillStyle = '#c99b5f';
      ctx.beginPath(); ctx.moveTo(W / 2 - U * 0.16, H * 0.46);
      ctx.quadraticCurveTo(W / 2, H * 0.9, W / 2 + U * 0.16, H * 0.46);
      ctx.closePath(); ctx.fill(); edge();
      oval(W / 2, H * 0.43, U * 0.2, U * 0.1, '#6e5430');
      for (var i = 0; i < 5; i++) {
        var a = -Math.PI * 0.9 + (i / 4) * Math.PI * 0.8;
        line([W / 2 + Math.cos(a) * U * 0.12, H * 0.42 + Math.sin(a) * U * 0.06, W / 2 + Math.cos(a) * U * 0.18, H * 0.43 + Math.sin(a) * U * 0.09], 'rgba(60,44,24,0.5)', U * 0.008);
      }
      line([W / 2, H * 0.33, W / 2 + U * 0.03, H * 0.24], '#55401f', U * 0.025);
      blob(W / 2 - U * 0.06, H * 0.55, U * 0.05, '255,245,225', 0.25);
    }
  };
  Object.keys(TEN).forEach(function (k) { DRAW[k] = TEN[k]; });
`;
