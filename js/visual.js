// Desenho no canvas: simulacao do bordado, mapa de direcoes e percurso da agulha.

function frame(cmds, W, H, pad) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [t, x, y] of cmds) { if (t === 'C') continue; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const k = Math.min((W - 2 * pad) / Math.max(1, x1 - x0), (H - 2 * pad) / Math.max(1, y1 - y0));
  const ox = (W - (x1 - x0) * k) / 2, oy = (H - (y1 - y0) * k) / 2;
  return { k, f: (x, y) => [ox + (x - x0) * k, H - (oy + (y - y0) * k)] };
}

function shade(rgb, f) { return `rgb(${rgb.map(v => Math.max(0, Math.min(255, Math.round(v * f)))).join(',')})`; }
function lift(rgb, a) { return `rgb(${rgb.map(v => Math.round(v + (255 - v) * a)).join(',')})`; }

export function drawFabric(ctx, W, H, fabric) {
  ctx.fillStyle = fabric; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.06; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
  for (let y = 0; y < H; y += 3) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke(); }
  for (let x = 0; x < W; x += 3) { ctx.globalAlpha = 0.03; ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke(); }
  ctx.globalAlpha = 1;
}

// simulacao realista: espessura da linha ~0.4 mm, sombra e brilho
export function drawStitches(canvas, cmds, colors, fabric = '#e7e4dd') {
  const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  drawFabric(ctx, W, H, fabric);
  if (!cmds.length) return;
  const { k, f } = frame(cmds, W, H, 24);
  const wpx = Math.max(1.2, 4 * k); // 0.4 mm em unidades de 0.1 mm
  ctx.lineCap = 'round';
  let ci = 0, last = null, afterJump = false;
  for (const [t, x, y] of cmds) {
    if (t === 'C') { ci++; last = null; continue; }
    const p = f(x, y);
    if (t === 'S' && last && !afterJump) {
      const c = colors[ci % colors.length] || [30, 50, 140];
      ctx.strokeStyle = (c[0] + c[1] + c[2]) < 150 ? 'rgba(0,0,0,.35)' : shade(c, 0.55); ctx.lineWidth = wpx + 1.2;
      ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
      ctx.strokeStyle = (c[0] + c[1] + c[2]) < 150 ? lift(c, 0.12) : shade(c, 1); ctx.lineWidth = wpx * 0.85;
      ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
      const dark = (c[0] + c[1] + c[2]) < 150;
      ctx.strokeStyle = lift(c, dark ? 0.35 : 0.45); ctx.lineWidth = Math.max(0.6, wpx / 4);
      ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
    }
    afterJump = t === 'J'; last = p;
  }
}

// percurso da agulha: pontos a cinzento, saltos/cortes a vermelho tracejado
export function drawPath(canvas, cmds, ink, jumpCol) {
  const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (!cmds.length) return;
  const { f } = frame(cmds, W, H, 24);
  let last = null;
  ctx.lineWidth = 0.8;
  for (const [t, x, y] of cmds) {
    if (t === 'C') continue;
    const p = f(x, y);
    if (last) {
      ctx.strokeStyle = t === 'J' ? jumpCol : ink;
      ctx.setLineDash(t === 'J' ? [4, 3] : []);
      ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
    }
    last = p;
  }
  ctx.setLineDash([]);
}

const HUES = [[66, 133, 244], [234, 67, 53], [251, 188, 5], [52, 168, 83], [171, 71, 188], [0, 172, 193], [255, 112, 67], [124, 179, 66], [92, 107, 192], [240, 98, 146]];

// mapa de direcoes: cada parte com a sua cor e tracinhos na direcao do ponto
export function drawDirections(canvas, info, cmds, ink) {
  const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (!cmds.length) return;
  const { k, f } = frame(cmds, W, H, 24); // k: px por 0.1 mm
  const img = ctx.getImageData(0, 0, W, H);
  let n = 0;
  for (const reg of info) {
    const g = reg.grid;
    for (const part of reg.parts) {
      const col = HUES[n++ % HUES.length];
      const light = col.map(c => Math.round(c * 0.35 + 255 * 0.65));
      // pintar a parte: percorrer pixels do canvas dentro da caixa da regiao
      const [ax, ay] = f(g.x0 * 10, g.y1 * 10), [bx, by] = f((g.x0 + g.W * g.res) * 10, (g.y1 - g.H * g.res) * 10);
      for (let py = Math.max(0, Math.floor(ay)); py < Math.min(H, Math.ceil(by)); py++) {
        for (let px = Math.max(0, Math.floor(ax)); px < Math.min(W, Math.ceil(bx)); px++) {
          const mx = (g.x0 * 10 + (px - ax) / k) / 10, my = (g.y1 * 10 - (py - ay) / k) / 10;
          if (g.look(reg.labels, mx, my) === part.id) {
            const i = (py * W + px) * 4; img.data[i] = light[0]; img.data[i + 1] = light[1]; img.data[i + 2] = light[2]; img.data[i + 3] = 255;
          }
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  n = 0;
  ctx.lineCap = 'round';
  for (const reg of info) {
    const g = reg.grid;
    for (const part of reg.parts) {
      const col = HUES[n++ % HUES.length];
      if (part.rails) { // cetim rotativo: tracinhos ao longo da curva
        ctx.strokeStyle = `rgb(${col.map(c => Math.round(c * 0.7)).join(',')})`; ctx.lineWidth = 2;
        const every = Math.max(4, Math.round(14 / (k * 10) / 0.1));
        for (let i = 0; i < part.rails.length; i += every) {
          const r = part.rails[i], c0 = f(r.c[0] * 10, r.c[1] * 10);
          const ux = r.n[0], uy = r.n[1], h = Math.min(r.w * 0.38, 0.6 * every * 0.1) * 10 * k;
          ctx.beginPath(); ctx.moveTo(c0[0] - ux * h, c0[1] + uy * h); ctx.lineTo(c0[0] + ux * h, c0[1] - uy * h); ctx.stroke();
        }
        continue;
      }
      const a = part.ang * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a);
      const step = Math.max(1.2, 14 / k / 10); // mm entre tracinhos (~14 px)
      ctx.strokeStyle = `rgb(${col.map(c => Math.round(c * 0.7)).join(',')})`; ctx.lineWidth = 2;
      const xs0 = g.x0, ys1 = g.y1, xs1 = g.x0 + g.W * g.res, ys0 = g.y1 - g.H * g.res;
      for (let my = Math.floor(ys0 / step) * step; my <= ys1; my += step) {
        for (let mx = Math.floor(xs0 / step) * step; mx <= xs1; mx += step) {
          if (g.look(reg.labels, mx, my) !== part.id) continue;
          const [px, py] = f(mx * 10, my * 10), h = step * 10 * k * 0.38;
          ctx.beginPath(); ctx.moveTo(px - ux * h, py + uy * h); ctx.lineTo(px + ux * h, py - uy * h); ctx.stroke();
        }
      }
    }
  }
}
