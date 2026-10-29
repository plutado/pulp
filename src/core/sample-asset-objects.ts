/**
 * The asset page's Objects, first half (milestone 26): a flat-illustration
 * vocabulary, then the sports, celebration and holiday props. Plain
 * JavaScript for the page's script, spliced in after the effects; the second
 * half is `sample-asset-objects-more.ts`. Every object is drawn about the
 * centre of its square in units of `U` (the shorter side), sits on a soft
 * shadow and carries a dark translucent edge, so the set reads as one hand.
 * `P` is the clip's progress and is 0 for a still.
 */
export const ASSET_OBJECTS_JS = `
  var INK = 'rgba(24,28,40,0.55)';
  function edge(lw) { ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = INK; ctx.lineWidth = lw === undefined ? U * 0.012 : lw; if (ctx.lineWidth > 0) ctx.stroke(); }
  function shadow(x, y, rx, ry) {
    var g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, 'rgba(0,0,0,0.24)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save(); ctx.translate(x, y); ctx.scale(1, ry / rx); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  function disc(x, y, r, fill, lw) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); edge(lw); }
  function oval(x, y, rx, ry, fill, lw, rot) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot || 0, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); edge(lw); }
  function box(x, y, w, h, r, fill, lw) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fillStyle = fill; ctx.fill(); edge(lw); }
  function poly(pts, fill, lw) { ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (var i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } edge(lw); }
  function line(pts, colour, lw) { ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (var i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]); ctx.strokeStyle = colour; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); }
  function arc(x, y, r, a0, a1, colour, lw) { ctx.beginPath(); ctx.arc(x, y, r, a0, a1); ctx.strokeStyle = colour; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.stroke(); }
  function star(x, y, ro, ri, n, fill, lw, rot) { var pts = []; for (var i = 0; i < n * 2; i++) { var a = -Math.PI / 2 + (rot || 0) + (i / (n * 2)) * Math.PI * 2, r = i % 2 ? ri : ro; pts.push(x + Math.cos(a) * r, y + Math.sin(a) * r); } poly(pts, fill, lw); }
  function heart(x, y, s, fill, lw) {
    ctx.beginPath(); ctx.moveTo(x, y + s * 0.9);
    ctx.bezierCurveTo(x - s * 1.4, y - s * 0.1, x - s * 0.7, y - s * 1.1, x, y - s * 0.4);
    ctx.bezierCurveTo(x + s * 0.7, y - s * 1.1, x + s * 1.4, y - s * 0.1, x, y + s * 0.9);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); edge(lw);
  }
  function gloss(x, y, r) { blob(x - r * 0.35, y - r * 0.4, r * 0.4, '255,255,255', 0.45); }
  function ballShade(x, y, r) { var g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.2, x, y, r); g.addColorStop(0, 'rgba(255,255,255,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0.28)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  function candleFlame(x, baseY, h, w, seed) { flame(x, baseY, h, w, seed, 1); }
  /* An object: drawn about the centre, with its shadow first. */
  function O(fn) { return function (W, H) { var cx = W / 2, cy = H / 2; fn(cx, cy, W, H); }; }
  var OBJECTS = {
    // ===== Sports equipment
    'trophy': O(function (cx, cy) {
      shadow(cx, cy + U * 0.36, U * 0.22, U * 0.05);
      box(cx - U * 0.17, cy + U * 0.28, U * 0.34, U * 0.07, U * 0.015, '#6b4a2b');
      box(cx - U * 0.08, cy + U * 0.18, U * 0.16, U * 0.11, U * 0.01, '#e2b23a');
      arc(cx - U * 0.22, cy - U * 0.12, U * 0.1, Math.PI * 0.5, Math.PI * 1.5, '#e2b23a', U * 0.03); arc(cx + U * 0.22, cy - U * 0.12, U * 0.1, -Math.PI * 0.5, Math.PI * 0.5, '#e2b23a', U * 0.03);
      ctx.beginPath(); ctx.moveTo(cx - U * 0.2, cy - U * 0.32); ctx.lineTo(cx + U * 0.2, cy - U * 0.32); ctx.bezierCurveTo(cx + U * 0.2, cy + U * 0.05, cx + U * 0.05, cy + U * 0.12, cx, cy + U * 0.18); ctx.bezierCurveTo(cx - U * 0.05, cy + U * 0.12, cx - U * 0.2, cy + U * 0.05, cx - U * 0.2, cy - U * 0.32); ctx.closePath(); ctx.fillStyle = '#f2c94c'; ctx.fill(); edge();
      star(cx, cy - U * 0.1, U * 0.07, U * 0.03, 5, '#fff3c4', 0);
    }),
    'whistle': O(function (cx, cy) {
      shadow(cx, cy + U * 0.3, U * 0.26, U * 0.05);
      ctx.beginPath(); ctx.moveTo(cx - U * 0.08, cy - U * 0.1); ctx.bezierCurveTo(cx - U * 0.4, cy - U * 0.3, cx - U * 0.1, cy - U * 0.5, cx + U * 0.1, cy - U * 0.36); ctx.strokeStyle = 'rgba(40,40,50,0.8)'; ctx.lineWidth = U * 0.012; ctx.lineCap = 'round'; ctx.stroke();
      box(cx - U * 0.02, cy - U * 0.14, U * 0.34, U * 0.12, U * 0.03, '#2d7ff9');
      disc(cx - U * 0.04, cy + U * 0.05, U * 0.19, '#2d7ff9');
      disc(cx - U * 0.04, cy + U * 0.05, U * 0.06, '#1a4fa0', 0);
      box(cx + U * 0.1, cy - U * 0.12, U * 0.08, U * 0.03, U * 0.01, '#1a4fa0', 0);
    }),
    'medal': O(function (cx, cy) {
      shadow(cx, cy + U * 0.36, U * 0.2, U * 0.04);
      poly([cx - U * 0.16, cy - U * 0.46, cx + U * 0.16, cy - U * 0.46, cx + U * 0.06, cy - U * 0.05, cx - U * 0.06, cy - U * 0.05], '#d93a4a');
      poly([cx - U * 0.08, cy - U * 0.46, cx + U * 0.08, cy - U * 0.46, cx + U * 0.03, cy - U * 0.05, cx - U * 0.03, cy - U * 0.05], '#f4f4f6', 0);
      disc(cx, cy + U * 0.14, U * 0.24, '#f2c94c');
      disc(cx, cy + U * 0.14, U * 0.18, '#e2b23a', U * 0.008);
      star(cx, cy + U * 0.14, U * 0.11, U * 0.05, 5, '#fff3c4', 0);
    }),
    'stopwatch': O(function (cx, cy) {
      shadow(cx, cy + U * 0.36, U * 0.24, U * 0.05);
      box(cx - U * 0.05, cy - U * 0.42, U * 0.1, U * 0.08, U * 0.02, '#8a8f99');
      box(cx + U * 0.16, cy - U * 0.36, U * 0.08, U * 0.06, U * 0.015, '#8a8f99');
      disc(cx, cy + U * 0.02, U * 0.3, '#3a3f4a');
      disc(cx, cy + U * 0.02, U * 0.25, '#f7f8fa', 0);
      for (var i = 0; i < 12; i++) { var a = (i / 12) * Math.PI * 2; line([cx + Math.cos(a) * U * 0.2, cy + U * 0.02 + Math.sin(a) * U * 0.2, cx + Math.cos(a) * U * 0.23, cy + U * 0.02 + Math.sin(a) * U * 0.23], '#3a3f4a', U * (i % 3 ? 0.006 : 0.012)); }
      var a2 = -Math.PI / 2 + P * Math.PI * 2;
      line([cx, cy + U * 0.02, cx + Math.cos(a2) * U * 0.2, cy + U * 0.02 + Math.sin(a2) * U * 0.2], '#d93a4a', U * 0.014);
      disc(cx, cy + U * 0.02, U * 0.02, '#3a3f4a', 0);
    }),
    'football-ball': O(function (cx, cy) {
      shadow(cx, cy + U * 0.3, U * 0.3, U * 0.06);
      oval(cx, cy, U * 0.36, U * 0.22, '#8a4b2a', U * 0.012, -0.5);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.5);
      line([-U * 0.14, 0, U * 0.14, 0], '#f7f1e6', U * 0.018);
      for (var i = -2; i <= 2; i++) line([i * U * 0.055, -U * 0.04, i * U * 0.055, U * 0.04], '#f7f1e6', U * 0.014);
      arc(0, 0, U * 0.3, Math.PI * 0.86, Math.PI * 1.14, '#f7f1e6', U * 0.014); arc(0, 0, U * 0.3, -Math.PI * 0.14, Math.PI * 0.14, '#f7f1e6', U * 0.014);
      ctx.restore();
    }),
    'football-helmet': O(function (cx, cy) {
      shadow(cx, cy + U * 0.3, U * 0.3, U * 0.06);
      ctx.beginPath(); ctx.arc(cx - U * 0.02, cy - U * 0.02, U * 0.3, Math.PI, Math.PI * 2); ctx.lineTo(cx + U * 0.28, cy + U * 0.18); ctx.lineTo(cx + U * 0.08, cy + U * 0.18); ctx.lineTo(cx + U * 0.04, cy + U * 0.06); ctx.lineTo(cx - U * 0.32, cy + U * 0.1); ctx.closePath(); ctx.fillStyle = '#1f4fa3'; ctx.fill(); edge();
      line([cx - U * 0.02, cy - U * 0.32, cx - U * 0.02, cy - U * 0.02], '#f4f4f6', U * 0.03);
      line([cx + U * 0.04, cy + U * 0.06, cx + U * 0.34, cy + U * 0.02, cx + U * 0.34, cy + U * 0.18, cx + U * 0.28, cy + U * 0.18], 'rgba(40,44,56,0.9)', U * 0.03);
      line([cx + U * 0.08, cy + U * 0.1, cx + U * 0.33, cy + U * 0.1], 'rgba(40,44,56,0.9)', U * 0.025);
      disc(cx - U * 0.3, cy + U * 0.02, U * 0.04, '#9aa3b2', U * 0.006);
    }),
    'goalpost': O(function (cx, cy) {
      shadow(cx, cy + U * 0.42, U * 0.14, U * 0.03);
      line([cx, cy + U * 0.42, cx, cy + U * 0.1], '#f2c94c', U * 0.035);
      line([cx - U * 0.3, cy + U * 0.1, cx + U * 0.3, cy + U * 0.1], '#f2c94c', U * 0.035);
      line([cx - U * 0.3, cy + U * 0.12, cx - U * 0.3, cy - U * 0.42], '#f2c94c', U * 0.035);
      line([cx + U * 0.3, cy + U * 0.12, cx + U * 0.3, cy - U * 0.42], '#f2c94c', U * 0.035);
      box(cx - U * 0.07, cy + U * 0.34, U * 0.14, U * 0.08, U * 0.01, '#3a3f4a');
    }),
    'basketball-ball': O(function (cx, cy) {
      var b = Math.abs(Math.sin(P * Math.PI * 2)), y = cy + U * 0.2 - b * U * 0.42, r = U * 0.22, sq = P > 0.45 && P < 0.55 ? 0.9 : 1;
      shadow(cx, cy + U * 0.42, U * (0.26 - b * 0.1), U * 0.05);
      ctx.save(); ctx.translate(cx, y); ctx.scale(1 / sq, sq); ctx.translate(-cx, -y);
      disc(cx, y, r, '#e8702a');
      line([cx - r, y, cx + r, y], 'rgba(40,24,16,0.8)', U * 0.012); line([cx, y - r, cx, y + r], 'rgba(40,24,16,0.8)', U * 0.012);
      arc(cx - r * 1.1, y, r * 0.9, -0.55, 0.55, 'rgba(40,24,16,0.8)', U * 0.012); arc(cx + r * 1.1, y, r * 0.9, Math.PI - 0.55, Math.PI + 0.55, 'rgba(40,24,16,0.8)', U * 0.012);
      ballShade(cx, y, r);
      ctx.restore();
    }),
    'basketball-hoop': O(function (cx, cy) {
      box(cx - U * 0.3, cy - U * 0.44, U * 0.6, U * 0.36, U * 0.02, '#f7f8fa');
      box(cx - U * 0.12, cy - U * 0.3, U * 0.24, U * 0.18, U * 0.01, 'rgba(0,0,0,0)', U * 0.012);
      oval(cx, cy - U * 0.08, U * 0.2, U * 0.05, '#e8702a', U * 0.01);
      ctx.strokeStyle = 'rgba(240,240,245,0.9)'; ctx.lineWidth = U * 0.008;
      for (var i = 0; i < 8; i++) { var x0 = cx - U * 0.2 + i * U * 0.057; ctx.beginPath(); ctx.moveTo(x0, cy - U * 0.06); ctx.lineTo(cx - U * 0.12 + i * U * 0.034, cy + U * 0.26); ctx.stroke(); }
      for (var k = 1; k < 5; k++) { var yy = cy - U * 0.06 + k * U * 0.08, w = U * (0.2 - k * 0.02); ctx.beginPath(); ctx.moveTo(cx - w, yy); ctx.lineTo(cx + w, yy); ctx.stroke(); }
    }),
    'basketball-jersey': O(function (cx, cy) {
      shadow(cx, cy + U * 0.4, U * 0.26, U * 0.04);
      ctx.beginPath(); ctx.moveTo(cx - U * 0.28, cy - U * 0.36); ctx.lineTo(cx - U * 0.12, cy - U * 0.4); ctx.quadraticCurveTo(cx, cy - U * 0.26, cx + U * 0.12, cy - U * 0.4); ctx.lineTo(cx + U * 0.28, cy - U * 0.36); ctx.lineTo(cx + U * 0.34, cy - U * 0.1); ctx.lineTo(cx + U * 0.22, cy - U * 0.08); ctx.lineTo(cx + U * 0.22, cy + U * 0.38); ctx.lineTo(cx - U * 0.22, cy + U * 0.38); ctx.lineTo(cx - U * 0.22, cy - U * 0.08); ctx.lineTo(cx - U * 0.34, cy - U * 0.1); ctx.closePath(); ctx.fillStyle = '#6f2dbd'; ctx.fill(); edge();
      ctx.fillStyle = '#f2c94c'; ctx.font = 'bold ' + Math.round(U * 0.26) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('23', cx, cy + U * 0.1);
    }),
    'baseball-ball': O(function (cx, cy) {
      shadow(cx, cy + U * 0.34, U * 0.26, U * 0.05);
      disc(cx, cy, U * 0.3, '#f7f4ec');
      arc(cx - U * 0.42, cy, U * 0.3, -0.75, 0.75, '#d93a4a', U * 0.014); arc(cx + U * 0.42, cy, U * 0.3, Math.PI - 0.75, Math.PI + 0.75, '#d93a4a', U * 0.014);
      for (var i = -3; i <= 3; i++) { var a = i * 0.2, x = cx - U * 0.42 + Math.cos(a) * U * 0.3, y = cy + Math.sin(a) * U * 0.3; line([x - U * 0.025, y - U * 0.02, x + U * 0.025, y + U * 0.02], '#d93a4a', U * 0.01); var x2 = cx + U * 0.42 - Math.cos(a) * U * 0.3; line([x2 - U * 0.025, y + U * 0.02, x2 + U * 0.025, y - U * 0.02], '#d93a4a', U * 0.01); }
      ballShade(cx, cy, U * 0.3);
    }),
    'baseball-bat': O(function (cx, cy) {
      shadow(cx, cy + U * 0.4, U * 0.3, U * 0.04);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.8);
      ctx.beginPath(); ctx.moveTo(-U * 0.44, -U * 0.03); ctx.lineTo(-U * 0.44, U * 0.03); ctx.lineTo(-U * 0.1, U * 0.06); ctx.quadraticCurveTo(U * 0.3, U * 0.1, U * 0.44, U * 0.05); ctx.quadraticCurveTo(U * 0.5, 0, U * 0.44, -U * 0.05); ctx.quadraticCurveTo(U * 0.3, -U * 0.1, -U * 0.1, -U * 0.06); ctx.closePath(); ctx.fillStyle = '#c8955a'; ctx.fill(); edge();
      disc(-U * 0.44, 0, U * 0.045, '#3a3f4a');
      box(-U * 0.4, -U * 0.04, U * 0.14, U * 0.08, U * 0.01, 'rgba(40,40,50,0.6)', 0);
      ctx.restore();
    }),
    'baseball-glove': O(function (cx, cy) {
      shadow(cx, cy + U * 0.38, U * 0.3, U * 0.05);
      for (var i = 0; i < 4; i++) { var x = cx - U * 0.22 + i * U * 0.13, h = U * (0.3 + Math.sin(i * 1.2) * 0.06); oval(x, cy - h + U * 0.1, U * 0.07, h * 0.5, '#b8742f', U * 0.012); }
      oval(cx - U * 0.3, cy + U * 0.02, U * 0.07, U * 0.16, '#b8742f', U * 0.012, 0.6);
      ctx.beginPath(); ctx.moveTo(cx - U * 0.3, cy + U * 0.08); ctx.quadraticCurveTo(cx - U * 0.32, cy + U * 0.42, cx, cy + U * 0.4); ctx.quadraticCurveTo(cx + U * 0.3, cy + U * 0.4, cx + U * 0.26, cy + U * 0.02); ctx.lineTo(cx - U * 0.26, cy + U * 0.04); ctx.closePath(); ctx.fillStyle = '#c8894a'; ctx.fill(); edge();
      oval(cx, cy + U * 0.22, U * 0.16, U * 0.1, '#a96a2b', U * 0.008);
      line([cx - U * 0.16, cy + U * 0.08, cx + U * 0.2, cy + U * 0.06], 'rgba(90,50,20,0.7)', U * 0.012);
    }),
    'soccer-ball': O(function (cx, cy) {
      shadow(cx, cy + U * 0.34, U * 0.26, U * 0.05);
      disc(cx, cy, U * 0.3, '#f7f8fa');
      var pent = function (x, y, r, rot) { var pts = []; for (var i = 0; i < 5; i++) { var a = rot + (i / 5) * Math.PI * 2; pts.push(x + Math.cos(a) * r, y + Math.sin(a) * r); } poly(pts, '#1f232e', 0); };
      pent(cx, cy, U * 0.09, -Math.PI / 2);
      for (var i = 0; i < 5; i++) { var a = -Math.PI / 2 + (i / 5) * Math.PI * 2; pent(cx + Math.cos(a) * U * 0.24, cy + Math.sin(a) * U * 0.24, U * 0.065, a + Math.PI); line([cx + Math.cos(a) * U * 0.09, cy + Math.sin(a) * U * 0.09, cx + Math.cos(a) * U * 0.18, cy + Math.sin(a) * U * 0.18], '#1f232e', U * 0.01); }
      ballShade(cx, cy, U * 0.3);
    }),
    'soccer-goal': O(function (cx, cy) {
      line([cx - U * 0.4, cy + U * 0.3, cx - U * 0.4, cy - U * 0.26, cx + U * 0.4, cy - U * 0.26, cx + U * 0.4, cy + U * 0.3], '#f7f8fa', U * 0.03);
      line([cx - U * 0.4, cy - U * 0.26, cx - U * 0.3, cy - U * 0.12, cx + U * 0.3, cy - U * 0.12, cx + U * 0.4, cy - U * 0.26], '#f7f8fa', U * 0.02);
      line([cx - U * 0.3, cy - U * 0.12, cx - U * 0.3, cy + U * 0.3, cx + U * 0.3, cy + U * 0.3, cx + U * 0.3, cy - U * 0.12], '#f7f8fa', U * 0.02);
      ctx.strokeStyle = 'rgba(240,240,245,0.75)'; ctx.lineWidth = U * 0.005;
      for (var i = 1; i < 10; i++) { var x = cx - U * 0.3 + i * U * 0.06; ctx.beginPath(); ctx.moveTo(x, cy - U * 0.12); ctx.lineTo(x, cy + U * 0.3); ctx.stroke(); }
      for (var k = 1; k < 7; k++) { var y = cy - U * 0.12 + k * U * 0.06; ctx.beginPath(); ctx.moveTo(cx - U * 0.3, y); ctx.lineTo(cx + U * 0.3, y); ctx.stroke(); }
    }),
    'soccer-boot': O(function (cx, cy) {
      shadow(cx, cy + U * 0.3, U * 0.34, U * 0.05);
      ctx.beginPath(); ctx.moveTo(cx - U * 0.34, cy + U * 0.2); ctx.lineTo(cx - U * 0.3, cy - U * 0.22); ctx.lineTo(cx - U * 0.12, cy - U * 0.24); ctx.quadraticCurveTo(cx, cy, cx + U * 0.24, cy + U * 0.02); ctx.quadraticCurveTo(cx + U * 0.4, cy + U * 0.08, cx + U * 0.36, cy + U * 0.2); ctx.closePath(); ctx.fillStyle = '#1f232e'; ctx.fill(); edge();
      box(cx - U * 0.36, cy + U * 0.18, U * 0.74, U * 0.05, U * 0.01, '#f7f8fa');
      for (var i = 0; i < 5; i++) disc(cx - U * 0.26 + i * U * 0.14, cy + U * 0.27, U * 0.02, '#3a3f4a', 0);
      for (var k = 0; k < 4; k++) line([cx - U * 0.24 + k * U * 0.05, cy - U * 0.16 + k * U * 0.04, cx - U * 0.16 + k * U * 0.05, cy - U * 0.2 + k * U * 0.04], '#f7f8fa', U * 0.012);
      line([cx - U * 0.06, cy - U * 0.04, cx + U * 0.26, cy + U * 0.08], '#4fd1a5', U * 0.03);
    }),
    'hockey-puck': O(function (cx, cy) {
      shadow(cx, cy + U * 0.26, U * 0.34, U * 0.07);
      ctx.beginPath(); ctx.ellipse(cx, cy + U * 0.1, U * 0.3, U * 0.1, 0, 0, Math.PI); ctx.lineTo(cx - U * 0.3, cy - U * 0.06); ctx.ellipse(cx, cy - U * 0.06, U * 0.3, U * 0.1, 0, Math.PI, 0, true); ctx.closePath(); ctx.fillStyle = '#1a1d26'; ctx.fill(); edge();
      oval(cx, cy - U * 0.06, U * 0.3, U * 0.1, '#2c3040');
    }),
    'hockey-stick': O(function (cx, cy) {
      shadow(cx, cy + U * 0.4, U * 0.28, U * 0.04);
      line([cx + U * 0.3, cy - U * 0.44, cx - U * 0.14, cy + U * 0.3], '#c8955a', U * 0.05);
      ctx.beginPath(); ctx.moveTo(cx - U * 0.17, cy + U * 0.26); ctx.quadraticCurveTo(cx - U * 0.26, cy + U * 0.42, cx - U * 0.4, cy + U * 0.4); ctx.lineTo(cx - U * 0.42, cy + U * 0.33); ctx.quadraticCurveTo(cx - U * 0.2, cy + U * 0.32, cx - U * 0.1, cy + U * 0.22); ctx.closePath(); ctx.fillStyle = '#1f232e'; ctx.fill(); edge();
      line([cx + U * 0.3, cy - U * 0.44, cx + U * 0.22, cy - U * 0.3], '#1f232e', U * 0.056);
    }),
    'hockey-skate': O(function (cx, cy) {
      shadow(cx, cy + U * 0.38, U * 0.34, U * 0.04);
      ctx.beginPath(); ctx.moveTo(cx - U * 0.2, cy + U * 0.14); ctx.lineTo(cx - U * 0.18, cy - U * 0.3); ctx.lineTo(cx + U * 0.02, cy - U * 0.3); ctx.quadraticCurveTo(cx + U * 0.1, cy - U * 0.02, cx + U * 0.34, cy + U * 0.02); ctx.lineTo(cx + U * 0.36, cy + U * 0.14); ctx.closePath(); ctx.fillStyle = '#f7f8fa'; ctx.fill(); edge();
      for (var k = 0; k < 4; k++) line([cx - U * 0.14 + k * U * 0.03, cy - U * 0.22 + k * U * 0.05, cx - U * 0.04 + k * U * 0.03, cy - U * 0.24 + k * U * 0.05], '#3a3f4a', U * 0.01);
      line([cx - U * 0.16, cy + U * 0.2, cx + U * 0.32, cy + U * 0.2], '#3a3f4a', U * 0.03);
      line([cx - U * 0.2, cy + U * 0.3, cx + U * 0.36, cy + U * 0.3], '#9aa3b2', U * 0.02);
      line([cx - U * 0.12, cy + U * 0.21, cx - U * 0.12, cy + U * 0.29], '#3a3f4a', U * 0.02); line([cx + U * 0.26, cy + U * 0.21, cx + U * 0.26, cy + U * 0.29], '#3a3f4a', U * 0.02);
    }),
    'golf-ball': O(function (cx, cy) {
      shadow(cx, cy + U * 0.4, U * 0.16, U * 0.03);
      line([cx, cy + U * 0.4, cx, cy + U * 0.14], '#f2c94c', U * 0.03);
      box(cx - U * 0.08, cy + U * 0.1, U * 0.16, U * 0.05, U * 0.01, '#f2c94c');
      disc(cx, cy - U * 0.12, U * 0.24, '#f7f8fa');
      for (var i = 0; i < 24; i++) { var a = hash(i) * Math.PI * 2, d = Math.sqrt(hash(i + 7)) * U * 0.19; disc(cx + Math.cos(a) * d, cy - U * 0.12 + Math.sin(a) * d, U * 0.016, 'rgba(180,186,200,0.6)', 0); }
      ballShade(cx, cy - U * 0.12, U * 0.24);
    }),
    'golf-flag': O(function (cx, cy) {
      shadow(cx, cy + U * 0.38, U * 0.22, U * 0.04);
      oval(cx, cy + U * 0.36, U * 0.14, U * 0.04, '#2d9c6f', U * 0.008);
      oval(cx, cy + U * 0.36, U * 0.07, U * 0.02, '#1f232e', 0);
      line([cx, cy + U * 0.36, cx, cy - U * 0.42], '#9aa3b2', U * 0.02);
      poly([cx, cy - U * 0.42, cx + U * 0.3, cy - U * 0.3, cx, cy - U * 0.18], '#d93a4a');
    }),
    'golf-club': O(function (cx, cy) {
      shadow(cx, cy + U * 0.38, U * 0.26, U * 0.04);
      line([cx + U * 0.22, cy - U * 0.44, cx - U * 0.1, cy + U * 0.26], '#9aa3b2', U * 0.025);
      line([cx + U * 0.22, cy - U * 0.44, cx + U * 0.16, cy - U * 0.3], '#1f232e', U * 0.04);
      ctx.beginPath(); ctx.moveTo(cx - U * 0.14, cy + U * 0.22); ctx.quadraticCurveTo(cx - U * 0.36, cy + U * 0.26, cx - U * 0.34, cy + U * 0.38); ctx.lineTo(cx + U * 0.02, cy + U * 0.38); ctx.quadraticCurveTo(cx + U * 0.02, cy + U * 0.28, cx - U * 0.06, cy + U * 0.22); ctx.closePath(); ctx.fillStyle = '#6b7280'; ctx.fill(); edge();
      for (var k = 0; k < 4; k++) line([cx - U * 0.3, cy + U * 0.27 + k * U * 0.025, cx, cy + U * 0.27 + k * U * 0.025], 'rgba(255,255,255,0.4)', U * 0.004);
    }),
    'tennis-ball': O(function (cx, cy) {
      shadow(cx, cy + U * 0.34, U * 0.26, U * 0.05);
      disc(cx, cy, U * 0.3, '#d4f03a');
      arc(cx - U * 0.42, cy, U * 0.3, -0.8, 0.8, '#f7f8fa', U * 0.03); arc(cx + U * 0.42, cy, U * 0.3, Math.PI - 0.8, Math.PI + 0.8, '#f7f8fa', U * 0.03);
      ballShade(cx, cy, U * 0.3);
    }),
    'tennis-racket': O(function (cx, cy) {
      shadow(cx, cy + U * 0.42, U * 0.14, U * 0.03);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(0.4);
      line([0, U * 0.1, 0, U * 0.46], '#3a3f4a', U * 0.045);
      oval(0, -U * 0.14, U * 0.22, U * 0.28, 'rgba(255,255,255,0.08)', U * 0.03);
      ctx.save(); ctx.beginPath(); ctx.ellipse(0, -U * 0.14, U * 0.22, U * 0.28, 0, 0, Math.PI * 2); ctx.clip();
      ctx.strokeStyle = 'rgba(240,240,245,0.85)'; ctx.lineWidth = U * 0.005;
      for (var i = -4; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(i * U * 0.045, -U * 0.4); ctx.lineTo(i * U * 0.045, U * 0.12); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-U * 0.22, -U * 0.14 + i * U * 0.055); ctx.lineTo(U * 0.22, -U * 0.14 + i * U * 0.055); ctx.stroke(); }
      ctx.restore();
      oval(0, -U * 0.14, U * 0.22, U * 0.28, 'rgba(0,0,0,0)', U * 0.03);
      ctx.strokeStyle = '#d93a4a'; ctx.lineWidth = U * 0.02; ctx.beginPath(); ctx.ellipse(0, -U * 0.14, U * 0.22, U * 0.28, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }),
    'tennis-net': O(function (cx, cy) {
      line([cx - U * 0.44, cy - U * 0.2, cx - U * 0.44, cy + U * 0.32], '#3a3f4a', U * 0.03); line([cx + U * 0.44, cy - U * 0.2, cx + U * 0.44, cy + U * 0.32], '#3a3f4a', U * 0.03);
      ctx.strokeStyle = 'rgba(240,240,245,0.8)'; ctx.lineWidth = U * 0.005;
      for (var i = 0; i <= 22; i++) { var x = cx - U * 0.44 + i * U * 0.04; ctx.beginPath(); ctx.moveTo(x, cy - U * 0.16); ctx.lineTo(x, cy + U * 0.3); ctx.stroke(); }
      for (var k = 0; k <= 11; k++) { var y = cy - U * 0.16 + k * U * 0.042; ctx.beginPath(); ctx.moveTo(cx - U * 0.44, y); ctx.lineTo(cx + U * 0.44, y); ctx.stroke(); }
      line([cx - U * 0.44, cy - U * 0.18, cx + U * 0.44, cy - U * 0.18], '#f7f8fa', U * 0.03);
      line([cx, cy - U * 0.18, cx, cy + U * 0.3], '#f7f8fa', U * 0.02);
    }),
    'checkered-flag-wave': O(function (cx, cy) {
      shadow(cx, cy + U * 0.44, U * 0.1, U * 0.025);
      line([cx - U * 0.36, cy + U * 0.44, cx - U * 0.36, cy - U * 0.44], '#6b7280', U * 0.025);
      var cols = 8, rows = 6, w = U * 0.085, h = U * 0.075;
      for (var i = 0; i < cols; i++) for (var k = 0; k < rows; k++) {
        var x = cx - U * 0.35 + i * w, off = Math.sin(P * Math.PI * 2 + i * 0.7) * U * 0.03, off2 = Math.sin(P * Math.PI * 2 + (i + 1) * 0.7) * U * 0.03;
        var y = cy - U * 0.4 + k * h;
        ctx.beginPath(); ctx.moveTo(x, y + off); ctx.lineTo(x + w, y + off2); ctx.lineTo(x + w, y + h + off2); ctx.lineTo(x, y + h + off); ctx.closePath();
        ctx.fillStyle = (i + k) % 2 ? '#f7f8fa' : '#1f232e'; ctx.fill();
      }
    }),
    'racing-tyre': O(function (cx, cy) {
      shadow(cx, cy + U * 0.36, U * 0.28, U * 0.05);
      disc(cx, cy, U * 0.34, '#1f232e');
      for (var i = 0; i < 16; i++) { var a = (i / 16) * Math.PI * 2; line([cx + Math.cos(a) * U * 0.26, cy + Math.sin(a) * U * 0.26, cx + Math.cos(a) * U * 0.33, cy + Math.sin(a) * U * 0.33], '#2c3040', U * 0.03); }
      disc(cx, cy, U * 0.2, '#c0c6d2');
      for (var k = 0; k < 5; k++) { var b = (k / 5) * Math.PI * 2; line([cx, cy, cx + Math.cos(b) * U * 0.17, cy + Math.sin(b) * U * 0.17], '#8a8f99', U * 0.04); }
      disc(cx, cy, U * 0.05, '#d93a4a');
    }),
    'racing-helmet': O(function (cx, cy) {
      shadow(cx, cy + U * 0.32, U * 0.3, U * 0.06);
      ctx.beginPath(); ctx.arc(cx, cy, U * 0.32, Math.PI, Math.PI * 2); ctx.lineTo(cx + U * 0.32, cy + U * 0.2); ctx.quadraticCurveTo(cx, cy + U * 0.34, cx - U * 0.32, cy + U * 0.2); ctx.closePath(); ctx.fillStyle = '#d93a4a'; ctx.fill(); edge();
      ctx.beginPath(); ctx.moveTo(cx - U * 0.3, cy - U * 0.02); ctx.quadraticCurveTo(cx + U * 0.1, cy - U * 0.14, cx + U * 0.32, cy - U * 0.02); ctx.lineTo(cx + U * 0.3, cy + U * 0.14); ctx.quadraticCurveTo(cx, cy + U * 0.2, cx - U * 0.3, cy + U * 0.14); ctx.closePath(); ctx.fillStyle = '#1f232e'; ctx.fill(); edge();
      line([cx - U * 0.2, cy - U * 0.24, cx + U * 0.1, cy - U * 0.3], '#f7f8fa', U * 0.03);
      blob(cx - U * 0.1, cy + U * 0.02, U * 0.1, '120,160,220', 0.5);
    }),
    'dumbbell-pair': O(function (cx, cy) {
      shadow(cx, cy + U * 0.34, U * 0.4, U * 0.06);
      for (var k = 0; k < 2; k++) {
        var y = cy - U * 0.12 + k * U * 0.26;
        line([cx - U * 0.2, y, cx + U * 0.2, y], '#8a8f99', U * 0.04);
        box(cx - U * 0.36, y - U * 0.1, U * 0.14, U * 0.2, U * 0.03, '#1f232e'); box(cx + U * 0.22, y - U * 0.1, U * 0.14, U * 0.2, U * 0.03, '#1f232e');
        box(cx - U * 0.44, y - U * 0.07, U * 0.07, U * 0.14, U * 0.02, '#2c3040'); box(cx + U * 0.37, y - U * 0.07, U * 0.07, U * 0.14, U * 0.02, '#2c3040');
      }
    }),
    'kettlebell': O(function (cx, cy) {
      shadow(cx, cy + U * 0.38, U * 0.28, U * 0.05);
      ctx.beginPath(); ctx.arc(cx, cy - U * 0.18, U * 0.17, Math.PI * 1.05, Math.PI * 1.95); ctx.lineTo(cx + U * 0.2, cy - U * 0.02); ctx.lineTo(cx + U * 0.1, cy); ctx.arc(cx, cy - U * 0.18, U * 0.1, Math.PI * 1.9, Math.PI * 1.1, true); ctx.lineTo(cx - U * 0.2, cy - U * 0.02); ctx.closePath(); ctx.fillStyle = '#2c3040'; ctx.fill(); edge();
      disc(cx, cy + U * 0.14, U * 0.26, '#1f232e');
      disc(cx, cy + U * 0.14, U * 0.1, '#d93a4a', 0);
      blob(cx - U * 0.1, cy + U * 0.02, U * 0.08, '255,255,255', 0.2);
    }),
    'jump-rope': O(function (cx, cy) {
      shadow(cx, cy + U * 0.38, U * 0.34, U * 0.04);
      ctx.beginPath(); ctx.moveTo(cx - U * 0.3, cy - U * 0.1); ctx.bezierCurveTo(cx - U * 0.6, cy + U * 0.6, cx + U * 0.6, cy + U * 0.6, cx + U * 0.3, cy - U * 0.1); ctx.strokeStyle = '#d93a4a'; ctx.lineWidth = U * 0.02; ctx.lineCap = 'round'; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - U * 0.3, cy - U * 0.1); ctx.bezierCurveTo(cx - U * 0.4, cy - U * 0.5, cx + U * 0.4, cy - U * 0.5, cx + U * 0.3, cy - U * 0.1); ctx.stroke();
      box(cx - U * 0.36, cy - U * 0.14, U * 0.12, U * 0.3, U * 0.03, '#1f232e'); box(cx + U * 0.24, cy - U * 0.14, U * 0.12, U * 0.3, U * 0.03, '#1f232e');
      box(cx - U * 0.34, cy - U * 0.1, U * 0.08, U * 0.04, U * 0.01, '#f7f8fa', 0); box(cx + U * 0.26, cy - U * 0.1, U * 0.08, U * 0.04, U * 0.01, '#f7f8fa', 0);
    }),
    // ===== Celebration objects
    'wedding-rings-pair': O(function (cx, cy) {
      shadow(cx, cy + U * 0.3, U * 0.34, U * 0.05);
      arc(cx - U * 0.12, cy, U * 0.22, 0, Math.PI * 2, '#f2c94c', U * 0.06);
      arc(cx + U * 0.12, cy + U * 0.02, U * 0.22, 0, Math.PI * 2, '#e6e9ef', U * 0.06);
      arc(cx - U * 0.12, cy, U * 0.22, Math.PI * 0.2, Math.PI * 0.6, '#f2c94c', U * 0.062);
      star(cx + U * 0.12, cy - U * 0.26, U * 0.06, U * 0.025, 4, '#fff', 0);
      blob(cx - U * 0.28, cy - U * 0.14, U * 0.05, '255,255,255', 0.5);
    }),
    'bouquet': O(function (cx, cy) {
      shadow(cx, cy + U * 0.42, U * 0.14, U * 0.03);
      poly([cx - U * 0.08, cy + U * 0.12, cx + U * 0.08, cy + U * 0.12, cx + U * 0.04, cy + U * 0.42, cx - U * 0.04, cy + U * 0.42], '#c8e0b0');
      var cols = ['#ffb3c6', '#ffd6e0', '#fff5f7', '#f9a8d4'];
      for (var i = 0; i < 9; i++) { var a = (i / 9) * Math.PI * 2, d = U * (i < 4 ? 0.2 : 0.1); if (i < 4) leaf(cx + Math.cos(a) * U * 0.28, cy - U * 0.1 + Math.sin(a) * U * 0.2, U * 0.09, a + Math.PI / 2, '#6fb88a'); }
      for (var k = 0; k < 7; k++) { var b = (k / 7) * Math.PI * 2, x = cx + Math.cos(b) * U * 0.17, y = cy - U * 0.1 + Math.sin(b) * U * 0.14; for (var p = 0; p < 5; p++) { var c = (p / 5) * Math.PI * 2; disc(x + Math.cos(c) * U * 0.05, y + Math.sin(c) * U * 0.05, U * 0.045, cols[k % 4], 0); } disc(x, y, U * 0.03, '#f2c94c', 0); }
      for (var q = 0; q < 5; q++) { var cq = (q / 5) * Math.PI * 2; disc(cx + Math.cos(cq) * U * 0.05, cy - U * 0.1 + Math.sin(cq) * U * 0.05, U * 0.05, '#fff5f7', 0); } disc(cx, cy - U * 0.1, U * 0.03, '#f2c94c', 0);
      line([cx - U * 0.06, cy + U * 0.2, cx + U * 0.06, cy + U * 0.2], '#f9a8d4', U * 0.03);
    }),
    'birthday-cake-candles': O(function (cx, cy) {
      shadow(cx, cy + U * 0.42, U * 0.34, U * 0.05);
      oval(cx, cy + U * 0.38, U * 0.36, U * 0.08, '#e6e9ef');
      box(cx - U * 0.28, cy + U * 0.08, U * 0.56, U * 0.28, U * 0.02, '#f9a8d4');
      box(cx - U * 0.2, cy - U * 0.14, U * 0.4, U * 0.22, U * 0.02, '#fde2ea');
      for (var i = 0; i < 7; i++) disc(cx - U * 0.24 + i * U * 0.08, cy + U * 0.1, U * 0.035, '#fff5f7', 0);
      for (var k = 0; k < 5; k++) disc(cx - U * 0.16 + k * U * 0.08, cy - U * 0.12, U * 0.03, '#f9a8d4', 0);
      for (var c = 0; c < 3; c++) { var x = cx - U * 0.12 + c * U * 0.12; box(x - U * 0.015, cy - U * 0.3, U * 0.03, U * 0.16, U * 0.005, c % 2 ? '#5aa9ff' : '#ffc53d'); candleFlame(x, cy - U * 0.3, U * 0.1, U * 0.02, c * 1.7); }
    }),
    'gift-box-bow': O(function (cx, cy) {
      shadow(cx, cy + U * 0.4, U * 0.3, U * 0.05);
      box(cx - U * 0.26, cy - U * 0.06, U * 0.52, U * 0.44, U * 0.02, '#d93a4a');
      box(cx - U * 0.3, cy - U * 0.18, U * 0.6, U * 0.14, U * 0.02, '#e8475a');
      box(cx - U * 0.05, cy - U * 0.18, U * 0.1, U * 0.56, 0, '#f2c94c', 0);
      oval(cx - U * 0.11, cy - U * 0.26, U * 0.1, U * 0.06, '#f2c94c', U * 0.01, -0.4); oval(cx + U * 0.11, cy - U * 0.26, U * 0.1, U * 0.06, '#f2c94c', U * 0.01, 0.4);
      disc(cx, cy - U * 0.22, U * 0.035, '#e2b23a', 0);
    }),
    'mortarboard-toss': O(function (cx, cy) {
      var y = cy + U * 0.2 - Math.sin(Math.min(1, P) * Math.PI) * U * 0.5, rot = P * Math.PI * 2;
      shadow(cx, cy + U * 0.42, U * 0.26 * (1 - Math.sin(P * Math.PI) * 0.4), U * 0.05);
      ctx.save(); ctx.translate(cx, y); ctx.rotate(rot * 0.5);
      box(-U * 0.18, -U * 0.02, U * 0.36, U * 0.16, U * 0.02, '#1f232e');
      poly([-U * 0.36, -U * 0.08, 0, -U * 0.24, U * 0.36, -U * 0.08, 0, U * 0.08], '#2c3040');
      line([0, -U * 0.08, U * 0.16, U * 0.06, U * 0.18, U * 0.18], '#f2c94c', U * 0.015); disc(U * 0.18, U * 0.2, U * 0.03, '#f2c94c', 0);
      ctx.restore();
    }),
    'diploma-scroll': O(function (cx, cy) {
      shadow(cx, cy + U * 0.26, U * 0.36, U * 0.06);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.35);
      box(-U * 0.34, -U * 0.1, U * 0.68, U * 0.2, U * 0.02, '#f7f1e6');
      oval(-U * 0.34, 0, U * 0.05, U * 0.11, '#efe4d0'); oval(U * 0.34, 0, U * 0.05, U * 0.11, '#efe4d0');
      disc(-U * 0.34, 0, U * 0.02, '#d9c9a8', 0); disc(U * 0.34, 0, U * 0.02, '#d9c9a8', 0);
      box(-U * 0.06, -U * 0.13, U * 0.12, U * 0.26, 0, '#d93a4a', 0);
      poly([-U * 0.06, U * 0.13, -U * 0.14, U * 0.3, -U * 0.02, U * 0.24], '#d93a4a', 0); poly([U * 0.06, U * 0.13, U * 0.14, U * 0.3, U * 0.02, U * 0.24], '#d93a4a', 0);
      ctx.restore();
    }),
    'mortarboard': O(function (cx, cy) {
      shadow(cx, cy + U * 0.36, U * 0.3, U * 0.05);
      box(cx - U * 0.2, cy - U * 0.02, U * 0.4, U * 0.2, U * 0.02, '#1f232e');
      poly([cx - U * 0.42, cy - U * 0.1, cx, cy - U * 0.3, cx + U * 0.42, cy - U * 0.1, cx, cy + U * 0.1], '#2c3040');
      line([cx, cy - U * 0.1, cx + U * 0.2, cy + U * 0.06, cx + U * 0.22, cy + U * 0.24], '#f2c94c', U * 0.015); disc(cx + U * 0.22, cy + U * 0.27, U * 0.035, '#f2c94c', 0);
      disc(cx, cy - U * 0.1, U * 0.02, '#f2c94c', 0);
    }),
    'baby-rattle': O(function (cx, cy) {
      shadow(cx, cy + U * 0.4, U * 0.22, U * 0.04);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(0.5);
      line([0, U * 0.04, 0, U * 0.4], '#5aa9ff', U * 0.05);
      disc(0, U * 0.42, U * 0.06, '#5aa9ff');
      disc(0, -U * 0.16, U * 0.24, '#ffc53d');
      arc(0, -U * 0.16, U * 0.24, 0.3, Math.PI - 0.3, '#ff7a59', U * 0.05);
      gloss(0, -U * 0.16, U * 0.24);
      ctx.restore();
    }),
    'pacifier': O(function (cx, cy) {
      shadow(cx, cy + U * 0.36, U * 0.26, U * 0.05);
      oval(cx, cy - U * 0.2, U * 0.1, U * 0.14, '#ffd6a0');
      oval(cx, cy + U * 0.02, U * 0.3, U * 0.14, '#5aa9ff');
      disc(cx - U * 0.18, cy + U * 0.02, U * 0.04, '#1f4fa3', 0); disc(cx + U * 0.18, cy + U * 0.02, U * 0.04, '#1f4fa3', 0);
      arc(cx, cy + U * 0.16, U * 0.12, 0.2, Math.PI - 0.2, '#5aa9ff', U * 0.045);
      disc(cx, cy + U * 0.02, U * 0.07, '#f7f8fa', U * 0.01);
    }),
    'baby-bottle': O(function (cx, cy) {
      shadow(cx, cy + U * 0.42, U * 0.18, U * 0.04);
      box(cx - U * 0.14, cy - U * 0.1, U * 0.28, U * 0.52, U * 0.04, 'rgba(230,240,255,0.9)');
      box(cx - U * 0.14, cy + U * 0.08, U * 0.28, U * 0.34, U * 0.03, 'rgba(255,255,255,0.9)', 0);
      box(cx - U * 0.16, cy - U * 0.2, U * 0.32, U * 0.12, U * 0.02, '#5aa9ff');
      oval(cx, cy - U * 0.3, U * 0.07, U * 0.1, '#ffd6a0');
      for (var i = 1; i <= 4; i++) line([cx + U * 0.04, cy + U * 0.3 - i * U * 0.08, cx + U * 0.1, cy + U * 0.3 - i * U * 0.08], '#8a8f99', U * 0.008);
    }),
    'memorial-candle': O(function (cx, cy) {
      shadow(cx, cy + U * 0.42, U * 0.18, U * 0.04);
      box(cx - U * 0.12, cy - U * 0.1, U * 0.24, U * 0.52, U * 0.02, '#f7f1e6');
      oval(cx, cy - U * 0.1, U * 0.12, U * 0.03, '#efe4d0', U * 0.008);
      line([cx, cy - U * 0.12, cx, cy - U * 0.18], '#3a3f4a', U * 0.012);
      blob(cx, cy - U * 0.26, U * 0.18, '255,210,130', 0.3 + 0.08 * Math.sin(P * Math.PI * 4));
      candleFlame(cx, cy - U * 0.16, U * 0.2, U * 0.045, 0.3);
    }),
    'dove': O(function (cx, cy) {
      shadow(cx, cy + U * 0.38, U * 0.26, U * 0.04);
      ctx.beginPath(); ctx.moveTo(cx - U * 0.3, cy + U * 0.04); ctx.quadraticCurveTo(cx - U * 0.1, cy - U * 0.14, cx + U * 0.14, cy - U * 0.06); ctx.quadraticCurveTo(cx + U * 0.3, cy, cx + U * 0.34, cy - U * 0.1); ctx.quadraticCurveTo(cx + U * 0.2, cy + U * 0.16, cx - U * 0.04, cy + U * 0.14); ctx.lineTo(cx - U * 0.36, cy + U * 0.22); ctx.closePath(); ctx.fillStyle = '#f7f8fa'; ctx.fill(); edge();
      ctx.beginPath(); ctx.moveTo(cx - U * 0.02, cy - U * 0.04); ctx.quadraticCurveTo(cx + U * 0.02, cy - U * 0.4, cx + U * 0.26, cy - U * 0.38); ctx.quadraticCurveTo(cx + U * 0.16, cy - U * 0.14, cx + U * 0.08, cy - U * 0.02); ctx.closePath(); ctx.fillStyle = '#f7f8fa'; ctx.fill(); edge();
      disc(cx + U * 0.26, cy - U * 0.08, U * 0.012, '#1f232e', 0);
      poly([cx + U * 0.34, cy - U * 0.1, cx + U * 0.42, cy - U * 0.08, cx + U * 0.34, cy - U * 0.05], '#ffc53d', 0);
      leaf(cx + U * 0.4, cy - U * 0.02, U * 0.04, 1.2, '#6fb88a');
    }),
    'lily': O(function (cx, cy) {
      shadow(cx, cy + U * 0.42, U * 0.14, U * 0.03);
      line([cx, cy + U * 0.42, cx + U * 0.02, cy + U * 0.02], '#6fb88a', U * 0.02);
      leaf(cx - U * 0.1, cy + U * 0.3, U * 0.12, -0.8, '#6fb88a');
      for (var i = 0; i < 6; i++) { var a = -Math.PI / 2 + (i / 6) * Math.PI * 2; ctx.save(); ctx.translate(cx, cy - U * 0.04); ctx.rotate(a + Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(U * 0.12, -U * 0.14, U * 0.3, -U * 0.02); ctx.quadraticCurveTo(U * 0.12, U * 0.1, 0, 0); ctx.fillStyle = '#f7f8fa'; ctx.fill(); edge(U * 0.008); ctx.restore(); }
      for (var k = 0; k < 5; k++) { var b = (k / 5) * Math.PI * 2; line([cx, cy - U * 0.04, cx + Math.cos(b) * U * 0.1, cy - U * 0.04 + Math.sin(b) * U * 0.1], '#c8e0b0', U * 0.008); disc(cx + Math.cos(b) * U * 0.11, cy - U * 0.04 + Math.sin(b) * U * 0.11, U * 0.018, '#e2b23a', 0); }
    }),
    // ===== Holiday objects
    'gift-stack': O(function (cx, cy) {
      shadow(cx, cy + U * 0.42, U * 0.36, U * 0.05);
      box(cx - U * 0.34, cy + U * 0.1, U * 0.68, U * 0.32, U * 0.02, '#2d9c6f'); box(cx - U * 0.04, cy + U * 0.1, U * 0.08, U * 0.32, 0, '#f2c94c', 0);
      box(cx - U * 0.24, cy - U * 0.16, U * 0.48, U * 0.26, U * 0.02, '#d93a4a'); box(cx - U * 0.24, cy - U * 0.06, U * 0.48, U * 0.06, 0, '#f7f8fa', 0);
      box(cx - U * 0.14, cy - U * 0.36, U * 0.28, U * 0.2, U * 0.02, '#5aa9ff'); box(cx - U * 0.03, cy - U * 0.36, U * 0.06, U * 0.2, 0, '#f2c94c', 0);
      oval(cx - U * 0.07, cy - U * 0.4, U * 0.06, U * 0.035, '#f2c94c', U * 0.008, -0.4); oval(cx + U * 0.07, cy - U * 0.4, U * 0.06, U * 0.035, '#f2c94c', U * 0.008, 0.4);
    }),
    'string-lights': function (W, H) {
      ctx.beginPath(); ctx.moveTo(0, H * 0.3); ctx.quadraticCurveTo(W / 2, H * 0.7, W, H * 0.3); ctx.strokeStyle = '#2c3040'; ctx.lineWidth = H * 0.012; ctx.stroke();
      var cols = ['255,80,80', '255,200,60', '80,220,140', '90,170,255', '230,120,255'];
      for (var i = 0; i < 9; i++) {
        var t = (i + 0.5) / 9, x = W * t, y = H * 0.3 + (H * 0.4 - H * 0.3) * 2 * t * (1 - t) * 2 + H * 0.06;
        var on = 0.5 + 0.5 * Math.sin(P * Math.PI * 2 * 2 + i * 1.3);
        box(x - H * 0.02, y - H * 0.04, H * 0.04, H * 0.05, H * 0.01, '#3a3f4a', 0);
        blob(x, y + H * 0.08, H * 0.16, cols[i % 5], 0.35 * on);
        oval(x, y + H * 0.08, H * 0.05, H * 0.07, rgba(cols[i % 5], 0.5 + 0.5 * on), H * 0.006);
      }
    },
    'lantern': O(function (cx, cy) {
      shadow(cx, cy + U * 0.42, U * 0.2, U * 0.04);
      line([cx, cy - U * 0.44, cx, cy - U * 0.32], '#3a3f4a', U * 0.015);
      box(cx - U * 0.14, cy - U * 0.34, U * 0.28, U * 0.06, U * 0.01, '#e2b23a');
      blob(cx, cy, U * 0.3, '255,170,90', 0.3);
      oval(cx, cy + U * 0.02, U * 0.3, U * 0.3, '#ff7a59');
      for (var i = -2; i <= 2; i++) { ctx.beginPath(); ctx.ellipse(cx, cy + U * 0.02, U * 0.3 * Math.abs(i) / 2.5 + U * 0.02, U * 0.3, 0, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(120,40,20,0.35)'; ctx.lineWidth = U * 0.008; ctx.stroke(); }
      box(cx - U * 0.12, cy + U * 0.28, U * 0.24, U * 0.05, U * 0.01, '#e2b23a');
      line([cx - U * 0.04, cy + U * 0.33, cx - U * 0.04, cy + U * 0.42], '#e2b23a', U * 0.012); line([cx + U * 0.04, cy + U * 0.33, cx + U * 0.04, cy + U * 0.42], '#e2b23a', U * 0.012);
    }),
    'bauble': O(function (cx, cy) {
      shadow(cx, cy + U * 0.42, U * 0.2, U * 0.04);
      arc(cx, cy - U * 0.44, U * 0.06, Math.PI * 0.2, Math.PI * 1.8, '#9aa3b2', U * 0.015);
      box(cx - U * 0.06, cy - U * 0.36, U * 0.12, U * 0.08, U * 0.01, '#e2b23a');
      disc(cx, cy + U * 0.04, U * 0.3, '#d93a4a');
      arc(cx, cy + U * 0.04, U * 0.3, Math.PI * 0.86, Math.PI * 1.14, '#f2c94c', U * 0.03); arc(cx, cy + U * 0.04, U * 0.3, -Math.PI * 0.14, Math.PI * 0.14, '#f2c94c', U * 0.03);
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy + U * 0.04, U * 0.3, 0, Math.PI * 2); ctx.clip(); for (var i = 0; i < 5; i++) star(cx - U * 0.24 + i * U * 0.12, cy + U * 0.04 + (i % 2 ? U * 0.08 : -U * 0.08), U * 0.04, U * 0.018, 5, '#f2c94c', 0); ctx.restore();
      gloss(cx, cy + U * 0.04, U * 0.3);
    }),
    'fir-tree': O(function (cx, cy) {
      shadow(cx, cy + U * 0.44, U * 0.3, U * 0.05);
      box(cx - U * 0.06, cy + U * 0.3, U * 0.12, U * 0.14, U * 0.01, '#6b4a2b');
      for (var k = 0; k < 3; k++) { var y = cy + U * 0.32 - k * U * 0.2, w = U * (0.36 - k * 0.08); poly([cx - w, y, cx, y - U * 0.3, cx + w, y], '#2d7a4f'); }
      var cols = ['#d93a4a', '#f2c94c', '#5aa9ff'];
      for (var i = 0; i < 9; i++) disc(cx + (hash(i) - 0.5) * U * (0.2 + (i % 3) * 0.14), cy + U * 0.26 - (i % 3) * U * 0.2 - hash(i + 4) * U * 0.1, U * 0.03, cols[i % 3], U * 0.006);
      star(cx, cy - U * 0.42, U * 0.07, U * 0.03, 5, '#f2c94c');
    }),
    'candy-cane': O(function (cx, cy) {
      shadow(cx, cy + U * 0.42, U * 0.14, U * 0.03);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(0.3);
      ctx.beginPath(); ctx.moveTo(-U * 0.1, U * 0.42); ctx.lineTo(-U * 0.1, -U * 0.2); ctx.arc(0, -U * 0.2, U * 0.1, Math.PI, 0); ctx.lineTo(U * 0.1, -U * 0.06); ctx.strokeStyle = '#f7f8fa'; ctx.lineWidth = U * 0.1; ctx.lineCap = 'round'; ctx.stroke();
      ctx.save(); ctx.lineWidth = U * 0.1; ctx.strokeStyle = '#d93a4a'; ctx.setLineDash([U * 0.07, U * 0.07]); ctx.stroke(); ctx.restore();
      ctx.strokeStyle = INK; ctx.lineWidth = U * 0.012; ctx.beginPath(); ctx.moveTo(-U * 0.15, U * 0.42); ctx.lineTo(-U * 0.15, -U * 0.2); ctx.arc(0, -U * 0.2, U * 0.15, Math.PI, 0); ctx.lineTo(U * 0.15, -U * 0.06); ctx.stroke();
      ctx.restore();
    }),
    'champagne-cork-pop': O(function (cx, cy) {
      var f = P;
      shadow(cx, cy + U * 0.44, U * 0.16, U * 0.03);
      ctx.beginPath(); ctx.moveTo(cx - U * 0.12, cy + U * 0.44); ctx.lineTo(cx - U * 0.12, cy + U * 0.02); ctx.quadraticCurveTo(cx - U * 0.12, cy - U * 0.12, cx - U * 0.05, cy - U * 0.16); ctx.lineTo(cx - U * 0.05, cy - U * 0.3); ctx.lineTo(cx + U * 0.05, cy - U * 0.3); ctx.lineTo(cx + U * 0.05, cy - U * 0.16); ctx.quadraticCurveTo(cx + U * 0.12, cy - U * 0.12, cx + U * 0.12, cy + U * 0.02); ctx.lineTo(cx + U * 0.12, cy + U * 0.44); ctx.closePath(); ctx.fillStyle = '#1f5a3a'; ctx.fill(); edge();
      box(cx - U * 0.12, cy + U * 0.1, U * 0.24, U * 0.18, U * 0.01, '#f7f1e6', 0);
      box(cx - U * 0.06, cy - U * 0.3, U * 0.12, U * 0.1, 0, '#f2c94c', 0);
      var cy2 = cy - U * 0.34 - f * U * 0.6, cx2 = cx + f * U * 0.2;
      box(cx2 - U * 0.05, cy2 - U * 0.08, U * 0.1, U * 0.1, U * 0.02, '#c8955a');
      if (f > 0) for (var i = 0; i < 20; i++) { var g = Math.min(1, f * 1.5); var a = -Math.PI / 2 + (hash(i) - 0.5) * 1.4, d = U * (0.1 + hash(i + 3) * 0.4) * g; blob(cx + Math.cos(a) * d, cy - U * 0.32 + Math.sin(a) * d + U * 0.2 * g * g, U * 0.012, '255,245,200', (1 - g) * 0.9 + 0.1); }
    }),
    'heart-balloon': O(function (cx, cy) {
      shadow(cx, cy + U * 0.44, U * 0.1, U * 0.025);
      ctx.beginPath(); ctx.moveTo(cx, cy + U * 0.16); ctx.quadraticCurveTo(cx + U * 0.06, cy + U * 0.3, cx - U * 0.02, cy + U * 0.44); ctx.strokeStyle = 'rgba(80,80,90,0.8)'; ctx.lineWidth = U * 0.006; ctx.stroke();
      heart(cx, cy - U * 0.06, U * 0.26, '#e8475a');
      poly([cx - U * 0.03, cy + U * 0.2, cx + U * 0.03, cy + U * 0.2, cx, cy + U * 0.15], '#e8475a', 0);
      blob(cx - U * 0.12, cy - U * 0.2, U * 0.08, '255,255,255', 0.5);
    }),
    'love-letter': O(function (cx, cy) {
      shadow(cx, cy + U * 0.3, U * 0.34, U * 0.06);
      box(cx - U * 0.34, cy - U * 0.2, U * 0.68, U * 0.44, U * 0.02, '#fde2ea');
      poly([cx - U * 0.34, cy - U * 0.2, cx, cy + U * 0.06, cx + U * 0.34, cy - U * 0.2], 'rgba(0,0,0,0)', U * 0.012);
      line([cx - U * 0.34, cy + U * 0.24, cx - U * 0.08, cy + U * 0.02], INK, U * 0.012); line([cx + U * 0.34, cy + U * 0.24, cx + U * 0.08, cy + U * 0.02], INK, U * 0.012);
      heart(cx, cy + U * 0.04, U * 0.09, '#e8475a');
    }),
    'rose-stem': O(function (cx, cy) {
      shadow(cx, cy + U * 0.44, U * 0.12, U * 0.03);
      line([cx + U * 0.02, cy + U * 0.44, cx - U * 0.02, cy - U * 0.02], '#2d7a4f', U * 0.025);
      leaf(cx - U * 0.12, cy + U * 0.22, U * 0.1, -1.1, '#6fb88a'); leaf(cx + U * 0.12, cy + U * 0.1, U * 0.1, 1.1, '#6fb88a');
      disc(cx, cy - U * 0.14, U * 0.17, '#c22a3b');
      for (var i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(cx, cy - U * 0.14, U * (0.13 - i * 0.04), Math.PI * (0.2 + i * 0.5), Math.PI * (1.4 + i * 0.5)); ctx.strokeStyle = 'rgba(80,10,20,0.6)'; ctx.lineWidth = U * 0.012; ctx.stroke(); }
      for (var k = 0; k < 4; k++) { var a = Math.PI * 0.3 + k * 0.45; leaf(cx + Math.cos(a) * U * 0.16, cy - U * 0.14 + Math.sin(a) * U * 0.14, U * 0.07, a - Math.PI / 2, '#2d7a4f'); }
    }),
    'easter-egg': O(function (cx, cy) {
      shadow(cx, cy + U * 0.4, U * 0.24, U * 0.05);
      ctx.beginPath(); ctx.moveTo(cx, cy - U * 0.38); ctx.bezierCurveTo(cx + U * 0.36, cy - U * 0.3, cx + U * 0.3, cy + U * 0.36, cx, cy + U * 0.36); ctx.bezierCurveTo(cx - U * 0.3, cy + U * 0.36, cx - U * 0.36, cy - U * 0.3, cx, cy - U * 0.38); ctx.closePath(); ctx.fillStyle = '#9ad1ff'; ctx.fill(); edge();
      ctx.save(); ctx.clip();
      ctx.fillStyle = '#ffc53d'; ctx.fillRect(cx - U * 0.4, cy - U * 0.1, U * 0.8, U * 0.08); ctx.fillStyle = '#f9a8d4'; ctx.fillRect(cx - U * 0.4, cy + U * 0.1, U * 0.8, U * 0.06);
      for (var i = 0; i < 6; i++) disc(cx - U * 0.3 + i * U * 0.12, cy - U * 0.24, U * 0.03, '#f7f8fa', 0);
      for (var k = 0; k < 7; k++) { var x = cx - U * 0.3 + k * U * 0.1; line([x, cy + U * 0.3, x + U * 0.05, cy + U * 0.22, x + U * 0.1, cy + U * 0.3], '#2d9c6f', U * 0.015); }
      ctx.restore();
      gloss(cx, cy - U * 0.1, U * 0.3);
    }),
    'tulip-pair': O(function (cx, cy) {
      shadow(cx, cy + U * 0.44, U * 0.24, U * 0.04);
      for (var k = 0; k < 2; k++) {
        var x = cx - U * 0.12 + k * U * 0.24, col = k ? '#ffc53d' : '#e8475a';
        line([x, cy + U * 0.44, x, cy - U * 0.04], '#2d7a4f', U * 0.025);
        leaf(x + (k ? U * 0.12 : -U * 0.12), cy + U * 0.22, U * 0.16, k ? 0.9 : -0.9, '#6fb88a');
        ctx.beginPath(); ctx.moveTo(x - U * 0.14, cy - U * 0.26); ctx.quadraticCurveTo(x - U * 0.12, cy + U * 0.02, x, cy + U * 0.02); ctx.quadraticCurveTo(x + U * 0.12, cy + U * 0.02, x + U * 0.14, cy - U * 0.26); ctx.lineTo(x + U * 0.07, cy - U * 0.14); ctx.lineTo(x, cy - U * 0.28); ctx.lineTo(x - U * 0.07, cy - U * 0.14); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); edge();
      }
    }),
    'chick': O(function (cx, cy) {
      shadow(cx, cy + U * 0.38, U * 0.26, U * 0.05);
      oval(cx, cy + U * 0.1, U * 0.28, U * 0.24, '#ffd23d');
      disc(cx + U * 0.02, cy - U * 0.18, U * 0.2, '#ffd23d');
      oval(cx - U * 0.2, cy + U * 0.08, U * 0.12, U * 0.07, '#f2b51d', U * 0.01, -0.5);
      disc(cx + U * 0.1, cy - U * 0.2, U * 0.025, '#1f232e', 0);
      poly([cx + U * 0.2, cy - U * 0.14, cx + U * 0.3, cy - U * 0.1, cx + U * 0.2, cy - U * 0.06], '#ff7a59');
      line([cx - U * 0.06, cy + U * 0.34, cx - U * 0.06, cy + U * 0.42], '#ff7a59', U * 0.02); line([cx + U * 0.08, cy + U * 0.34, cx + U * 0.08, cy + U * 0.42], '#ff7a59', U * 0.02);
      line([cx - U * 0.1, cy + U * 0.42, cx - U * 0.02, cy + U * 0.42], '#ff7a59', U * 0.02); line([cx + U * 0.04, cy + U * 0.42, cx + U * 0.12, cy + U * 0.42], '#ff7a59', U * 0.02);
      for (var i = 0; i < 3; i++) line([cx - U * 0.02 + i * U * 0.04, cy - U * 0.36, cx - U * 0.04 + i * U * 0.05, cy - U * 0.44], '#ffd23d', U * 0.02);
    }),
    'jack-o-lantern': O(function (cx, cy) {
      shadow(cx, cy + U * 0.4, U * 0.34, U * 0.06);
      var glow = 0.6 + 0.4 * Math.abs(Math.sin(P * Math.PI * 6 + 1));
      box(cx - U * 0.04, cy - U * 0.42, U * 0.08, U * 0.14, U * 0.02, '#2d7a4f');
      oval(cx, cy + U * 0.04, U * 0.36, U * 0.3, '#e8702a');
      for (var i = -1; i <= 1; i += 2) { ctx.beginPath(); ctx.ellipse(cx + i * U * 0.14, cy + U * 0.04, U * 0.14, U * 0.3, 0, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(120,50,10,0.4)'; ctx.lineWidth = U * 0.012; ctx.stroke(); }
      ctx.fillStyle = rgba('255,210,90', glow);
      poly([cx - U * 0.22, cy - U * 0.02, cx - U * 0.08, cy - U * 0.1, cx - U * 0.1, cy + U * 0.04], rgba('255,210,90', glow), 0);
      poly([cx + U * 0.22, cy - U * 0.02, cx + U * 0.08, cy - U * 0.1, cx + U * 0.1, cy + U * 0.04], rgba('255,210,90', glow), 0);
      poly([cx, cy + U * 0.06, cx - U * 0.05, cy + U * 0.14, cx + U * 0.05, cy + U * 0.14], rgba('255,210,90', glow), 0);
      poly([cx - U * 0.24, cy + U * 0.16, cx - U * 0.14, cy + U * 0.22, cx - U * 0.08, cy + U * 0.16, cx, cy + U * 0.24, cx + U * 0.08, cy + U * 0.16, cx + U * 0.14, cy + U * 0.22, cx + U * 0.24, cy + U * 0.16, cx + U * 0.16, cy + U * 0.3, cx - U * 0.16, cy + U * 0.3], rgba('255,210,90', glow), 0);
      blob(cx, cy + U * 0.08, U * 0.3, '255,170,60', 0.15 * glow);
    }),
    'witch-hat': O(function (cx, cy) {
      shadow(cx, cy + U * 0.4, U * 0.36, U * 0.06);
      oval(cx, cy + U * 0.26, U * 0.4, U * 0.1, '#2c2040');
      ctx.beginPath(); ctx.moveTo(cx - U * 0.22, cy + U * 0.26); ctx.quadraticCurveTo(cx - U * 0.04, cy - U * 0.1, cx + U * 0.18, cy - U * 0.42); ctx.quadraticCurveTo(cx + U * 0.1, cy - U * 0.1, cx + U * 0.22, cy + U * 0.26); ctx.closePath(); ctx.fillStyle = '#3a2a5a'; ctx.fill(); edge();
      ctx.beginPath(); ctx.moveTo(cx - U * 0.2, cy + U * 0.2); ctx.quadraticCurveTo(cx, cy + U * 0.12, cx + U * 0.2, cy + U * 0.2); ctx.lineTo(cx + U * 0.18, cy + U * 0.1); ctx.quadraticCurveTo(cx, cy + U * 0.02, cx - U * 0.18, cy + U * 0.1); ctx.closePath(); ctx.fillStyle = '#6f2dbd'; ctx.fill(); edge(U * 0.008);
      box(cx - U * 0.04, cy + U * 0.08, U * 0.08, U * 0.1, U * 0.01, '#f2c94c');
    }),
    'pumpkin-pie': O(function (cx, cy) {
      shadow(cx, cy + U * 0.36, U * 0.36, U * 0.06);
      poly([cx - U * 0.36, cy + U * 0.26, cx, cy - U * 0.28, cx + U * 0.36, cy + U * 0.26], '#d9742b');
      poly([cx - U * 0.36, cy + U * 0.26, cx - U * 0.36, cy + U * 0.36, cx + U * 0.36, cy + U * 0.36, cx + U * 0.36, cy + U * 0.26], '#c8955a');
      ctx.beginPath(); ctx.moveTo(cx - U * 0.36, cy + U * 0.26); ctx.quadraticCurveTo(cx, cy + U * 0.42, cx + U * 0.36, cy + U * 0.26); ctx.lineTo(cx + U * 0.36, cy + U * 0.36); ctx.quadraticCurveTo(cx, cy + U * 0.52, cx - U * 0.36, cy + U * 0.36); ctx.closePath(); ctx.fillStyle = '#e2b23a'; ctx.fill(); edge();
      for (var i = 0; i < 5; i++) disc(cx + U * 0.06, cy - U * 0.06, U * 0.06, '#f7f8fa', 0); disc(cx + U * 0.1, cy - U * 0.1, U * 0.05, '#f7f8fa', 0); disc(cx + U * 0.02, cy - U * 0.1, U * 0.045, '#f7f8fa', 0);
    }),
    'roast-turkey': O(function (cx, cy) {
      shadow(cx, cy + U * 0.4, U * 0.4, U * 0.06);
      oval(cx, cy + U * 0.3, U * 0.42, U * 0.1, '#e6e9ef');
      oval(cx, cy + U * 0.06, U * 0.3, U * 0.24, '#b8742f');
      oval(cx - U * 0.24, cy - U * 0.06, U * 0.12, U * 0.07, '#c8894a', U * 0.01, 0.6); oval(cx + U * 0.24, cy - U * 0.06, U * 0.12, U * 0.07, '#c8894a', U * 0.01, -0.6);
      line([cx - U * 0.14, cy - U * 0.1, cx - U * 0.26, cy - U * 0.32], '#c8894a', U * 0.05); line([cx + U * 0.14, cy - U * 0.1, cx + U * 0.26, cy - U * 0.32], '#c8894a', U * 0.05);
      disc(cx - U * 0.28, cy - U * 0.34, U * 0.04, '#f7f8fa'); disc(cx + U * 0.28, cy - U * 0.34, U * 0.04, '#f7f8fa');
      blob(cx - U * 0.1, cy - U * 0.06, U * 0.1, '255,230,180', 0.35);
      for (var i = 0; i < 4; i++) leaf(cx - U * 0.36 + i * U * 0.24, cy + U * 0.3, U * 0.05, Math.PI / 2, '#6fb88a');
    }),
    'beach-ball': O(function (cx, cy) {
      shadow(cx, cy + U * 0.36, U * 0.28, U * 0.05);
      var cols = ['#d93a4a', '#f7f8fa', '#2d7ff9', '#f7f8fa', '#ffc53d', '#f7f8fa'];
      for (var i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, U * 0.32, (i / 6) * Math.PI * 2, ((i + 1) / 6) * Math.PI * 2); ctx.closePath(); ctx.fillStyle = cols[i]; ctx.fill(); }
      disc(cx, cy, U * 0.32, 'rgba(0,0,0,0)');
      disc(cx, cy, U * 0.05, '#f7f8fa', U * 0.008);
      ballShade(cx, cy, U * 0.32);
    }),
    'sunshine': O(function (cx, cy) {
      var rot = P * Math.PI * 2 / 12;
      for (var i = 0; i < 12; i++) { var a = rot + (i / 12) * Math.PI * 2; ctx.save(); ctx.translate(cx, cy); ctx.rotate(a); poly([U * 0.26, -U * 0.05, U * 0.44, 0, U * 0.26, U * 0.05], '#ffc53d'); ctx.restore(); }
      blob(cx, cy, U * 0.34, '255,220,100', 0.4);
      disc(cx, cy, U * 0.22, '#ffd23d');
      gloss(cx, cy, U * 0.22);
    }),
    'ice-cream-cone': O(function (cx, cy) {
      shadow(cx, cy + U * 0.44, U * 0.1, U * 0.025);
      poly([cx - U * 0.18, cy + U * 0.02, cx + U * 0.18, cy + U * 0.02, cx, cy + U * 0.44], '#d9a066');
      ctx.save(); ctx.beginPath(); ctx.moveTo(cx - U * 0.18, cy + U * 0.02); ctx.lineTo(cx + U * 0.18, cy + U * 0.02); ctx.lineTo(cx, cy + U * 0.44); ctx.closePath(); ctx.clip(); ctx.strokeStyle = 'rgba(120,70,20,0.4)'; ctx.lineWidth = U * 0.008; for (var i = -4; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(cx + i * U * 0.08 - U * 0.3, cy + U * 0.5); ctx.lineTo(cx + i * U * 0.08 + U * 0.3, cy - U * 0.1); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx + i * U * 0.08 + U * 0.3, cy + U * 0.5); ctx.lineTo(cx + i * U * 0.08 - U * 0.3, cy - U * 0.1); ctx.stroke(); } ctx.restore();
      disc(cx, cy - U * 0.02, U * 0.2, '#f9a8d4'); disc(cx - U * 0.08, cy - U * 0.22, U * 0.16, '#fde2ea'); disc(cx + U * 0.1, cy - U * 0.26, U * 0.15, '#ffd6a0');
      disc(cx + U * 0.1, cy - U * 0.4, U * 0.04, '#d93a4a');
    }),
    'waving-flag': function (W, H) {
      line([W * 0.1, H * 0.95, W * 0.1, H * 0.05], '#6b7280', H * 0.03); disc(W * 0.1, H * 0.05, H * 0.03, '#f2c94c');
      var x0 = W * 0.12, w = W * 0.72, rows = 7;
      for (var k = 0; k < rows; k++) {
        var y = H * 0.1 + k * H * 0.1;
        ctx.beginPath();
        for (var i = 0; i <= 20; i++) { var t = i / 20, off = Math.sin(P * Math.PI * 2 + t * 5) * H * 0.04 * t; ctx.lineTo(x0 + w * t, y + off); }
        for (var j = 20; j >= 0; j--) { var t2 = j / 20, off2 = Math.sin(P * Math.PI * 2 + t2 * 5) * H * 0.04 * t2; ctx.lineTo(x0 + w * t2, y + H * 0.1 + off2); }
        ctx.closePath(); ctx.fillStyle = k % 2 ? '#f7f8fa' : '#d93a4a'; ctx.fill();
      }
      ctx.beginPath(); for (var p = 0; p <= 8; p++) { var t3 = p / 8 * 0.4, o3 = Math.sin(P * Math.PI * 2 + t3 * 5) * H * 0.04 * t3; ctx.lineTo(x0 + w * t3, H * 0.1 + o3); } for (var q = 8; q >= 0; q--) { var t4 = q / 8 * 0.4, o4 = Math.sin(P * Math.PI * 2 + t4 * 5) * H * 0.04 * t4; ctx.lineTo(x0 + w * t4, H * 0.4 + o4); } ctx.closePath(); ctx.fillStyle = '#1f4fa3'; ctx.fill();
      for (var s = 0; s < 6; s++) star(x0 + W * 0.05 + (s % 3) * W * 0.1, H * (0.17 + Math.floor(s / 3) * 0.14) + Math.sin(P * Math.PI * 2 + (s % 3) * 0.6) * H * 0.01, H * 0.03, H * 0.013, 5, '#f7f8fa', 0);
    },
    'rosette-ribbon': O(function (cx, cy) {
      shadow(cx, cy + U * 0.42, U * 0.2, U * 0.04);
      poly([cx - U * 0.14, cy + U * 0.1, cx - U * 0.02, cy + U * 0.1, cx - U * 0.08, cy + U * 0.42, cx - U * 0.2, cy + U * 0.36], '#1f4fa3'); poly([cx + U * 0.14, cy + U * 0.1, cx + U * 0.02, cy + U * 0.1, cx + U * 0.08, cy + U * 0.42, cx + U * 0.2, cy + U * 0.36], '#d93a4a');
      for (var i = 0; i < 16; i++) { var a = (i / 16) * Math.PI * 2; ctx.save(); ctx.translate(cx, cy - U * 0.08); ctx.rotate(a); poly([U * 0.16, -U * 0.07, U * 0.3, 0, U * 0.16, U * 0.07], i % 2 ? '#d93a4a' : '#f7f8fa', U * 0.006); ctx.restore(); }
      disc(cx, cy - U * 0.08, U * 0.18, '#1f4fa3');
      star(cx, cy - U * 0.08, U * 0.1, U * 0.045, 5, '#f7f8fa', 0);
    })
  };
  Object.keys(OBJECTS).forEach(function (k) { DRAW[k] = OBJECTS[k]; });
`;
