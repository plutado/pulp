/**
 * The asset page's Objects, second half (milestone 26): business, science,
 * media, nature, travel, home and community props, in the vocabulary
 * `sample-asset-objects.ts` sets up (`disc`, `box`, `poly`, `line`, `arc`,
 * `star`, `heart`, `shadow`, `edge`, `O`). Spliced in after it.
 */
export const ASSET_OBJECTS_MORE_JS = `
  var MORE_OBJECTS = {
    // ===== Business objects
    'briefcase': O(function (cx, cy) {
      shadow(cx, cy + U * 0.38, U * 0.38, U * 0.06);
      box(cx - U * 0.12, cy - U * 0.34, U * 0.24, U * 0.14, U * 0.03, 'rgba(0,0,0,0)', U * 0.03);
      box(cx - U * 0.38, cy - U * 0.22, U * 0.76, U * 0.52, U * 0.04, '#6b4a2b');
      box(cx - U * 0.38, cy - U * 0.02, U * 0.76, U * 0.04, 0, '#4f3620', 0);
      box(cx - U * 0.07, cy - U * 0.06, U * 0.14, U * 0.12, U * 0.02, '#e2b23a');
      box(cx - U * 0.32, cy - U * 0.16, U * 0.06, U * 0.4, U * 0.01, 'rgba(0,0,0,0.2)', 0); box(cx + U * 0.26, cy - U * 0.16, U * 0.06, U * 0.4, U * 0.01, 'rgba(0,0,0,0.2)', 0);
    }),
    'id-badge': O(function (cx, cy) {
      shadow(cx, cy + U * 0.42, U * 0.2, U * 0.04);
      line([cx - U * 0.14, cy - U * 0.44, cx, cy - U * 0.26, cx + U * 0.14, cy - U * 0.44], '#1f4fa3', U * 0.03);
      box(cx - U * 0.04, cy - U * 0.3, U * 0.08, U * 0.06, U * 0.01, '#9aa3b2');
      box(cx - U * 0.22, cy - U * 0.24, U * 0.44, U * 0.64, U * 0.03, '#f7f8fa');
      box(cx - U * 0.22, cy - U * 0.24, U * 0.44, U * 0.1, U * 0.03, '#1f4fa3', 0);
      disc(cx, cy, U * 0.09, '#ffd6a0', U * 0.008);
      ctx.beginPath(); ctx.arc(cx, cy + U * 0.22, U * 0.14, Math.PI, 0); ctx.closePath(); ctx.fillStyle = '#5aa9ff'; ctx.fill();
      line([cx - U * 0.14, cy + U * 0.28, cx + U * 0.14, cy + U * 0.28], '#9aa3b2', U * 0.012); line([cx - U * 0.1, cy + U * 0.33, cx + U * 0.1, cy + U * 0.33], '#c0c6d2', U * 0.012);
    }),
    'bar-chart-rise': O(function (cx, cy) {
      var f = P === 0 ? 1 : Math.min(1, P * 1.4);
      line([cx - U * 0.4, cy + U * 0.34, cx + U * 0.4, cy + U * 0.34], '#3a3f4a', U * 0.015);
      var cols = ['#5aa9ff', '#2d7ff9', '#1f4fa3', '#4fd1a5'];
      for (var i = 0; i < 4; i++) { var h = U * (0.14 + i * 0.14) * Math.min(1, f * (1.6 - i * 0.15)); box(cx - U * 0.34 + i * U * 0.19, cy + U * 0.34 - h, U * 0.13, h, U * 0.01, cols[i]); }
      if (f > 0.6) { var g = (f - 0.6) / 0.4; line([cx - U * 0.3, cy + U * 0.12, cx - U * 0.3 + U * 0.62 * g, cy + U * 0.12 - U * 0.46 * g], '#ff7a59', U * 0.03); if (g > 0.95) poly([cx + U * 0.34, cy - U * 0.4, cx + U * 0.36, cy - U * 0.24, cx + U * 0.2, cy - U * 0.32], '#ff7a59'); }
    }),
    'spinning-coin': O(function (cx, cy) {
      var w = Math.abs(Math.cos(P * Math.PI * 2)), rx = U * 0.3 * Math.max(0.08, w);
      shadow(cx, cy + U * 0.38, U * 0.2 + rx * 0.3, U * 0.04);
      oval(cx, cy, rx, U * 0.3, '#e2b23a');
      if (w > 0.3) { oval(cx, cy, rx * 0.8, U * 0.24, '#f2c94c', U * 0.008); ctx.fillStyle = '#c8955a'; ctx.font = 'bold ' + Math.round(U * 0.26) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.save(); ctx.translate(cx, cy); ctx.scale(Math.max(0.08, w), 1); ctx.fillText('$', 0, U * 0.02); ctx.restore(); }
      else oval(cx, cy, rx, U * 0.3, '#c8955a', U * 0.01);
    }),
    'money-stack': O(function (cx, cy) {
      shadow(cx, cy + U * 0.36, U * 0.4, U * 0.06);
      for (var i = 0; i < 4; i++) { var y = cy + U * 0.2 - i * U * 0.1, k = i % 2 ? U * 0.02 : 0; box(cx - U * 0.36 + k, y - U * 0.12, U * 0.72, U * 0.14, U * 0.02, i === 3 ? '#4fd1a5' : '#2d9c6f'); }
      box(cx - U * 0.36, cy - U * 0.22, U * 0.72, U * 0.14, U * 0.02, '#4fd1a5');
      box(cx - U * 0.1, cy - U * 0.24, U * 0.2, U * 0.18, U * 0.01, '#e6f7ef', 0);
      ctx.fillStyle = '#2d9c6f'; ctx.font = 'bold ' + Math.round(U * 0.12) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$', cx, cy - U * 0.15);
      disc(cx - U * 0.26, cy - U * 0.15, U * 0.03, '#1f5a3a', 0); disc(cx + U * 0.26, cy - U * 0.15, U * 0.03, '#1f5a3a', 0);
    }),
    'piggy-bank': O(function (cx, cy) {
      shadow(cx, cy + U * 0.38, U * 0.34, U * 0.06);
      for (var i = -1; i <= 1; i += 2) { box(cx + i * U * 0.2 - U * 0.05, cy + U * 0.16, U * 0.1, U * 0.18, U * 0.02, '#f08cb4'); box(cx + i * U * 0.08 - U * 0.05, cy + U * 0.16, U * 0.1, U * 0.18, U * 0.02, '#f08cb4'); }
      oval(cx, cy, U * 0.34, U * 0.26, '#f9a8d4');
      oval(cx + U * 0.34, cy + U * 0.02, U * 0.09, U * 0.08, '#f08cb4'); disc(cx + U * 0.36, cy + U * 0.02, U * 0.02, '#c25e8a', 0); disc(cx + U * 0.32, cy + U * 0.02, U * 0.02, '#c25e8a', 0);
      poly([cx + U * 0.14, cy - U * 0.2, cx + U * 0.26, cy - U * 0.3, cx + U * 0.26, cy - U * 0.14], '#f08cb4');
      disc(cx + U * 0.2, cy - U * 0.06, U * 0.025, '#1f232e', 0);
      box(cx - U * 0.12, cy - U * 0.28, U * 0.18, U * 0.035, U * 0.01, '#1f232e', 0);
      disc(cx - U * 0.03, cy - U * 0.38, U * 0.07, '#e2b23a');
    }),
    'house-key': O(function (cx, cy) {
      shadow(cx, cy + U * 0.3, U * 0.38, U * 0.06);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.5);
      line([-U * 0.06, 0, U * 0.4, 0], '#e2b23a', U * 0.06);
      box(U * 0.26, 0, U * 0.05, U * 0.1, U * 0.01, '#e2b23a', U * 0.006); box(U * 0.36, 0, U * 0.05, U * 0.08, U * 0.01, '#e2b23a', U * 0.006);
      disc(-U * 0.22, 0, U * 0.18, '#f2c94c'); disc(-U * 0.22, 0, U * 0.06, 'rgba(0,0,0,0)', U * 0.012);
      ctx.restore();
      poly([cx - U * 0.46, cy + U * 0.18, cx - U * 0.3, cy + U * 0.02, cx - U * 0.14, cy + U * 0.18, cx - U * 0.14, cy + U * 0.38, cx - U * 0.46, cy + U * 0.38], '#5aa9ff');
      box(cx - U * 0.34, cy + U * 0.24, U * 0.08, U * 0.14, U * 0.01, '#1f4fa3', 0);
    }),
    'house-front': O(function (cx, cy) {
      shadow(cx, cy + U * 0.42, U * 0.4, U * 0.05);
      box(cx - U * 0.3, cy - U * 0.04, U * 0.6, U * 0.44, U * 0.01, '#f7f1e6');
      poly([cx - U * 0.38, cy - U * 0.02, cx, cy - U * 0.4, cx + U * 0.38, cy - U * 0.02], '#d93a4a');
      box(cx + U * 0.12, cy - U * 0.36, U * 0.1, U * 0.14, U * 0.01, '#6b4a2b');
      box(cx - U * 0.08, cy + U * 0.14, U * 0.16, U * 0.26, U * 0.02, '#6b4a2b'); disc(cx + U * 0.04, cy + U * 0.28, U * 0.015, '#f2c94c', 0);
      box(cx - U * 0.26, cy + U * 0.04, U * 0.12, U * 0.12, U * 0.01, '#9ad1ff'); box(cx + U * 0.14, cy + U * 0.04, U * 0.12, U * 0.12, U * 0.01, '#9ad1ff');
      line([cx - U * 0.2, cy + U * 0.04, cx - U * 0.2, cy + U * 0.16], INK, U * 0.008); line([cx + U * 0.2, cy + U * 0.04, cx + U * 0.2, cy + U * 0.16], INK, U * 0.008);
    }),
    'sold-sign': O(function (cx, cy) {
      shadow(cx, cy + U * 0.44, U * 0.1, U * 0.025);
      line([cx, cy + U * 0.44, cx, cy - U * 0.2], '#6b4a2b', U * 0.035);
      box(cx - U * 0.36, cy - U * 0.4, U * 0.72, U * 0.3, U * 0.02, '#d93a4a');
      ctx.fillStyle = '#f7f8fa'; ctx.font = 'bold ' + Math.round(U * 0.17) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('SOLD', cx, cy - U * 0.24);
      box(cx - U * 0.3, cy - U * 0.06, U * 0.6, U * 0.1, U * 0.01, '#f7f8fa');
      line([cx - U * 0.22, cy - U * 0.01, cx + U * 0.22, cy - U * 0.01], '#9aa3b2', U * 0.02);
    }),
    'gavel': O(function (cx, cy) {
      shadow(cx, cy + U * 0.4, U * 0.38, U * 0.05);
      oval(cx + U * 0.1, cy + U * 0.34, U * 0.28, U * 0.06, '#6b4a2b');
      box(cx - U * 0.08, cy + U * 0.22, U * 0.36, U * 0.1, U * 0.02, '#8a5a32');
      ctx.save(); ctx.translate(cx - U * 0.04, cy - U * 0.08); ctx.rotate(-0.7);
      line([0, 0, U * 0.34, 0], '#8a5a32', U * 0.045);
      box(-U * 0.1, -U * 0.14, U * 0.2, U * 0.28, U * 0.03, '#6b4a2b');
      box(-U * 0.12, -U * 0.1, U * 0.04, U * 0.2, U * 0.01, '#e2b23a', 0); box(U * 0.08, -U * 0.1, U * 0.04, U * 0.2, U * 0.01, '#e2b23a', 0);
      ctx.restore();
    }),
    'scales-of-justice': O(function (cx, cy) {
      shadow(cx, cy + U * 0.42, U * 0.2, U * 0.04);
      box(cx - U * 0.16, cy + U * 0.36, U * 0.32, U * 0.06, U * 0.01, '#e2b23a');
      line([cx, cy + U * 0.36, cx, cy - U * 0.34], '#e2b23a', U * 0.03);
      line([cx - U * 0.34, cy - U * 0.26, cx + U * 0.34, cy - U * 0.26], '#e2b23a', U * 0.025);
      disc(cx, cy - U * 0.36, U * 0.04, '#f2c94c');
      for (var i = -1; i <= 1; i += 2) { var x = cx + i * U * 0.34, y = cy + U * 0.02 + i * U * 0.04; line([x, cy - U * 0.26, x - U * 0.12, y, x, cy - U * 0.26, x + U * 0.12, y], 'rgba(60,60,70,0.7)', U * 0.006); ctx.beginPath(); ctx.arc(x, y - U * 0.02, U * 0.14, 0, Math.PI); ctx.closePath(); ctx.fillStyle = '#f2c94c'; ctx.fill(); edge(); }
    }),
    'law-book': O(function (cx, cy) {
      shadow(cx, cy + U * 0.36, U * 0.38, U * 0.06);
      box(cx - U * 0.3, cy - U * 0.22, U * 0.6, U * 0.52, U * 0.02, '#f7f1e6');
      box(cx - U * 0.34, cy - U * 0.26, U * 0.6, U * 0.52, U * 0.02, '#6f2dbd');
      box(cx - U * 0.34, cy - U * 0.26, U * 0.08, U * 0.52, U * 0.02, '#4c1d8a', 0);
      box(cx - U * 0.14, cy - U * 0.12, U * 0.32, U * 0.08, U * 0.01, '#e2b23a', 0);
      line([cx - U * 0.14, cy + U * 0.04, cx + U * 0.18, cy + U * 0.04], '#e2b23a', U * 0.012); line([cx - U * 0.14, cy + U * 0.1, cx + U * 0.1, cy + U * 0.1], '#e2b23a', U * 0.012);
    }),
    // ===== Science objects
    'gear-spin': O(function (cx, cy) {
      var gear = function (x, y, r, n, col, rot) { ctx.save(); ctx.translate(x, y); ctx.rotate(rot); var pts = []; for (var i = 0; i < n * 2; i++) { var a = (i / (n * 2)) * Math.PI * 2, rr = i % 2 ? r : r * 1.22; pts.push(Math.cos(a) * rr, Math.sin(a) * rr, Math.cos(a + Math.PI / n * 0.6) * rr, Math.sin(a + Math.PI / n * 0.6) * rr); } poly(pts, col); disc(0, 0, r * 0.35, 'rgba(0,0,0,0)', U * 0.012); ctx.restore(); };
      shadow(cx, cy + U * 0.4, U * 0.36, U * 0.05);
      gear(cx - U * 0.12, cy + U * 0.04, U * 0.22, 10, '#6b7280', P * Math.PI * 2 / 10);
      gear(cx + U * 0.22, cy - U * 0.18, U * 0.13, 7, '#5aa9ff', -P * Math.PI * 2 / 7 + Math.PI / 7);
    }),
    'smartphone': O(function (cx, cy) {
      shadow(cx, cy + U * 0.44, U * 0.22, U * 0.04);
      box(cx - U * 0.2, cy - U * 0.4, U * 0.4, U * 0.8, U * 0.06, '#1f232e');
      box(cx - U * 0.17, cy - U * 0.35, U * 0.34, U * 0.7, U * 0.03, '#5aa9ff', 0);
      var g = ctx.createLinearGradient(cx, cy - U * 0.35, cx, cy + U * 0.35); g.addColorStop(0, '#2d7ff9'); g.addColorStop(1, '#4fd1a5'); ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(cx - U * 0.17, cy - U * 0.35, U * 0.34, U * 0.7, U * 0.03); ctx.fill();
      for (var i = 0; i < 6; i++) box(cx - U * 0.13 + (i % 3) * U * 0.1, cy - U * 0.26 + Math.floor(i / 3) * U * 0.1, U * 0.06, U * 0.06, U * 0.015, 'rgba(255,255,255,0.85)', 0);
      box(cx - U * 0.04, cy - U * 0.385, U * 0.08, U * 0.012, U * 0.006, '#3a3f4a', 0);
    }),
    'first-aid-cross': O(function (cx, cy) {
      shadow(cx, cy + U * 0.4, U * 0.36, U * 0.05);
      box(cx - U * 0.1, cy - U * 0.4, U * 0.2, U * 0.1, U * 0.02, 'rgba(0,0,0,0)', U * 0.025);
      box(cx - U * 0.36, cy - U * 0.3, U * 0.72, U * 0.62, U * 0.04, '#f7f8fa');
      box(cx - U * 0.36, cy - U * 0.3, U * 0.72, U * 0.08, U * 0.04, '#d93a4a', 0);
      poly([cx - U * 0.06, cy - U * 0.14, cx + U * 0.06, cy - U * 0.14, cx + U * 0.06, cy - U * 0.02, cx + U * 0.18, cy - U * 0.02, cx + U * 0.18, cy + U * 0.1, cx + U * 0.06, cy + U * 0.1, cx + U * 0.06, cy + U * 0.22, cx - U * 0.06, cy + U * 0.22, cx - U * 0.06, cy + U * 0.1, cx - U * 0.18, cy + U * 0.1, cx - U * 0.18, cy - U * 0.02, cx - U * 0.06, cy - U * 0.02], '#d93a4a', 0);
    }),
    'heartbeat-line': function (W, H) {
      var pts = [0, 0.5, 0.2, 0.5, 0.26, 0.44, 0.32, 0.56, 0.38, 0.5, 0.44, 0.5, 0.48, 0.2, 0.53, 0.85, 0.58, 0.5, 0.66, 0.5, 0.7, 0.42, 0.74, 0.5, 1, 0.5];
      var head = P === 0 ? 1 : P * 1.08;
      ctx.strokeStyle = 'rgba(80,220,140,0.35)'; ctx.lineWidth = H * 0.05; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(0, H * 0.5);
      for (var i = 2; i < pts.length; i += 2) { if (pts[i] > head) { var t = (head - pts[i - 2]) / (pts[i] - pts[i - 2]); ctx.lineTo(W * head, H * (pts[i - 1] + (pts[i + 1] - pts[i - 1]) * t)); break; } ctx.lineTo(W * pts[i], H * pts[i + 1]); }
      ctx.stroke(); ctx.strokeStyle = '#4fd1a5'; ctx.lineWidth = H * 0.016; ctx.stroke();
      blob(W * Math.min(1, head), H * 0.5, H * 0.08, '140,255,190', 0.7);
    },
    'pill-capsule': O(function (cx, cy) {
      shadow(cx, cy + U * 0.3, U * 0.34, U * 0.06);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.6);
      box(-U * 0.34, -U * 0.12, U * 0.68, U * 0.24, U * 0.12, '#f7f8fa');
      ctx.save(); ctx.beginPath(); ctx.rect(0, -U * 0.14, U * 0.36, U * 0.28); ctx.clip(); box(-U * 0.34, -U * 0.12, U * 0.68, U * 0.24, U * 0.12, '#d93a4a', 0); ctx.restore();
      box(-U * 0.34, -U * 0.12, U * 0.68, U * 0.24, U * 0.12, 'rgba(0,0,0,0)');
      blob(-U * 0.14, -U * 0.06, U * 0.08, '255,255,255', 0.5);
      ctx.restore();
    }),
    'atom-orbit': O(function (cx, cy) {
      for (var i = 0; i < 3; i++) { ctx.save(); ctx.translate(cx, cy); ctx.rotate(i * Math.PI / 3); ctx.beginPath(); ctx.ellipse(0, 0, U * 0.4, U * 0.14, 0, 0, Math.PI * 2); ctx.strokeStyle = '#5aa9ff'; ctx.lineWidth = U * 0.012; ctx.stroke(); var a = P * Math.PI * 2 * (i % 2 ? 1 : -1) + i * 2; disc(Math.cos(a) * U * 0.4, Math.sin(a) * U * 0.14, U * 0.035, '#4fd1a5', U * 0.006); ctx.restore(); }
      blob(cx, cy, U * 0.16, '90,170,255', 0.4);
      disc(cx, cy, U * 0.08, '#2d7ff9');
    }),
    'dna-helix': O(function (cx, cy) {
      for (var i = 0; i <= 16; i++) {
        var t = i / 16, y = cy - U * 0.42 + t * U * 0.84, a = t * Math.PI * 3;
        var x1 = cx + Math.sin(a) * U * 0.22, x2 = cx - Math.sin(a) * U * 0.22;
        if (i % 2 === 0) line([x1, y, x2, y], 'rgba(90,170,255,0.6)', U * 0.012);
        disc(x1, y, U * 0.03, '#2d7ff9', U * 0.006); disc(x2, y, U * 0.03, '#4fd1a5', U * 0.006);
      }
    }),
    'beaker-bubbling': O(function (cx, cy) {
      shadow(cx, cy + U * 0.42, U * 0.26, U * 0.04);
      ctx.beginPath(); ctx.moveTo(cx - U * 0.12, cy - U * 0.4); ctx.lineTo(cx - U * 0.12, cy - U * 0.06); ctx.lineTo(cx - U * 0.3, cy + U * 0.32); ctx.quadraticCurveTo(cx - U * 0.3, cy + U * 0.42, cx - U * 0.2, cy + U * 0.42); ctx.lineTo(cx + U * 0.2, cy + U * 0.42); ctx.quadraticCurveTo(cx + U * 0.3, cy + U * 0.42, cx + U * 0.3, cy + U * 0.32); ctx.lineTo(cx + U * 0.12, cy - U * 0.06); ctx.lineTo(cx + U * 0.12, cy - U * 0.4); ctx.closePath(); ctx.fillStyle = 'rgba(230,240,255,0.7)'; ctx.fill();
      ctx.save(); ctx.clip(); ctx.fillStyle = '#4fd1a5'; ctx.fillRect(cx - U * 0.4, cy + U * 0.1, U * 0.8, U * 0.4); for (var i = 0; i < 7; i++) { var f = ((hash(i) + P * (0.6 + hash(i + 3) * 0.5)) % 1); disc(cx + (hash(i + 5) - 0.5) * U * 0.3, cy + U * 0.42 - f * U * 0.36, U * (0.015 + hash(i + 7) * 0.02), 'rgba(255,255,255,0.7)', 0); } ctx.restore();
      ctx.strokeStyle = INK; ctx.lineWidth = U * 0.012; ctx.stroke();
      line([cx - U * 0.16, cy - U * 0.4, cx + U * 0.16, cy - U * 0.4], INK, U * 0.025);
      for (var k = 0; k < 3; k++) { var f2 = ((P * 0.5 + k / 3) % 1); blob(cx + (k - 1) * U * 0.06, cy - U * 0.42 - f2 * U * 0.2, U * 0.03 * (1 - f2), '200,255,230', (1 - f2) * 0.8); }
    }),
    // ===== Media objects
    'news-microphone': O(function (cx, cy) {
      shadow(cx, cy + U * 0.44, U * 0.12, U * 0.03);
      line([cx, cy + U * 0.44, cx, cy + U * 0.02], '#3a3f4a', U * 0.08);
      box(cx - U * 0.16, cy, U * 0.32, U * 0.2, U * 0.02, '#d93a4a');
      ctx.fillStyle = '#f7f8fa'; ctx.font = 'bold ' + Math.round(U * 0.1) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('NEWS', cx, cy + U * 0.1);
      disc(cx, cy - U * 0.2, U * 0.2, '#6b7280');
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy - U * 0.2, U * 0.2, 0, Math.PI * 2); ctx.clip(); ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = U * 0.008; for (var i = -5; i <= 5; i++) { ctx.beginPath(); ctx.moveTo(cx - U * 0.2, cy - U * 0.2 + i * U * 0.04); ctx.lineTo(cx + U * 0.2, cy - U * 0.2 + i * U * 0.04); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx + i * U * 0.04, cy - U * 0.4); ctx.lineTo(cx + i * U * 0.04, cy); ctx.stroke(); } ctx.restore();
    }),
    'tv-camera': O(function (cx, cy) {
      shadow(cx, cy + U * 0.44, U * 0.3, U * 0.04);
      line([cx - U * 0.04, cy + U * 0.14, cx - U * 0.24, cy + U * 0.44], '#3a3f4a', U * 0.03); line([cx - U * 0.04, cy + U * 0.14, cx + U * 0.2, cy + U * 0.44], '#3a3f4a', U * 0.03); line([cx - U * 0.04, cy + U * 0.14, cx - U * 0.04, cy + U * 0.44], '#3a3f4a', U * 0.03);
      box(cx - U * 0.3, cy - U * 0.16, U * 0.46, U * 0.3, U * 0.03, '#2c3040');
      box(cx + U * 0.14, cy - U * 0.1, U * 0.2, U * 0.18, U * 0.02, '#1f232e');
      disc(cx + U * 0.36, cy - U * 0.01, U * 0.1, '#1f232e'); disc(cx + U * 0.36, cy - U * 0.01, U * 0.06, '#5aa9ff', 0);
      box(cx - U * 0.24, cy - U * 0.32, U * 0.26, U * 0.14, U * 0.02, '#3a3f4a');
      disc(cx - U * 0.22, cy - U * 0.1, U * 0.02, '#d93a4a', 0);
    }),
    'newspaper': O(function (cx, cy) {
      shadow(cx, cy + U * 0.32, U * 0.4, U * 0.06);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.1);
      box(-U * 0.36, -U * 0.3, U * 0.72, U * 0.56, U * 0.02, '#f7f4ec');
      box(-U * 0.3, -U * 0.24, U * 0.6, U * 0.08, 0, '#1f232e', 0);
      box(-U * 0.3, -U * 0.1, U * 0.26, U * 0.2, 0, '#9aa3b2', 0);
      for (var i = 0; i < 5; i++) line([-U * 0.0, -U * 0.08 + i * U * 0.045, U * 0.3, -U * 0.08 + i * U * 0.045], '#8a8f99', U * 0.012);
      for (var k = 0; k < 2; k++) line([-U * 0.3, U * 0.16 + k * U * 0.045, U * 0.3, U * 0.16 + k * U * 0.045], '#8a8f99', U * 0.012);
      ctx.restore();
    }),
    'film-reel': O(function (cx, cy) {
      shadow(cx, cy + U * 0.4, U * 0.34, U * 0.05);
      disc(cx, cy, U * 0.38, '#3a3f4a');
      for (var i = 0; i < 6; i++) { var a = (i / 6) * Math.PI * 2; disc(cx + Math.cos(a) * U * 0.22, cy + Math.sin(a) * U * 0.22, U * 0.08, 'rgba(0,0,0,0)', U * 0.012); }
      for (var k = 0; k < 24; k++) { var b = (k / 24) * Math.PI * 2; box(cx + Math.cos(b) * U * 0.355 - U * 0.012, cy + Math.sin(b) * U * 0.355 - U * 0.012, U * 0.024, U * 0.024, U * 0.004, '#1f232e', 0); }
      disc(cx, cy, U * 0.06, '#9aa3b2');
      ctx.beginPath(); ctx.moveTo(cx + U * 0.3, cy + U * 0.24); ctx.quadraticCurveTo(cx + U * 0.5, cy + U * 0.4, cx + U * 0.46, cy + U * 0.46); ctx.strokeStyle = '#1f232e'; ctx.lineWidth = U * 0.05; ctx.stroke();
    }),
    'vintage-camera': O(function (cx, cy) {
      shadow(cx, cy + U * 0.38, U * 0.38, U * 0.06);
      box(cx - U * 0.38, cy - U * 0.2, U * 0.76, U * 0.5, U * 0.04, '#6b4a2b');
      box(cx - U * 0.38, cy - U * 0.08, U * 0.76, U * 0.26, 0, '#3a3f4a', 0);
      box(cx - U * 0.3, cy - U * 0.3, U * 0.16, U * 0.12, U * 0.02, '#3a3f4a');
      disc(cx + U * 0.24, cy - U * 0.26, U * 0.04, '#9aa3b2');
      disc(cx, cy + U * 0.04, U * 0.19, '#1f232e'); disc(cx, cy + U * 0.04, U * 0.13, '#5aa9ff', U * 0.008); disc(cx, cy + U * 0.04, U * 0.06, '#1f4fa3', 0);
      blob(cx - U * 0.05, cy - U * 0.01, U * 0.05, '255,255,255', 0.5);
    }),
    'boom-mic': O(function (cx, cy) {
      shadow(cx, cy + U * 0.44, U * 0.14, U * 0.03);
      line([cx - U * 0.4, cy + U * 0.44, cx + U * 0.1, cy - U * 0.2], '#3a3f4a', U * 0.03);
      ctx.save(); ctx.translate(cx + U * 0.14, cy - U * 0.24); ctx.rotate(-0.9);
      box(-U * 0.34, -U * 0.1, U * 0.68, U * 0.2, U * 0.1, '#6b7280');
      ctx.save(); ctx.beginPath(); ctx.roundRect(-U * 0.34, -U * 0.1, U * 0.68, U * 0.2, U * 0.1); ctx.clip(); for (var i = 0; i < 12; i++) { ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(-U * 0.3 + i * U * 0.055, (i % 2 ? U * 0.04 : -U * 0.04), U * 0.025, 0, Math.PI * 2); ctx.fill(); } ctx.restore();
      ctx.restore();
    }),
    'podcast-mic': O(function (cx, cy) {
      shadow(cx, cy + U * 0.44, U * 0.14, U * 0.03);
      line([cx + U * 0.36, cy + U * 0.44, cx + U * 0.36, cy - U * 0.1, cx + U * 0.1, cy - U * 0.14], '#3a3f4a', U * 0.03);
      box(cx - U * 0.16, cy - U * 0.4, U * 0.32, U * 0.52, U * 0.16, '#5aa9ff');
      ctx.save(); ctx.beginPath(); ctx.roundRect(cx - U * 0.16, cy - U * 0.4, U * 0.32, U * 0.52, U * 0.16); ctx.clip(); ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = U * 0.01; for (var i = -8; i <= 8; i++) { ctx.beginPath(); ctx.moveTo(cx - U * 0.2, cy - U * 0.14 + i * U * 0.035); ctx.lineTo(cx + U * 0.2, cy - U * 0.14 + i * U * 0.035); ctx.stroke(); } ctx.restore();
      arc(cx, cy - U * 0.04, U * 0.24, 0, Math.PI, '#3a3f4a', U * 0.03);
      line([cx, cy + U * 0.2, cx, cy + U * 0.34], '#3a3f4a', U * 0.03);
      box(cx - U * 0.12, cy + U * 0.32, U * 0.24, U * 0.06, U * 0.02, '#3a3f4a');
    }),
    'headphones': O(function (cx, cy) {
      shadow(cx, cy + U * 0.4, U * 0.36, U * 0.05);
      arc(cx, cy + U * 0.04, U * 0.34, Math.PI, Math.PI * 2, '#3a3f4a', U * 0.05);
      for (var i = -1; i <= 1; i += 2) { box(cx + i * U * 0.3 - U * 0.09, cy - U * 0.02, U * 0.18, U * 0.3, U * 0.05, '#2c3040'); box(cx + i * U * 0.3 - U * 0.06 + (i < 0 ? U * 0.04 : -U * 0.04), cy + U * 0.02, U * 0.1, U * 0.22, U * 0.04, '#d93a4a', 0); }
      arc(cx, cy + U * 0.04, U * 0.28, Math.PI * 1.1, Math.PI * 1.9, 'rgba(255,255,255,0.3)', U * 0.012);
    }),
    'on-air-sign': function (W, H) {
      var on = 0.55 + 0.45 * Math.max(0, Math.sin(P * Math.PI * 2 * 2));
      box(W * 0.1, H * 0.2, W * 0.8, H * 0.6, H * 0.08, '#1f232e');
      blob(W / 2, H / 2, W * 0.35, '255,60,60', 0.3 * on);
      box(W * 0.14, H * 0.26, W * 0.72, H * 0.48, H * 0.06, rgba('200,30,40', 0.4 + 0.6 * on), 0);
      ctx.fillStyle = rgba('255,240,240', 0.6 + 0.4 * on); ctx.font = 'bold ' + Math.round(H * 0.3) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('ON AIR', W / 2, H * 0.51);
    },
    'like-heart-burst': O(function (cx, cy) {
      var f = P, s = P === 0 ? 1 : (f < 0.3 ? 0.6 + 0.4 * Math.sin(f / 0.3 * Math.PI / 2) * 1.5 : 1 + 0.2 * (1 - f));
      heart(cx, cy + U * 0.02, U * 0.26 * s, '#e8475a');
      if (f > 0 && f < 1) for (var i = 0; i < 12; i++) { var a = (i / 12) * Math.PI * 2, d = U * (0.28 + f * 0.2); disc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, U * 0.02 * (1 - f), i % 2 ? '#ffc53d' : '#e8475a', 0); }
      blob(cx - U * 0.1, cy - U * 0.1, U * 0.07, '255,255,255', 0.5);
    }),
    'speech-bubble': O(function (cx, cy) {
      shadow(cx, cy + U * 0.4, U * 0.3, U * 0.04);
      ctx.beginPath(); ctx.roundRect(cx - U * 0.38, cy - U * 0.3, U * 0.76, U * 0.48, U * 0.16); ctx.fillStyle = '#5aa9ff'; ctx.fill(); edge();
      poly([cx - U * 0.14, cy + U * 0.16, cx - U * 0.24, cy + U * 0.38, cx, cy + U * 0.17], '#5aa9ff', 0);
      line([cx - U * 0.14, cy + U * 0.17, cx - U * 0.24, cy + U * 0.38, cx, cy + U * 0.17], INK, U * 0.012);
      for (var i = -1; i <= 1; i++) disc(cx + i * U * 0.14, cy - U * 0.06, U * 0.05, '#f7f8fa', 0);
    }),
    'thumbs-up': O(function (cx, cy) {
      shadow(cx, cy + U * 0.42, U * 0.28, U * 0.04);
      box(cx - U * 0.36, cy - U * 0.02, U * 0.16, U * 0.4, U * 0.03, '#2d7ff9');
      ctx.beginPath(); ctx.moveTo(cx - U * 0.2, cy + U * 0.02); ctx.lineTo(cx - U * 0.04, cy - U * 0.08); ctx.quadraticCurveTo(cx, cy - U * 0.3, cx + U * 0.04, cy - U * 0.4); ctx.quadraticCurveTo(cx + U * 0.18, cy - U * 0.42, cx + U * 0.14, cy - U * 0.22); ctx.lineTo(cx + U * 0.1, cy - U * 0.08); ctx.lineTo(cx + U * 0.3, cy - U * 0.08); ctx.quadraticCurveTo(cx + U * 0.4, cy - U * 0.06, cx + U * 0.36, cy + U * 0.04); ctx.lineTo(cx + U * 0.28, cy + U * 0.34); ctx.quadraticCurveTo(cx + U * 0.26, cy + U * 0.38, cx + U * 0.2, cy + U * 0.38); ctx.lineTo(cx - U * 0.2, cy + U * 0.38); ctx.closePath(); ctx.fillStyle = '#ffd6a0'; ctx.fill(); edge();
      for (var i = 0; i < 3; i++) line([cx + U * 0.12, cy + U * 0.02 + i * U * 0.11, cx + U * 0.34 - i * U * 0.02, cy + U * 0.02 + i * U * 0.11], INK, U * 0.008);
    }),
    'music-notes-float': O(function (cx, cy) {
      var cols = ['#6f2dbd', '#2d7ff9', '#e8475a', '#ffc53d'];
      for (var i = 0; i < 4; i++) {
        var f = ((i / 4) + P) % 1, x = cx + Math.sin(f * 6 + i * 2) * U * 0.22, y = cy + U * 0.42 - f * U * 0.84, s = U * 0.08, a = (1 - f) * Math.min(1, f * 6);
        ctx.save(); ctx.globalAlpha = a;
        oval(x, y, s, s * 0.7, cols[i % 4], 0, -0.4); line([x + s * 0.8, y - s * 0.2, x + s * 0.8, y - s * 3], cols[i % 4], s * 0.3);
        if (i % 2) { oval(x + s * 2.4, y + s * 0.4, s, s * 0.7, cols[i % 4], 0, -0.4); line([x + s * 3.2, y + s * 0.2, x + s * 3.2, y - s * 2.6], cols[i % 4], s * 0.3); line([x + s * 0.8, y - s * 3, x + s * 3.2, y - s * 2.6], cols[i % 4], s * 0.5); }
        else { ctx.beginPath(); ctx.moveTo(x + s * 0.8, y - s * 3); ctx.quadraticCurveTo(x + s * 2.2, y - s * 2.6, x + s * 1.6, y - s * 1.4); ctx.strokeStyle = cols[i % 4]; ctx.lineWidth = s * 0.3; ctx.stroke(); }
        ctx.restore();
      }
    }),
    'vinyl-record-spin': O(function (cx, cy) {
      shadow(cx, cy + U * 0.4, U * 0.36, U * 0.05);
      disc(cx, cy, U * 0.42, '#1f232e');
      for (var i = 0; i < 10; i++) arc(cx, cy, U * (0.16 + i * 0.026), 0, Math.PI * 2, 'rgba(255,255,255,0.06)', U * 0.004);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(P * Math.PI * 2);
      disc(0, 0, U * 0.14, '#d93a4a', U * 0.008);
      line([-U * 0.1, 0, U * 0.1, 0], 'rgba(255,255,255,0.7)', U * 0.012); disc(0, 0, U * 0.02, '#f7f8fa', 0);
      ctx.restore();
      arc(cx, cy, U * 0.3, -Math.PI * 0.6, -Math.PI * 0.4, 'rgba(255,255,255,0.25)', U * 0.03); arc(cx, cy, U * 0.3, Math.PI * 0.4, Math.PI * 0.6, 'rgba(255,255,255,0.25)', U * 0.03);
    }),
    'clapperboard': O(function (cx, cy) {
      shadow(cx, cy + U * 0.4, U * 0.36, U * 0.05);
      box(cx - U * 0.36, cy - U * 0.1, U * 0.72, U * 0.5, U * 0.02, '#1f232e');
      for (var i = 0; i < 3; i++) line([cx - U * 0.28, cy + U * (0.02 + i * 0.12), cx + U * 0.28, cy + U * (0.02 + i * 0.12)], '#f7f8fa', U * 0.012);
      ctx.save(); ctx.translate(cx - U * 0.36, cy - U * 0.1); ctx.rotate(-0.3);
      box(0, -U * 0.16, U * 0.74, U * 0.16, U * 0.02, '#1f232e');
      for (var k = 0; k < 5; k++) poly([U * 0.04 + k * U * 0.15, -U * 0.16, U * 0.12 + k * U * 0.15, -U * 0.16, U * 0.08 + k * U * 0.15, 0, U * 0.0 + k * U * 0.15, 0], '#f7f8fa', 0);
      ctx.restore();
    }),
    'popcorn-bucket': O(function (cx, cy) {
      shadow(cx, cy + U * 0.42, U * 0.3, U * 0.05);
      for (var i = 0; i < 9; i++) { var a = (i / 9) * Math.PI * 2; var x = cx + Math.cos(a) * U * 0.16 * (i % 2 ? 1 : 0.5), y = cy - U * 0.2 + Math.sin(a) * U * 0.08 - (i % 2 ? 0 : U * 0.1); disc(x, y, U * 0.07, '#fff3c4', U * 0.008); disc(x - U * 0.03, y + U * 0.02, U * 0.045, '#ffe08a', 0); }
      poly([cx - U * 0.3, cy - U * 0.14, cx + U * 0.3, cy - U * 0.14, cx + U * 0.24, cy + U * 0.42, cx - U * 0.24, cy + U * 0.42], '#f7f8fa');
      ctx.save(); ctx.beginPath(); ctx.moveTo(cx - U * 0.3, cy - U * 0.14); ctx.lineTo(cx + U * 0.3, cy - U * 0.14); ctx.lineTo(cx + U * 0.24, cy + U * 0.42); ctx.lineTo(cx - U * 0.24, cy + U * 0.42); ctx.closePath(); ctx.clip(); ctx.fillStyle = '#d93a4a'; for (var k = -3; k <= 3; k += 2) ctx.fillRect(cx + k * U * 0.08 - U * 0.04, cy - U * 0.2, U * 0.08, U * 0.7); ctx.restore();
      box(cx - U * 0.32, cy - U * 0.18, U * 0.64, U * 0.08, U * 0.01, '#f7f8fa');
    }),
    'teddy-bear': O(function (cx, cy) {
      shadow(cx, cy + U * 0.42, U * 0.3, U * 0.05);
      disc(cx - U * 0.2, cy - U * 0.26, U * 0.1, '#c8955a'); disc(cx + U * 0.2, cy - U * 0.26, U * 0.1, '#c8955a'); disc(cx - U * 0.2, cy - U * 0.26, U * 0.05, '#e8c39e', 0); disc(cx + U * 0.2, cy - U * 0.26, U * 0.05, '#e8c39e', 0);
      oval(cx - U * 0.26, cy + U * 0.1, U * 0.09, U * 0.16, '#c8955a', U * 0.012, 0.4); oval(cx + U * 0.26, cy + U * 0.1, U * 0.09, U * 0.16, '#c8955a', U * 0.012, -0.4);
      oval(cx - U * 0.12, cy + U * 0.36, U * 0.1, U * 0.08, '#c8955a'); oval(cx + U * 0.12, cy + U * 0.36, U * 0.1, U * 0.08, '#c8955a');
      oval(cx, cy + U * 0.14, U * 0.22, U * 0.24, '#c8955a'); oval(cx, cy + U * 0.18, U * 0.12, U * 0.14, '#e8c39e', 0);
      disc(cx, cy - U * 0.14, U * 0.22, '#c8955a');
      oval(cx, cy - U * 0.06, U * 0.1, U * 0.07, '#e8c39e', 0); disc(cx, cy - U * 0.09, U * 0.03, '#1f232e', 0);
      disc(cx - U * 0.08, cy - U * 0.18, U * 0.025, '#1f232e', 0); disc(cx + U * 0.08, cy - U * 0.18, U * 0.025, '#1f232e', 0);
      poly([cx - U * 0.06, cy + U * 0.06, cx + U * 0.06, cy + U * 0.06, cx, cy + U * 0.1], '#d93a4a', 0); poly([cx - U * 0.06, cy + U * 0.06, cx - U * 0.12, cy + U * 0.02, cx - U * 0.1, cy + U * 0.1], '#d93a4a', 0); poly([cx + U * 0.06, cy + U * 0.06, cx + U * 0.12, cy + U * 0.02, cx + U * 0.1, cy + U * 0.1], '#d93a4a', 0);
    }),
    'lipstick': O(function (cx, cy) {
      shadow(cx, cy + U * 0.44, U * 0.14, U * 0.03);
      box(cx - U * 0.12, cy + U * 0.02, U * 0.24, U * 0.42, U * 0.02, '#1f232e');
      box(cx - U * 0.12, cy + U * 0.02, U * 0.24, U * 0.08, U * 0.01, '#e2b23a', 0);
      box(cx - U * 0.09, cy - U * 0.12, U * 0.18, U * 0.16, U * 0.01, '#9aa3b2');
      ctx.beginPath(); ctx.moveTo(cx - U * 0.07, cy - U * 0.12); ctx.lineTo(cx - U * 0.07, cy - U * 0.32); ctx.lineTo(cx + U * 0.07, cy - U * 0.42); ctx.lineTo(cx + U * 0.07, cy - U * 0.12); ctx.closePath(); ctx.fillStyle = '#e8475a'; ctx.fill(); edge();
      blob(cx - U * 0.03, cy - U * 0.24, U * 0.03, '255,255,255', 0.5);
    }),
    'high-heel': O(function (cx, cy) {
      shadow(cx, cy + U * 0.38, U * 0.36, U * 0.05);
      ctx.beginPath(); ctx.moveTo(cx - U * 0.34, cy - U * 0.24); ctx.quadraticCurveTo(cx - U * 0.1, cy - U * 0.1, cx + U * 0.1, cy + U * 0.14); ctx.quadraticCurveTo(cx + U * 0.26, cy + U * 0.26, cx + U * 0.4, cy + U * 0.28); ctx.lineTo(cx + U * 0.38, cy + U * 0.36); ctx.lineTo(cx + U * 0.1, cy + U * 0.3); ctx.quadraticCurveTo(cx - U * 0.1, cy + U * 0.22, cx - U * 0.26, cy + U * 0.2); ctx.lineTo(cx - U * 0.3, cy + U * 0.36); ctx.lineTo(cx - U * 0.36, cy + U * 0.36); ctx.lineTo(cx - U * 0.36, cy - U * 0.2); ctx.closePath(); ctx.fillStyle = '#d93a4a'; ctx.fill(); edge();
      line([cx - U * 0.3, cy - U * 0.2, cx - U * 0.1, cy - U * 0.04], 'rgba(255,255,255,0.3)', U * 0.03);
    }),
    'handbag': O(function (cx, cy) {
      shadow(cx, cy + U * 0.4, U * 0.34, U * 0.05);
      arc(cx, cy - U * 0.1, U * 0.18, Math.PI, Math.PI * 2, '#6b4a2b', U * 0.03);
      ctx.beginPath(); ctx.moveTo(cx - U * 0.28, cy - U * 0.1); ctx.lineTo(cx + U * 0.28, cy - U * 0.1); ctx.quadraticCurveTo(cx + U * 0.36, cy - U * 0.1, cx + U * 0.34, cy); ctx.lineTo(cx + U * 0.3, cy + U * 0.34); ctx.quadraticCurveTo(cx + U * 0.3, cy + U * 0.4, cx + U * 0.24, cy + U * 0.4); ctx.lineTo(cx - U * 0.24, cy + U * 0.4); ctx.quadraticCurveTo(cx - U * 0.3, cy + U * 0.4, cx - U * 0.3, cy + U * 0.34); ctx.lineTo(cx - U * 0.34, cy); ctx.quadraticCurveTo(cx - U * 0.36, cy - U * 0.1, cx - U * 0.28, cy - U * 0.1); ctx.closePath(); ctx.fillStyle = '#e8475a'; ctx.fill(); edge();
      box(cx - U * 0.34, cy - U * 0.02, U * 0.68, U * 0.05, 0, 'rgba(0,0,0,0.15)', 0);
      box(cx - U * 0.05, cy + U * 0.04, U * 0.1, U * 0.08, U * 0.02, '#e2b23a');
    }),
    // ===== Nature objects
    'green-leaf': O(function (cx, cy) {
      shadow(cx, cy + U * 0.36, U * 0.3, U * 0.05);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(0.6);
      ctx.beginPath(); ctx.moveTo(0, -U * 0.4); ctx.quadraticCurveTo(U * 0.36, -U * 0.1, 0, U * 0.4); ctx.quadraticCurveTo(-U * 0.36, -U * 0.1, 0, -U * 0.4); ctx.closePath(); ctx.fillStyle = '#4fa86a'; ctx.fill(); edge();
      line([0, -U * 0.36, 0, U * 0.46], '#2d7a4f', U * 0.015);
      for (var i = 1; i <= 5; i++) { var y = -U * 0.3 + i * U * 0.1; line([0, y, U * (0.22 - i * 0.02), y - U * 0.1], '#2d7a4f', U * 0.008); line([0, y, -U * (0.22 - i * 0.02), y - U * 0.1], '#2d7a4f', U * 0.008); }
      ctx.restore();
    }),
    'butterfly-flap': O(function (cx, cy) {
      var sq = 0.45 + 0.55 * Math.abs(Math.cos(P * Math.PI * 2 * 2));
      shadow(cx, cy + U * 0.38, U * 0.3 * sq, U * 0.04);
      for (var i = -1; i <= 1; i += 2) {
        ctx.save(); ctx.translate(cx, cy); ctx.scale(i * sq, 1);
        ctx.beginPath(); ctx.moveTo(0, -U * 0.02); ctx.bezierCurveTo(U * 0.2, -U * 0.5, U * 0.5, -U * 0.3, U * 0.26, U * 0.02); ctx.bezierCurveTo(U * 0.4, U * 0.3, U * 0.1, U * 0.4, 0, U * 0.1); ctx.closePath(); ctx.fillStyle = '#ff7a59'; ctx.fill(); edge();
        disc(U * 0.2, -U * 0.14, U * 0.05, '#ffd23d', U * 0.006); disc(U * 0.16, U * 0.16, U * 0.035, '#f7f8fa', U * 0.006);
        ctx.restore();
      }
      oval(cx, cy + U * 0.02, U * 0.03, U * 0.18, '#1f232e');
      line([cx, cy - U * 0.14, cx - U * 0.08, cy - U * 0.3], '#1f232e', U * 0.008); line([cx, cy - U * 0.14, cx + U * 0.08, cy - U * 0.3], '#1f232e', U * 0.008);
    }),
    'fish-swim': O(function (cx, cy) {
      var x = cx + Math.sin(P * Math.PI * 2) * U * 0.06, y = cy + Math.sin(P * Math.PI * 4) * U * 0.03, tail = Math.sin(P * Math.PI * 8) * 0.3;
      shadow(cx, cy + U * 0.36, U * 0.32, U * 0.05);
      ctx.save(); ctx.translate(x - U * 0.26, y); ctx.rotate(tail); poly([0, 0, -U * 0.18, -U * 0.14, -U * 0.14, 0, -U * 0.18, U * 0.14], '#2d7ff9'); ctx.restore();
      oval(x, y, U * 0.3, U * 0.17, '#5aa9ff');
      poly([x - U * 0.1, y - U * 0.14, x + U * 0.04, y - U * 0.3, x + U * 0.1, y - U * 0.14], '#2d7ff9');
      ctx.save(); ctx.beginPath(); ctx.ellipse(x, y, U * 0.3, U * 0.17, 0, 0, Math.PI * 2); ctx.clip(); for (var i = 0; i < 3; i++) arc(x - U * 0.1 + i * U * 0.1, y, U * 0.12, -Math.PI / 2, Math.PI / 2, 'rgba(0,0,0,0.15)', U * 0.012); ctx.restore();
      disc(x + U * 0.18, y - U * 0.04, U * 0.035, '#f7f8fa', U * 0.006); disc(x + U * 0.19, y - U * 0.04, U * 0.018, '#1f232e', 0);
    }),
    'scallop-shell': O(function (cx, cy) {
      shadow(cx, cy + U * 0.36, U * 0.34, U * 0.05);
      ctx.beginPath(); ctx.moveTo(cx, cy + U * 0.3);
      for (var i = 0; i <= 10; i++) { var a = Math.PI + (i / 10) * Math.PI, r = U * 0.36; var x = cx + Math.cos(a) * r, y = cy + U * 0.02 + Math.sin(a) * r; if (i > 0) { var pa = Math.PI + ((i - 0.5) / 10) * Math.PI; ctx.quadraticCurveTo(cx + Math.cos(pa) * r * 1.1, cy + U * 0.02 + Math.sin(pa) * r * 1.1, x, y); } else ctx.lineTo(x, y); }
      ctx.closePath(); ctx.fillStyle = '#ffd6a0'; ctx.fill(); edge();
      for (var k = 1; k < 10; k++) { var b = Math.PI + (k / 10) * Math.PI; line([cx, cy + U * 0.3, cx + Math.cos(b) * U * 0.34, cy + U * 0.02 + Math.sin(b) * U * 0.34], 'rgba(170,110,60,0.45)', U * 0.01); }
      box(cx - U * 0.08, cy + U * 0.26, U * 0.16, U * 0.08, U * 0.02, '#e8b47a');
    }),
    'planet-rings': O(function (cx, cy) {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.4);
      ctx.beginPath(); ctx.ellipse(0, 0, U * 0.46, U * 0.12, 0, Math.PI, 0); ctx.strokeStyle = '#e2b23a'; ctx.lineWidth = U * 0.05; ctx.stroke();
      disc(0, 0, U * 0.24, '#ff9f5a');
      ctx.save(); ctx.beginPath(); ctx.arc(0, 0, U * 0.24, 0, Math.PI * 2); ctx.clip(); for (var i = -2; i <= 2; i++) { ctx.fillStyle = i % 2 ? 'rgba(200,90,40,0.35)' : 'rgba(255,230,180,0.3)'; ctx.fillRect(-U * 0.3, i * U * 0.09 - U * 0.03, U * 0.6, U * 0.06); } ctx.restore();
      ctx.beginPath(); ctx.ellipse(0, 0, U * 0.46, U * 0.12, 0, 0, Math.PI); ctx.strokeStyle = '#f2c94c'; ctx.lineWidth = U * 0.05; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0, 0, U * 0.46, U * 0.12, 0, 0, Math.PI * 2); ctx.strokeStyle = INK; ctx.lineWidth = U * 0.006; ctx.stroke();
      ctx.restore();
    }),
    'rocket-launch': O(function (cx, cy) {
      var f = P, y = cy + U * 0.1 - f * f * U * 1.2;
      if (f < 0.5) shadow(cx, cy + U * 0.44, U * 0.2 * (1 - f * 2), U * 0.04);
      if (f > 0) for (var i = 0; i < 16; i++) { var g = ((hash(i) + f * 2) % 1); puff(cx + (hash(i + 3) - 0.5) * U * 0.3 * (1 + g), y + U * 0.36 + g * U * 0.3, U * (0.04 + g * 0.08), (1 - g) * 0.5, '220,220,225'); }
      ctx.beginPath(); ctx.moveTo(cx, y - U * 0.42); ctx.quadraticCurveTo(cx + U * 0.16, y - U * 0.2, cx + U * 0.14, y + U * 0.24); ctx.lineTo(cx - U * 0.14, y + U * 0.24); ctx.quadraticCurveTo(cx - U * 0.16, y - U * 0.2, cx, y - U * 0.42); ctx.closePath(); ctx.fillStyle = '#f7f8fa'; ctx.fill(); edge();
      poly([cx - U * 0.14, y + U * 0.06, cx - U * 0.28, y + U * 0.3, cx - U * 0.14, y + U * 0.24], '#d93a4a'); poly([cx + U * 0.14, y + U * 0.06, cx + U * 0.28, y + U * 0.3, cx + U * 0.14, y + U * 0.24], '#d93a4a');
      disc(cx, y - U * 0.1, U * 0.07, '#5aa9ff'); poly([cx, y - U * 0.42, cx + U * 0.1, y - U * 0.26, cx - U * 0.1, y - U * 0.26], '#d93a4a');
      flame(cx, y + U * 0.3 + U * 0.3, U * 0.3 * (0.5 + f), U * 0.08, 0.2, 0.9);
    }),
    'comet-streak': function (W, H) {
      for (var i = 0; i < 20; i++) { var f = i / 20; blob(W * (0.72 - f * 0.68), H * (0.3 + f * 0.45), H * (0.14 - f * 0.11), f < 0.3 ? '220,240,255' : '120,170,255', (1 - f) * 0.5); }
      disc(W * 0.72, H * 0.3, H * 0.13, '#e6f0ff');
      ballShade(W * 0.72, H * 0.3, H * 0.13);
      for (var k = 0; k < 10; k++) star(W * hash(k), H * hash(k + 3), H * 0.02, H * 0.008, 4, 'rgba(255,255,255,0.8)', 0);
    },
    'rainbow-arc': function (W, H) {
      var cols = ['#d93a4a', '#ff7a59', '#ffd23d', '#4fd1a5', '#2d7ff9', '#6f2dbd'];
      for (var i = 0; i < 6; i++) arc(W / 2, H * 0.95, H * (0.85 - i * 0.07), Math.PI, Math.PI * 2, cols[i], H * 0.07);
      for (var k = -1; k <= 1; k += 2) { var x = W / 2 + k * H * 0.82; puff(x, H * 0.95, H * 0.16, 1.4, '245,247,250'); disc(x - k * H * 0.08, H * 0.9, H * 0.12, '#f7f8fa', 0); disc(x + k * H * 0.1, H * 0.9, H * 0.1, '#f7f8fa', 0); }
    },
    'umbrella-open': O(function (cx, cy) {
      shadow(cx, cy + U * 0.44, U * 0.12, U * 0.03);
      line([cx, cy - U * 0.02, cx, cy + U * 0.36], '#3a3f4a', U * 0.02); arc(cx + U * 0.06, cy + U * 0.36, U * 0.06, 0, Math.PI, '#3a3f4a', U * 0.02);
      ctx.beginPath(); ctx.moveTo(cx - U * 0.42, cy); for (var i = 0; i < 6; i++) { var x0 = cx - U * 0.42 + i * U * 0.14, x1 = x0 + U * 0.14; ctx.quadraticCurveTo((x0 + x1) / 2, cy + U * 0.06, x1, cy); } ctx.lineTo(cx + U * 0.42, cy); ctx.arc(cx, cy, U * 0.42, 0, Math.PI, true); ctx.closePath(); ctx.fillStyle = '#d93a4a'; ctx.fill(); edge();
      ctx.save(); ctx.clip(); for (var k = 0; k < 6; k += 2) { ctx.fillStyle = '#f7f8fa'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx - U * 0.42 + k * U * 0.14, cy + U * 0.1); ctx.lineTo(cx - U * 0.42 + (k + 1) * U * 0.14, cy + U * 0.1); ctx.closePath(); ctx.fill(); } ctx.restore();
      disc(cx, cy - U * 0.42, U * 0.02, '#3a3f4a', 0);
    }),
    // ===== Travel objects
    'aeroplane-fly': function (W, H) {
      var x = W * (0.5 + Math.sin(P * Math.PI * 2) * 0.06), y = H * (0.5 + Math.sin(P * Math.PI * 4) * 0.03);
      for (var i = 0; i < 12; i++) { var f = i / 12; blob(x - H * 0.5 - f * W * 0.4, y + H * 0.04, H * 0.04 * (1 - f * 0.4), '240,245,255', (1 - f) * 0.5); }
      ctx.save(); ctx.translate(x, y);
      poly([-H * 0.12, 0, -H * 0.46, H * 0.2, -H * 0.4, H * 0.22, H * 0.02, H * 0.06], '#9aa3b2');
      poly([-H * 0.3, -H * 0.02, -H * 0.5, -H * 0.24, -H * 0.42, -H * 0.24, -H * 0.2, -H * 0.04], '#d93a4a');
      ctx.beginPath(); ctx.moveTo(-H * 0.5, 0); ctx.quadraticCurveTo(-H * 0.2, -H * 0.12, H * 0.3, -H * 0.08); ctx.quadraticCurveTo(H * 0.52, -H * 0.04, H * 0.5, H * 0.02); ctx.quadraticCurveTo(H * 0.2, H * 0.12, -H * 0.5, H * 0.08); ctx.closePath(); ctx.fillStyle = '#f7f8fa'; ctx.fill(); edge();
      poly([-H * 0.06, H * 0.02, -H * 0.3, H * 0.34, -H * 0.18, H * 0.34, H * 0.1, H * 0.06], '#d93a4a');
      for (var k = 0; k < 6; k++) disc(-H * 0.2 + k * H * 0.09, -H * 0.03, H * 0.02, '#5aa9ff', 0);
      poly([H * 0.3, -H * 0.07, H * 0.44, -H * 0.04, H * 0.3, -H * 0.02], '#5aa9ff', 0);
      ctx.restore();
    },
    'suitcase': O(function (cx, cy) {
      shadow(cx, cy + U * 0.4, U * 0.36, U * 0.06);
      box(cx - U * 0.14, cy - U * 0.4, U * 0.28, U * 0.14, U * 0.03, 'rgba(0,0,0,0)', U * 0.03);
      box(cx - U * 0.34, cy - U * 0.28, U * 0.68, U * 0.62, U * 0.05, '#d9742b');
      box(cx - U * 0.34, cy - U * 0.28, U * 0.68, U * 0.12, U * 0.05, '#c45f1c', 0);
      line([cx - U * 0.14, cy - U * 0.28, cx - U * 0.14, cy + U * 0.34], 'rgba(0,0,0,0.2)', U * 0.03); line([cx + U * 0.14, cy - U * 0.28, cx + U * 0.14, cy + U * 0.34], 'rgba(0,0,0,0.2)', U * 0.03);
      ctx.save(); ctx.translate(cx - U * 0.02, cy + U * 0.06); ctx.rotate(-0.2); box(-U * 0.14, -U * 0.08, U * 0.28, U * 0.16, U * 0.02, '#f7f1e6', U * 0.008); ctx.fillStyle = '#d93a4a'; ctx.font = 'bold ' + Math.round(U * 0.08) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('PARIS', 0, 0); ctx.restore();
      disc(cx + U * 0.22, cy + U * 0.2, U * 0.05, '#5aa9ff', U * 0.008);
    }),
    'compass-rose': O(function (cx, cy) {
      shadow(cx, cy + U * 0.4, U * 0.36, U * 0.05);
      disc(cx, cy, U * 0.4, '#e2b23a'); disc(cx, cy, U * 0.34, '#f7f4ec', U * 0.008);
      ctx.fillStyle = '#3a3f4a'; ctx.font = 'bold ' + Math.round(U * 0.08) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('N', cx, cy - U * 0.27); ctx.fillText('S', cx, cy + U * 0.27); ctx.fillText('E', cx + U * 0.27, cy); ctx.fillText('W', cx - U * 0.27, cy);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.6); poly([0, -U * 0.22, U * 0.05, 0, 0, U * 0.22, -U * 0.05, 0], '#f7f4ec', U * 0.008); poly([0, -U * 0.22, U * 0.05, 0, -U * 0.05, 0], '#d93a4a', 0); ctx.restore();
      disc(cx, cy, U * 0.03, '#3a3f4a', 0);
    }),
    'traffic-light-cycle': O(function (cx, cy) {
      var step = Math.floor(P * 3), lit = ['#d93a4a', '#ffc53d', '#4fd1a5'];
      shadow(cx, cy + U * 0.44, U * 0.1, U * 0.025);
      line([cx, cy + U * 0.3, cx, cy + U * 0.44], '#3a3f4a', U * 0.04);
      box(cx - U * 0.16, cy - U * 0.44, U * 0.32, U * 0.76, U * 0.05, '#2c3040');
      for (var i = 0; i < 3; i++) { var y = cy - U * 0.3 + i * U * 0.24, on = (P === 0 ? i === 0 : i === step); disc(cx, y, U * 0.09, on ? lit[i] : 'rgba(255,255,255,0.08)', U * 0.008); if (on) blob(cx, y, U * 0.16, lit[i].replace('#', '').match(/../g).map(function (h) { return parseInt(h, 16); }).join(','), 0.35); }
    }),
    'map-pin-drop': O(function (cx, cy) {
      var f = P === 0 ? 1 : Math.min(1, P * 1.6), y = cy - (1 - f) * U * 0.8, b = f >= 1 && P > 0 && P < 0.9 ? Math.sin((P - 0.625) / 0.275 * Math.PI) * 0.06 : 0;
      shadow(cx, cy + U * 0.38, U * 0.14 * f, U * 0.03 * f);
      if (P > 0.62) { var g = Math.min(1, (P - 0.62) / 0.38); arc(cx, cy + U * 0.38, U * 0.1 + g * U * 0.26, 0, Math.PI * 2, rgba('217,58,74', (1 - g) * 0.7), U * 0.015); }
      ctx.save(); ctx.translate(cx, y + U * 0.38); ctx.scale(1 - b, 1 + b); ctx.translate(-cx, -(y + U * 0.38));
      ctx.beginPath(); ctx.moveTo(cx, y + U * 0.38); ctx.bezierCurveTo(cx - U * 0.3, y - U * 0.02, cx - U * 0.24, y - U * 0.34, cx, y - U * 0.34); ctx.bezierCurveTo(cx + U * 0.24, y - U * 0.34, cx + U * 0.3, y - U * 0.02, cx, y + U * 0.38); ctx.closePath(); ctx.fillStyle = '#d93a4a'; ctx.fill(); edge();
      disc(cx, y - U * 0.1, U * 0.1, '#f7f8fa', U * 0.008);
      ctx.restore();
    }),
    'street-lamp': O(function (cx, cy) {
      shadow(cx, cy + U * 0.44, U * 0.14, U * 0.03);
      box(cx - U * 0.1, cy + U * 0.38, U * 0.2, U * 0.06, U * 0.01, '#2c3040');
      line([cx, cy + U * 0.38, cx, cy - U * 0.26], '#2c3040', U * 0.03);
      blob(cx, cy - U * 0.3, U * 0.26, '255,230,150', 0.3);
      poly([cx - U * 0.14, cy - U * 0.16, cx + U * 0.14, cy - U * 0.16, cx + U * 0.1, cy - U * 0.36, cx - U * 0.1, cy - U * 0.36], '#ffe08a');
      poly([cx - U * 0.16, cy - U * 0.36, cx + U * 0.16, cy - U * 0.36, cx, cy - U * 0.46], '#2c3040');
      line([cx - U * 0.14, cy - U * 0.16, cx + U * 0.14, cy - U * 0.16], '#2c3040', U * 0.025);
    }),
    // ===== Home objects
    'coffee-cup-steam': O(function (cx, cy) {
      shadow(cx, cy + U * 0.42, U * 0.3, U * 0.05);
      oval(cx, cy + U * 0.38, U * 0.32, U * 0.06, '#e6e9ef');
      arc(cx + U * 0.26, cy + U * 0.12, U * 0.1, -Math.PI / 2, Math.PI / 2, '#f7f8fa', U * 0.05);
      ctx.beginPath(); ctx.moveTo(cx - U * 0.24, cy - U * 0.04); ctx.lineTo(cx + U * 0.24, cy - U * 0.04); ctx.lineTo(cx + U * 0.18, cy + U * 0.36); ctx.lineTo(cx - U * 0.18, cy + U * 0.36); ctx.closePath(); ctx.fillStyle = '#f7f8fa'; ctx.fill(); edge();
      oval(cx, cy - U * 0.04, U * 0.24, U * 0.06, '#6b4a2b');
      for (var i = 0; i < 3; i++) { for (var k = 0; k < 6; k++) { var f = ((k / 6) + P) % 1; puff(cx - U * 0.12 + i * U * 0.12 + Math.sin(f * 5 + i) * U * 0.03, cy - U * 0.14 - f * U * 0.3, U * (0.025 + f * 0.03), (1 - f) * 0.35 * Math.min(1, f * 5), '240,240,245'); } }
    }),
    'pizza-slice': O(function (cx, cy) {
      shadow(cx, cy + U * 0.4, U * 0.3, U * 0.05);
      poly([cx - U * 0.32, cy - U * 0.3, cx + U * 0.32, cy - U * 0.3, cx, cy + U * 0.42], '#f2c94c');
      ctx.beginPath(); ctx.moveTo(cx - U * 0.34, cy - U * 0.32); ctx.quadraticCurveTo(cx, cy - U * 0.44, cx + U * 0.34, cy - U * 0.32); ctx.lineTo(cx + U * 0.3, cy - U * 0.24); ctx.quadraticCurveTo(cx, cy - U * 0.34, cx - U * 0.3, cy - U * 0.24); ctx.closePath(); ctx.fillStyle = '#d9a066'; ctx.fill(); edge();
      disc(cx - U * 0.1, cy - U * 0.12, U * 0.06, '#d93a4a', U * 0.006); disc(cx + U * 0.12, cy - U * 0.14, U * 0.06, '#d93a4a', U * 0.006); disc(cx, cy + U * 0.08, U * 0.06, '#d93a4a', U * 0.006);
      leaf(cx + U * 0.04, cy - U * 0.04, U * 0.05, 0.8, '#2d9c6f'); leaf(cx - U * 0.06, cy + U * 0.16, U * 0.04, -0.5, '#2d9c6f');
    }),
    'cupcake': O(function (cx, cy) {
      shadow(cx, cy + U * 0.42, U * 0.26, U * 0.05);
      poly([cx - U * 0.26, cy + U * 0.04, cx + U * 0.26, cy + U * 0.04, cx + U * 0.18, cy + U * 0.42, cx - U * 0.18, cy + U * 0.42], '#f9a8d4');
      for (var i = -2; i <= 2; i++) line([cx + i * U * 0.1, cy + U * 0.06, cx + i * U * 0.075, cy + U * 0.4], 'rgba(0,0,0,0.12)', U * 0.02);
      disc(cx - U * 0.14, cy - U * 0.02, U * 0.13, '#fde2ea'); disc(cx + U * 0.14, cy - U * 0.02, U * 0.13, '#fde2ea'); disc(cx, cy - U * 0.14, U * 0.15, '#fde2ea'); disc(cx, cy - U * 0.3, U * 0.1, '#fde2ea');
      disc(cx, cy - U * 0.42, U * 0.05, '#d93a4a');
      for (var k = 0; k < 8; k++) box(cx + (hash(k) - 0.5) * U * 0.4, cy - U * 0.3 + hash(k + 3) * U * 0.3, U * 0.03, U * 0.012, U * 0.005, ['#5aa9ff', '#ffc53d', '#4fd1a5'][k % 3], 0);
    }),
    'house-plant': O(function (cx, cy) {
      shadow(cx, cy + U * 0.44, U * 0.24, U * 0.04);
      poly([cx - U * 0.22, cy + U * 0.1, cx + U * 0.22, cy + U * 0.1, cx + U * 0.16, cy + U * 0.44, cx - U * 0.16, cy + U * 0.44], '#d9742b');
      box(cx - U * 0.24, cy + U * 0.04, U * 0.48, U * 0.08, U * 0.01, '#c45f1c');
      for (var i = 0; i < 7; i++) { var a = -Math.PI / 2 + (i - 3) * 0.42; var len = U * (0.3 + (i % 2) * 0.1); leaf(cx + Math.cos(a) * len * 0.6, cy + U * 0.02 + Math.sin(a) * len * 0.6, len * 0.5, a + Math.PI / 2, i % 2 ? '#4fa86a' : '#2d7a4f'); }
    }),
    'table-lamp': O(function (cx, cy) {
      shadow(cx, cy + U * 0.44, U * 0.2, U * 0.04);
      oval(cx, cy + U * 0.4, U * 0.18, U * 0.05, '#3a3f4a');
      line([cx, cy + U * 0.4, cx, cy - U * 0.04], '#6b7280', U * 0.03);
      blob(cx, cy - U * 0.06, U * 0.36, '255,230,150', 0.25);
      poly([cx - U * 0.14, cy - U * 0.4, cx + U * 0.14, cy - U * 0.4, cx + U * 0.3, cy - U * 0.02, cx - U * 0.3, cy - U * 0.02], '#ffd6a0');
      box(cx - U * 0.3, cy - U * 0.04, U * 0.6, U * 0.03, 0, 'rgba(0,0,0,0.15)', 0);
    }),
    'toaster-pop': O(function (cx, cy) {
      var f = P === 0 ? 0 : Math.min(1, P * 2.5), up = f < 0.6 ? Math.sin(f / 0.6 * Math.PI / 2) : 1 - (f - 0.6) / 0.4 * 0.15;
      shadow(cx, cy + U * 0.42, U * 0.36, U * 0.06);
      for (var i = -1; i <= 1; i += 2) { var x = cx + i * U * 0.14, y = cy - U * 0.06 - up * U * 0.3; box(x - U * 0.11, y - U * 0.12, U * 0.22, U * 0.3, U * 0.06, '#d9a066'); box(x - U * 0.08, y - U * 0.08, U * 0.16, U * 0.22, U * 0.04, '#e8c39e', 0); }
      box(cx - U * 0.36, cy - U * 0.04, U * 0.72, U * 0.44, U * 0.06, '#c0c6d2');
      box(cx - U * 0.36, cy - U * 0.04, U * 0.72, U * 0.1, U * 0.04, '#9aa3b2', 0);
      box(cx - U * 0.28, cy - U * 0.03, U * 0.24, U * 0.03, 0, '#1f232e', 0); box(cx + U * 0.04, cy - U * 0.03, U * 0.24, U * 0.03, 0, '#1f232e', 0);
      box(cx + U * 0.34, cy + U * 0.06 + (1 - up) * U * 0.14, U * 0.06, U * 0.06, U * 0.01, '#3a3f4a');
      disc(cx - U * 0.26, cy + U * 0.26, U * 0.04, '#3a3f4a');
    }),
    // ===== Community objects
    'candle-pair': O(function (cx, cy) {
      shadow(cx, cy + U * 0.42, U * 0.3, U * 0.05);
      for (var i = -1; i <= 1; i += 2) { var x = cx + i * U * 0.14, h = i < 0 ? U * 0.4 : U * 0.3; box(x - U * 0.07, cy + U * 0.42 - h, U * 0.14, h, U * 0.015, '#f7f1e6'); line([x, cy + U * 0.42 - h, x, cy + U * 0.36 - h], '#3a3f4a', U * 0.01); blob(x, cy + U * 0.3 - h, U * 0.14, '255,210,130', 0.25 + 0.06 * Math.sin(P * Math.PI * 4 + i)); candleFlame(x, cy + U * 0.38 - h, U * 0.14, U * 0.03, i + 2); }
    }),
    'church-bell': O(function (cx, cy) {
      shadow(cx, cy + U * 0.42, U * 0.3, U * 0.05);
      box(cx - U * 0.05, cy - U * 0.44, U * 0.1, U * 0.08, U * 0.02, '#6b4a2b');
      ctx.beginPath(); ctx.moveTo(cx - U * 0.12, cy - U * 0.36); ctx.quadraticCurveTo(cx - U * 0.14, cy + 0, cx - U * 0.32, cy + U * 0.22); ctx.lineTo(cx + U * 0.32, cy + U * 0.22); ctx.quadraticCurveTo(cx + U * 0.14, cy + 0, cx + U * 0.12, cy - U * 0.36); ctx.closePath(); ctx.fillStyle = '#e2b23a'; ctx.fill(); edge();
      box(cx - U * 0.34, cy + U * 0.2, U * 0.68, U * 0.08, U * 0.02, '#c8955a');
      disc(cx, cy + U * 0.34, U * 0.07, '#8a5a32');
      blob(cx - U * 0.06, cy - U * 0.1, U * 0.08, '255,255,255', 0.3);
    }),
    'pencil-and-ruler': O(function (cx, cy) {
      shadow(cx, cy + U * 0.36, U * 0.4, U * 0.06);
      ctx.save(); ctx.translate(cx, cy + U * 0.1); ctx.rotate(-0.3);
      box(-U * 0.42, -U * 0.08, U * 0.84, U * 0.16, U * 0.01, '#f2c94c');
      for (var i = 0; i <= 16; i++) line([-U * 0.4 + i * U * 0.05, -U * 0.08, -U * 0.4 + i * U * 0.05, -U * 0.08 + (i % 4 ? U * 0.04 : U * 0.07)], '#3a3f4a', U * 0.006);
      ctx.restore();
      ctx.save(); ctx.translate(cx, cy - U * 0.14); ctx.rotate(-0.3);
      box(-U * 0.32, -U * 0.06, U * 0.56, U * 0.12, 0, '#ff9f5a');
      poly([U * 0.24, -U * 0.06, U * 0.38, 0, U * 0.24, U * 0.06], '#ffd6a0'); poly([U * 0.32, -U * 0.025, U * 0.38, 0, U * 0.32, U * 0.025], '#1f232e', 0);
      box(-U * 0.4, -U * 0.06, U * 0.08, U * 0.12, U * 0.02, '#f08cb4'); box(-U * 0.32, -U * 0.06, U * 0.04, U * 0.12, 0, '#9aa3b2', 0);
      ctx.restore();
    }),
    'red-apple': O(function (cx, cy) {
      shadow(cx, cy + U * 0.4, U * 0.3, U * 0.05);
      ctx.beginPath(); ctx.moveTo(cx, cy - U * 0.2); ctx.bezierCurveTo(cx - U * 0.4, cy - U * 0.44, cx - U * 0.46, cy + U * 0.3, cx - U * 0.08, cy + U * 0.36); ctx.quadraticCurveTo(cx, cy + U * 0.3, cx + U * 0.08, cy + U * 0.36); ctx.bezierCurveTo(cx + U * 0.46, cy + U * 0.3, cx + U * 0.4, cy - U * 0.44, cx, cy - U * 0.2); ctx.closePath(); ctx.fillStyle = '#d93a4a'; ctx.fill(); edge();
      line([cx, cy - U * 0.22, cx + U * 0.04, cy - U * 0.4], '#6b4a2b', U * 0.03);
      leaf(cx + U * 0.14, cy - U * 0.36, U * 0.09, 1.2, '#4fa86a');
      blob(cx - U * 0.14, cy - U * 0.1, U * 0.08, '255,255,255', 0.35);
    }),
    'heart-in-hands': O(function (cx, cy) {
      shadow(cx, cy + U * 0.42, U * 0.34, U * 0.05);
      for (var i = -1; i <= 1; i += 2) { ctx.save(); ctx.translate(cx, cy); ctx.scale(i, 1); ctx.beginPath(); ctx.moveTo(U * 0.02, U * 0.42); ctx.lineTo(U * 0.02, U * 0.22); ctx.quadraticCurveTo(U * 0.04, U * 0.1, U * 0.16, U * 0.12); ctx.lineTo(U * 0.3, U * 0.16); ctx.quadraticCurveTo(U * 0.4, U * 0.2, U * 0.36, U * 0.26); ctx.lineTo(U * 0.26, U * 0.32); ctx.lineTo(U * 0.3, U * 0.42); ctx.closePath(); ctx.fillStyle = '#ffd6a0'; ctx.fill(); edge(); ctx.restore(); }
      heart(cx, cy - U * 0.1, U * 0.22, '#e8475a');
      blob(cx - U * 0.08, cy - U * 0.2, U * 0.06, '255,255,255', 0.45);
    }),
    'donation-jar': O(function (cx, cy) {
      shadow(cx, cy + U * 0.42, U * 0.26, U * 0.05);
      box(cx - U * 0.16, cy - U * 0.42, U * 0.32, U * 0.1, U * 0.02, '#9aa3b2');
      box(cx - U * 0.04, cy - U * 0.41, U * 0.08, U * 0.02, 0, '#1f232e', 0);
      box(cx - U * 0.24, cy - U * 0.32, U * 0.48, U * 0.74, U * 0.06, 'rgba(230,240,255,0.55)');
      ctx.save(); ctx.beginPath(); ctx.roundRect(cx - U * 0.24, cy - U * 0.32, U * 0.48, U * 0.74, U * 0.06); ctx.clip(); for (var i = 0; i < 14; i++) { oval(cx + (hash(i) - 0.5) * U * 0.36, cy + U * 0.34 - Math.floor(i / 3) * U * 0.07 - (i % 3) * U * 0.02, U * 0.07, U * 0.035, i % 2 ? '#f2c94c' : '#e2b23a', U * 0.006); } ctx.restore();
      box(cx - U * 0.24, cy - U * 0.32, U * 0.48, U * 0.74, U * 0.06, 'rgba(0,0,0,0)');
      heart(cx, cy - U * 0.06, U * 0.08, '#e8475a');
      blob(cx - U * 0.16, cy - U * 0.1, U * 0.05, '255,255,255', 0.5);
    }),
    'awareness-ribbon': O(function (cx, cy) {
      shadow(cx, cy + U * 0.42, U * 0.24, U * 0.04);
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx - U * 0.2, cy + U * 0.4); ctx.quadraticCurveTo(cx + U * 0.16, cy - U * 0.1, cx + U * 0.08, cy - U * 0.3); ctx.strokeStyle = '#f08cb4'; ctx.lineWidth = U * 0.1; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + U * 0.2, cy + U * 0.4); ctx.quadraticCurveTo(cx - U * 0.16, cy - U * 0.1, cx - U * 0.08, cy - U * 0.3); ctx.strokeStyle = '#f9a8d4'; ctx.lineWidth = U * 0.1; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - U * 0.08, cy - U * 0.3); ctx.quadraticCurveTo(cx, cy - U * 0.5, cx + U * 0.08, cy - U * 0.3); ctx.strokeStyle = '#f9a8d4'; ctx.lineWidth = U * 0.1; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - U * 0.2, cy + U * 0.4); ctx.quadraticCurveTo(cx + U * 0.16, cy - U * 0.1, cx + U * 0.08, cy - U * 0.3); ctx.quadraticCurveTo(cx, cy - U * 0.5, cx - U * 0.08, cy - U * 0.3); ctx.quadraticCurveTo(cx - U * 0.16, cy - U * 0.1, cx + U * 0.2, cy + U * 0.4); ctx.strokeStyle = INK; ctx.lineWidth = U * 0.012; ctx.stroke();
    }),
    'ballot-box': O(function (cx, cy) {
      shadow(cx, cy + U * 0.42, U * 0.36, U * 0.06);
      box(cx - U * 0.34, cy - U * 0.1, U * 0.68, U * 0.52, U * 0.04, '#2d7ff9');
      box(cx - U * 0.34, cy - U * 0.1, U * 0.68, U * 0.1, U * 0.03, '#1f4fa3', 0);
      box(cx - U * 0.14, cy - U * 0.08, U * 0.28, U * 0.03, U * 0.01, '#1f232e', 0);
      ctx.save(); ctx.translate(cx, cy - U * 0.26); ctx.rotate(-0.25); box(-U * 0.14, -U * 0.14, U * 0.28, U * 0.2, U * 0.01, '#f7f8fa'); line([-U * 0.06, -U * 0.03, -U * 0.01, U * 0.03, U * 0.08, -U * 0.08], '#4fd1a5', U * 0.03); ctx.restore();
      ctx.fillStyle = '#f7f8fa'; ctx.font = 'bold ' + Math.round(U * 0.12) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('VOTE', cx, cy + U * 0.18);
    }),
    'columned-building': O(function (cx, cy) {
      shadow(cx, cy + U * 0.44, U * 0.44, U * 0.05);
      box(cx - U * 0.42, cy + U * 0.34, U * 0.84, U * 0.08, U * 0.01, '#c0c6d2');
      box(cx - U * 0.38, cy + U * 0.26, U * 0.76, U * 0.08, U * 0.01, '#e6e9ef');
      for (var i = 0; i < 5; i++) { var x = cx - U * 0.3 + i * U * 0.15; box(x - U * 0.04, cy - U * 0.16, U * 0.08, U * 0.42, U * 0.01, '#f7f8fa'); box(x - U * 0.06, cy - U * 0.18, U * 0.12, U * 0.04, U * 0.01, '#e6e9ef'); }
      box(cx - U * 0.4, cy - U * 0.24, U * 0.8, U * 0.08, U * 0.01, '#e6e9ef');
      poly([cx - U * 0.44, cy - U * 0.24, cx, cy - U * 0.46, cx + U * 0.44, cy - U * 0.24], '#f7f8fa');
      disc(cx, cy - U * 0.32, U * 0.03, '#e2b23a', 0);
    }),
    'megaphone': O(function (cx, cy) {
      shadow(cx, cy + U * 0.4, U * 0.36, U * 0.05);
      box(cx - U * 0.24, cy + U * 0.08, U * 0.12, U * 0.3, U * 0.03, '#3a3f4a');
      ctx.beginPath(); ctx.moveTo(cx - U * 0.34, cy - U * 0.12); ctx.lineTo(cx + U * 0.02, cy - U * 0.14); ctx.lineTo(cx + U * 0.34, cy - U * 0.4); ctx.lineTo(cx + U * 0.34, cy + U * 0.3); ctx.lineTo(cx + U * 0.02, cy + U * 0.04); ctx.lineTo(cx - U * 0.34, cy + U * 0.02); ctx.closePath(); ctx.fillStyle = '#d93a4a'; ctx.fill(); edge();
      oval(cx + U * 0.34, cy - U * 0.05, U * 0.05, U * 0.35, '#e8475a');
      box(cx - U * 0.42, cy - U * 0.16, U * 0.1, U * 0.22, U * 0.02, '#3a3f4a');
      for (var i = 0; i < 2; i++) arc(cx + U * 0.36, cy - U * 0.05, U * (0.08 + i * 0.05), -0.5, 0.5, 'rgba(255,200,80,0.8)', U * 0.015);
    })
  };
  Object.keys(MORE_OBJECTS).forEach(function (k) { DRAW[k] = MORE_OBJECTS[k]; });
`;
