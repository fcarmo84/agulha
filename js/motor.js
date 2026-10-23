// Motor de digitalizacao automatica: formas vetoriais -> pontos de bordado.
// Cada forma (letra) e dividida em partes; cada parte recebe a direcao de ponto
// que atravessa o traco. Partes estreitas -> cetim; largas -> tatami.
// Regras de durabilidade: nenhum ponto > 7 mm, cetim dividido acima de 6 mm,
// base de ponto, compensacao de repuxo, ligacoes escondidas e remates.

export const RES = 0.1; // mm por pixel na analise

export const PARAM = {
  satin_max: 6.0,
  satin_spacing: 0.40,
  satin_spacing_fino: 0.45,
  fill_spacing: 0.42,
  fill_len: 3.5,
  run_len: 2.0,
  angle_step: 15,
  min_stitch: 0.3,
  max_stitch: 7.0,
  overlap_px: 2,
  density: 1.0, // multiplicador: >1 mais denso
};

const D2R = Math.PI / 180;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ------------------------------------------------------------------ raster
// Preenche poligonos (regra par-impar) numa mascara W x H; pts em coordenadas de pixel.
export function fillPolys(mask, W, H, polys, value = 1) {
  let ymin = Infinity, ymax = -Infinity;
  for (const p of polys) for (const q of p) { if (q[1] < ymin) ymin = q[1]; if (q[1] > ymax) ymax = q[1]; }
  const r0 = Math.max(0, Math.ceil(ymin)), r1 = Math.min(H - 1, Math.floor(ymax));
  const xs = [];
  for (let r = r0; r <= r1; r++) {
    xs.length = 0;
    for (const p of polys) {
      const n = p.length;
      for (let i = 0; i < n; i++) {
        const a = p[i], b = p[(i + 1) % n];
        if ((a[1] > r) !== (b[1] > r)) xs.push(a[0] + (r - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
    }
    xs.sort((u, v) => u - v);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil(xs[k])), c1 = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let c = c0; c <= c1; c++) mask[r * W + c] = value;
    }
  }
}

export class Grid {
  constructor(rings, pad = 6) {
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (const r of rings) for (const [x, y] of r) {
      if (x < xmin) xmin = x; if (x > xmax) xmax = x; if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    }
    this.x0 = xmin; this.y1 = ymax; this.pad = pad;
    this.W = Math.ceil((xmax - xmin) / RES) + 2 * pad;
    this.H = Math.ceil((ymax - ymin) / RES) + 2 * pad;
    this.mask = new Uint8Array(this.W * this.H);
    fillPolys(this.mask, this.W, this.H, rings.map(r => r.map(([x, y]) => this.px(x, y))));
  }
  px(x, y) { return [(x - this.x0) / RES + this.pad, (this.y1 - y) / RES + this.pad]; }
  mm(c, r) { return [this.x0 + (c - this.pad) * RES, this.y1 - (r - this.pad) * RES]; }
  look(m, x, y) {
    let c = Math.round((x - this.x0) / RES + this.pad), r = Math.round((this.y1 - y) / RES + this.pad);
    c = Math.min(this.W - 1, Math.max(0, c)); r = Math.min(this.H - 1, Math.max(0, r));
    return m[r * this.W + c];
  }
}

function morph(m, W, H, iters, dilate) {
  let a = m;
  for (let it = 0; it < iters; it++) {
    const b = new Uint8Array(W * H);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      let v = dilate ? 0 : 1;
      for (let dr = -1; dr <= 1 && (dilate ? !v : v); dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        const s = (rr < 0 || rr >= H || cc < 0 || cc >= W) ? (dilate ? 0 : 1) : a[rr * W + cc];
        if (dilate && s) { v = 1; break; }
        if (!dilate && !s) { v = 0; break; }
      }
      b[r * W + c] = v;
    }
    a = b;
  }
  return a;
}
const dilate = (m, W, H, n = 1) => morph(m, W, H, n, true);
const erode = (m, W, H, n = 1) => morph(m, W, H, n, false);
const and = (a, b) => { const o = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] && b[i] ? 1 : 0; return o; };

// comprimento da corda (mm) em cada pixel, para varios angulos
function chords(g, angles) {
  const { W, H, mask } = g;
  const D = Math.ceil(Math.hypot(H, W)) + 4;
  const cx = W / 2, cy = H / 2, c2 = D / 2;
  const out = [];
  for (const a of angles) {
    const ca = Math.cos(a * D2R), sa = Math.sin(a * D2R);
    // imagem rodada: pixel (X',Y') vem de R^T((X',Y')-c2)+c
    const rot = new Uint8Array(D * D);
    for (let Y = 0; Y < D; Y++) for (let X = 0; X < D; X++) {
      const dx = X - c2, dy = Y - c2;
      const sx = Math.round(ca * dx + sa * dy + cx), sy = Math.round(-sa * dx + ca * dy + cy);
      if (sx >= 0 && sx < W && sy >= 0 && sy < H) rot[Y * D + X] = mask[sy * W + sx];
    }
    const runs = new Uint16Array(D * D);
    for (let Y = 0; Y < D; Y++) {
      let X = 0;
      while (X < D) {
        if (!rot[Y * D + X]) { X++; continue; }
        let e = X; while (e < D && rot[Y * D + e]) e++;
        for (let k = X; k < e; k++) runs[Y * D + k] = e - X;
        X = e;
      }
    }
    const ch = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      const dx = x - cx, dy = y - cy;
      const X = Math.round(ca * dx - sa * dy + c2), Y = Math.round(sa * dx + ca * dy + c2);
      ch[y * W + x] = (X >= 0 && X < D && Y >= 0 && Y < D ? runs[Y * D + X] : 0) * RES;
    }
    out.push(ch);
  }
  return out;
}

function gaussBlur(src, W, H, s) {
  const k = (Math.floor(s * 3) | 1), h = k >> 1;
  const ker = new Float32Array(k); let sum = 0;
  for (let i = 0; i < k; i++) { ker[i] = Math.exp(-((i - h) ** 2) / (2 * s * s)); sum += ker[i]; }
  for (let i = 0; i < k; i++) ker[i] /= sum;
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 0;
    for (let i = 0; i < k; i++) { const xx = Math.min(W - 1, Math.max(0, x + i - h)); v += src[y * W + xx] * ker[i]; }
    tmp[y * W + x] = v;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 0;
    for (let i = 0; i < k; i++) { const yy = Math.min(H - 1, Math.max(0, y + i - h)); v += tmp[yy * W + x] * ker[i]; }
    out[y * W + x] = v;
  }
  return out;
}

function median(arr) {
  if (!arr.length) return 0;
  const a = Float64Array.from(arr).sort(); const n = a.length;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}
function percentile(arr, p) {
  if (!arr.length) return 0;
  const a = Float64Array.from(arr).sort(); const i = (a.length - 1) * p / 100;
  const lo = Math.floor(i), hi = Math.ceil(i); return a[lo] + (a[hi] - a[lo]) * (i - lo);
}

// ------------------------------------------------------------------ partes
export function splitParts(g, P) {
  const { W, H, mask } = g, N = W * H;
  const angs = []; for (let a = 0; a < 180; a += P.angle_step) angs.push(a);
  const C = chords(g, angs);
  const best = new Uint8Array(N), w = new Float32Array(N), anis = new Float32Array(N);
  const wl = [];
  for (let i = 0; i < N; i++) {
    if (!mask[i]) continue;
    let mn = Infinity, mx = 0, bi = 0;
    for (let k = 0; k < angs.length; k++) {
      const v = C[k][i];
      if (v > 0 && v < mn) { mn = v; bi = k; }
      if (v > mx) mx = v;
    }
    best[i] = bi; w[i] = mn === Infinity ? 0 : mn; wl.push(w[i]);
    anis[i] = Math.min(mx, 60) / Math.max(w[i], RES);
  }
  const wmed = wl.length ? median(wl) : 1;
  const core = new Uint8Array(N);
  for (let i = 0; i < N; i++) core[i] = mask[i] && anis[i] > 2.2 ? 1 : 0;

  const vx0 = new Float32Array(N), vy0 = new Float32Array(N), cf = new Float32Array(N);
  for (let i = 0; i < N; i++) if (core[i]) {
    const th = angs[best[i]] * D2R * 2; vx0[i] = Math.cos(th); vy0[i] = Math.sin(th); cf[i] = 1;
  }
  const s = Math.max(1, 0.35 * wmed / RES);
  const mw = gaussBlur(cf, W, H, s), bx = gaussBlur(vx0, W, H, s), by = gaussBlur(vy0, W, H, s);
  const vx = new Float32Array(N), vy = new Float32Array(N);
  for (let i = 0; i < N; i++) { const d = Math.max(mw[i], 1e-6); vx[i] = bx[i] / d; vy[i] = by[i] / d; }
  const nb = Math.round(180 / P.angle_step);
  const q = new Int16Array(N);
  for (let i = 0; i < N; i++) {
    const f = ((Math.atan2(vy[i], vx[i]) / D2R / 2) % 180 + 180) % 180;
    q[i] = ((Math.round(f / P.angle_step) % nb) + nb) % nb;
  }
  const meanAngle = (sel) => {
    let sx = 0, sy = 0;
    for (const i of sel) { sx += vx[i]; sy += vy[i]; }
    return ((Math.atan2(sy, sx) / D2R / 2) % 180 + 180) % 180;
  };

  // 1) nucleos por intervalo de angulo
  const L = new Int32Array(N); let nxt = 1;
  const minCore = Math.max(0.6 * wmed * wmed, 0.25) / (RES * RES);
  const seen = new Uint8Array(N);
  const stack = [];
  for (let i0 = 0; i0 < N; i0++) {
    if (!core[i0] || seen[i0]) continue;
    const b = q[i0], comp = [i0]; seen[i0] = 1; stack.length = 0; stack.push(i0);
    while (stack.length) {
      const i = stack.pop(), r = (i / W) | 0, c = i - r * W;
      const nbr = [r > 0 ? i - W : -1, r < H - 1 ? i + W : -1, c > 0 ? i - 1 : -1, c < W - 1 ? i + 1 : -1];
      for (const j of nbr) if (j >= 0 && !seen[j] && core[j] && q[j] === b) { seen[j] = 1; stack.push(j); comp.push(j); }
    }
    if (comp.length >= minCore) { for (const i of comp) L[i] = nxt; nxt++; }
  }
  if (nxt === 1) for (let i = 0; i < N; i++) if (mask[i]) L[i] = 1;
  // 2) o resto vai para o nucleo mais proximo (BFS por dentro da forma, depois por fora)
  for (const inside of [true, false]) {
    let front = [];
    for (let i = 0; i < N; i++) if (L[i] > 0) front.push(i);
    while (front.length) {
      const nf = [];
      for (const i of front) {
        const r = (i / W) | 0, c = i - r * W;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc; if (rr < 0 || rr >= H || cc < 0 || cc >= W) continue;
          const j = rr * W + cc;
          if (L[j] === 0 && (inside ? mask[j] : true)) { L[j] = L[i]; nf.push(j); }
        }
      }
      front = nf;
    }
  }
  for (let i = 0; i < N; i++) if (!mask[i]) L[i] = 0;

  const pixelsOf = () => { const m = new Map(); for (let i = 0; i < N; i++) if (L[i]) { if (!m.has(L[i])) m.set(L[i], []); m.get(L[i]).push(i); } return m; };
  const neighbors = (pix, id) => {
    const cnt = new Map();
    for (const i of pix) {
      const r = (i / W) | 0, c = i - r * W;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc; if (rr < 0 || rr >= H || cc < 0 || cc >= W) continue;
        const l = L[rr * W + cc]; if (l > 0 && l !== id) cnt.set(l, (cnt.get(l) || 0) + 1);
      }
    }
    return cnt;
  };
  // 3) partes pequenas juntam-se ao vizinho com mais fronteira
  let minA = Math.max(1.2 * wmed * wmed, 0.4) / (RES * RES);
  for (let it = 0; it < 40; it++) {
    const pm = pixelsOf(); if (pm.size <= 1) break;
    const small = [...pm.entries()].filter(([, p]) => p.length < minA).sort((a, b) => a[1].length - b[1].length);
    if (!small.length) break;
    const [id, pix] = small[0];
    const nbm = neighbors(pix, id);
    if (!nbm.size) { minA = 0; continue; }
    const tgt = [...nbm.entries()].sort((a, b) => b[1] - a[1])[0][0];
    for (const i of pix) L[i] = tgt;
  }
  // 4) vizinhos com direcoes quase iguais (< 8 graus) fundem-se
  let pm = pixelsOf();
  const ang0 = new Map();
  for (const [id, pix] of pm) {
    const cp = pix.filter(i => core[i]);
    ang0.set(id, meanAngle(cp.length ? cp : pix));
  }
  const parent = new Map([...pm.keys()].map(k => [k, k]));
  const find = (i) => { while (parent.get(i) !== i) i = parent.get(i); return i; };
  for (const [id, pix] of pm) {
    for (const j of neighbors(pix, id).keys()) {
      let d = Math.abs(ang0.get(id) - ang0.get(j)); d = Math.min(d, 180 - d);
      if (d < 8) parent.set(find(j), find(id));
    }
  }
  for (let i = 0; i < N; i++) if (L[i]) L[i] = find(L[i]);
  pm = pixelsOf();
  const angles = new Map();
  for (const [id, pix] of pm) {
    const cp = pix.filter(i => core[i]);
    angles.set(id, meanAngle(cp.length ? cp : pix));
  }
  return { L, angles, wmed };
}

// ------------------------------------------------------------------ linhas
export function scan(rings, angDeg, spacing, phase = 0) {
  const a = angDeg * D2R, c = Math.cos(a), s = Math.sin(a);
  const R = [[c, s], [-s, c]];
  const E = rings.map(r => r.map(([x, y]) => [c * x + s * y, -s * x + c * y]));
  let vmin = Infinity, vmax = -Infinity;
  for (const r of E) for (const p of r) { if (p[1] < vmin) vmin = p[1]; if (p[1] > vmax) vmax = p[1]; }
  let v = Math.floor((vmin - phase) / spacing) * spacing + phase + spacing / 2;
  const rows = [];
  while (v < vmax) {
    const xs = [];
    for (const r of E) {
      const n = r.length;
      for (let i = 0; i < n; i++) {
        const A = r[i], B = r[(i + 1) % n];
        if ((A[1] > v) !== (B[1] > v)) xs.push(A[0] + (v - A[1]) / (B[1] - A[1]) * (B[0] - A[0]));
      }
    }
    if (xs.length) {
      xs.sort((p, q) => p - q);
      const segs = [];
      for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1] - xs[k] > 0.05) segs.push([xs[k], xs[k + 1]]);
      if (segs.length) rows.push([v, segs]);
    }
    v += spacing;
  }
  return { rows, R };
}
const toXY = (R, u, v) => [R[0][0] * u + R[1][0] * v, R[0][1] * u + R[1][1] * v]; // R^T (u,v)

function cutRows(rows, R, g, m, minlen = 0.25) {
  const step = RES / 2, out = [];
  for (const [v, segs] of rows) {
    const pieces = [];
    for (const [u0, u1] of segs) {
      const n = Math.max(2, Math.floor((u1 - u0) / step) + 1);
      const us = []; for (let k = 0; k < n; k++) us.push(Math.min(u1, u0 + k * step));
      if (us[us.length - 1] < u1 - 1e-9 && n > 1) { /* ultimo ponto ~u1 */ }
      let start = -1;
      for (let k = 0; k <= n; k++) {
        const ok = k < n && g.look(m, ...toXY(R, us[k], v));
        if (ok && start < 0) start = k;
        if (!ok && start >= 0) {
          const a = start, b = k - 1;
          const ua = a === 0 ? u0 : us[a], ub = b === n - 1 ? u1 : us[b];
          if (ub - ua >= minlen) pieces.push([ua, ub, a === 0, b === n - 1]);
          start = -1;
        }
      }
    }
    if (pieces.length) out.push([v, pieces]);
  }
  return out;
}

function chain(rows) {
  const used = rows.map(([, p]) => p.map(() => false)); const blocks = [];
  for (let i0 = 0; i0 < rows.length; i0++) for (let k0 = 0; k0 < rows[i0][1].length; k0++) {
    if (used[i0][k0]) continue;
    const blk = [[i0, k0]]; used[i0][k0] = true; let i = i0, k = k0;
    while (i + 1 < rows.length) {
      const [a0, a1] = rows[i][1][k];
      const cand = rows[i + 1][1].findIndex((pc, kk) => !used[i + 1][kk] && pc[0] < a1 && pc[1] > a0);
      if (cand < 0) break;
      k = cand; i++; used[i][k] = true; blk.push([i, k]);
    }
    blocks.push(blk);
  }
  return blocks;
}

function splitLine(u0, u1, L) {
  const n = Math.max(1, Math.ceil((u1 - u0) / L)); const o = [];
  for (let k = 0; k <= n; k++) o.push(u0 + (u1 - u0) * k / n);
  return o;
}

function satin(rows, R, P) {
  const blocks = [];
  for (const blk of chain(rows)) {
    const pts = [];
    blk.forEach(([i, k], idx) => {
      const v = rows[i][0]; const [u0, u1, e0, e1] = rows[i][1][k];
      const w = u1 - u0, pc = Math.min(0.3, Math.max(0.1, 0.1 + 0.04 * w));
      const u = idx % 2 === 0 ? u0 - (e0 ? pc : 0) : u1 + (e1 ? pc : 0);
      const p = toXY(R, u, v);
      if (pts.length) {
        const q = pts[pts.length - 1], d = dist(p, q);
        if (d > P.satin_max) { // cetim dividido
          const n = Math.ceil(d / (P.satin_max * 0.75)), sh = (Math.floor(idx / 2) % 2) ? 0.12 : -0.12;
          for (let kk = 1; kk < n; kk++) {
            const f = Math.min(0.95, Math.max(0.05, kk / n + sh / n));
            pts.push([q[0] + (p[0] - q[0]) * f, q[1] + (p[1] - q[1]) * f]);
          }
        }
      }
      pts.push(p);
    });
    if (pts.length > 1) blocks.push(pts);
  }
  return blocks;
}

function tatami(rows, R, P) {
  const L = P.fill_len, blocks = [];
  for (const blk of chain(rows)) {
    const pts = []; let fwd = true;
    for (const [i, k] of blk) {
      const v = rows[i][0]; const [u0, u1] = rows[i][1][k];
      let line;
      if (u1 - u0 <= L * 1.6) line = [u0, u1];
      else {
        const off = (i % 3) * L / 3; line = [u0];
        for (let u = Math.floor((u0 - off) / L) * L + off; u < u1; u += L) if (u > u0 + 0.8 && u < u1 - 0.8) line.push(u);
        line.push(u1);
      }
      if (!fwd) line.reverse();
      fwd = !fwd;
      for (const u of line) pts.push(toXY(R, u, v));
    }
    if (pts.length > 1) blocks.push(pts);
  }
  return blocks;
}

function underlay(rows, R, P) {
  const blocks = [];
  for (const blk of chain(rows)) {
    const pts = []; let fwd = true;
    for (const [i, k] of blk) {
      const v = rows[i][0]; const [u0, u1] = rows[i][1][k];
      if (u1 - u0 < 0.5) continue;
      const line = splitLine(u0, u1, P.run_len);
      if (!fwd) line.reverse();
      fwd = !fwd;
      for (const u of line) pts.push(toXY(R, u, v));
    }
    if (pts.length > 1) blocks.push(pts);
  }
  return blocks;
}

function refineAngle(rings, g, m, a0) {
  const cost = (a) => {
    const { rows, R } = scan(rings, a, 0.4);
    const L = []; for (const [, ps] of cutRows(rows, R, g, m)) for (const p of ps) L.push(p[1] - p[0]);
    if (!L.length) return 1e9;
    return median(L) + 0.01 * L.reduce((s, x) => s + x, 0) / L.length;
  };
  const argmin = (list) => { let b = list[0], bc = Infinity; for (const a of list) { const c = cost(a); if (c < bc) { bc = c; b = a; } } return b; };
  const c1 = []; for (let a = a0 - 16; a <= a0 + 16.1; a += 2) c1.push(a);
  let best = argmin(c1);
  const c2 = []; for (let a = best - 1.5; a <= best + 1.6; a += 0.5) c2.push(a);
  best = argmin(c2);
  best = ((best % 180) + 180) % 180;
  for (const snap of [0, 45, 90, 135, 180]) if (Math.abs(best - snap) <= 3) best = snap % 180;
  return best;
}

// ------------------------------------------------------------------ regiao
export function digitizeRegion(rings, P, info) {
  const g = new Grid(rings);
  const { W, H } = g;
  const { L, angles } = splitParts(g, P);
  const parts = [];
  const gmaskEroded = erode(g.mask, W, H, 3);
  for (let [pid, a] of angles) {
    const m = new Uint8Array(W * H); for (let i = 0; i < m.length; i++) m[i] = L[i] === pid ? 1 : 0;
    a = refineAngle(rings, g, m, a);
    const big = and(dilate(m, W, H, P.overlap_px), g.mask);
    const small = and(erode(m, W, H, 3), gmaskEroded);
    const pr = scan(rings, a, 0.5);
    const probe = cutRows(pr.rows, pr.R, g, m);
    const Wd = []; for (const [, ps] of probe) for (const p of ps) Wd.push(p[1] - p[0]);
    if (!Wd.length) Wd.push(0);
    const isSatin = percentile(Wd, 90) <= P.satin_max;
    const wm = median(Wd);
    const blocks = [];
    if (wm >= 1.0) {
      const usp = (!isSatin || wm > 2.5) ? 1.8 : Math.max(0.8, wm * 0.55);
      const u = scan(rings, a + 90, usp, usp / 2);
      for (const b of underlay(cutRows(u.rows, u.R, g, small, 0.6), u.R, P)) blocks.push({ pts: b, kind: 'base' });
    }
    if (isSatin) {
      const sp = (wm < 1.2 ? P.satin_spacing_fino : P.satin_spacing) / P.density / 2;
      const r = scan(rings, a, sp);
      for (const b of satin(cutRows(r.rows, r.R, g, big), r.R, P)) blocks.push({ pts: b, kind: 'cetim' });
    } else {
      const r = scan(rings, a, P.fill_spacing / P.density);
      for (const b of tatami(cutRows(r.rows, r.R, g, big), r.R, P)) blocks.push({ pts: b, kind: 'tatami' });
    }
    for (const b of blocks) b.part = pid;
    parts.push({ id: pid, ang: a, mask: m, blocks, satin: isSatin, w: wm });
  }
  if (info) info.push({ grid: g, labels: L, parts });
  return sequence(parts, g, P);
}

function travelOk(g, sewn, a, b) {
  const d = dist(a, b);
  if (d < 0.05) return true;
  const n = Math.max(2, Math.floor(d / (RES / 2)));
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1), x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
    const near = t * d < 0.6 || (1 - t) * d < 0.6;
    if (near) continue;
    if (!g.look(g.inner, x, y) || g.look(sewn, x, y)) return false;
  }
  return true;
}

class Heap {
  constructor() { this.a = []; }
  push(x) { const a = this.a; a.push(x); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}

// caminho por dentro da letra (grelha 0.3 mm) evitando zonas ja bordadas
function route(g, sewn, a, b, cell = 0.3, maxSewn = 1.0) {
  const f = Math.round(cell / RES), { W, H } = g;
  const w = Math.floor(W / f), h = Math.floor(H / f);
  const inner = new Uint8Array(w * h), done = new Uint8Array(w * h);
  for (let r = 0; r < h * f; r++) for (let c = 0; c < w * f; c++) {
    const j = ((r / f) | 0) * w + ((c / f) | 0);
    if (g.inner[r * W + c]) inner[j] = 1;
    if (sewn[r * W + c]) done[j] = 1;
  }
  const cellOf = (p) => { const [X, Y] = g.px(p[0], p[1]); return [Math.min(h - 1, Math.max(0, (Y / f) | 0)), Math.min(w - 1, Math.max(0, (X / f) | 0))]; };
  const okCells = []; for (let j = 0; j < w * h; j++) if (inner[j]) okCells.push(j);
  if (!okCells.length) return null;
  const snap = ([r, c]) => {
    if (inner[r * w + c]) return r * w + c;
    let bj = -1, bd = Infinity;
    for (const j of okCells) { const d = Math.max(Math.abs(((j / w) | 0) - r), Math.abs((j % w) - c)); if (d < bd) { bd = d; bj = j; } }
    return bd * cell <= 1.2 ? bj : null;
  };
  const s = snap(cellOf(a)), t = snap(cellOf(b));
  if (s === null || t === null) return null;
  done[s] = 0; done[t] = 0;
  const D = new Float64Array(w * h).fill(Infinity), prev = new Int32Array(w * h).fill(-1);
  D[s] = 0; const pq = new Heap(); pq.push([0, s]);
  const nb8 = [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1], [-1, -1, 1.414], [-1, 1, 1.414], [1, -1, 1.414], [1, 1, 1.414]];
  while (pq.size) {
    const [d, u] = pq.pop();
    if (u === t) break;
    if (d > D[u]) continue;
    const ur = (u / w) | 0, uc = u % w;
    for (const [dy, dx, c] of nb8) {
      const vr = ur + dy, vc = uc + dx;
      if (vr < 0 || vr >= h || vc < 0 || vc >= w) continue;
      const v = vr * w + vc; if (!inner[v]) continue;
      const nd = d + c * (done[v] ? 12 : 1);
      if (nd < D[v]) { D[v] = nd; prev[v] = u; pq.push([nd, v]); }
    }
  }
  if (!isFinite(D[t])) return null;
  const cells = [t]; while (cells[cells.length - 1] !== s) cells.push(prev[cells[cells.length - 1]]);
  cells.reverse();
  let ns = 0; for (const c of cells) if (done[c]) ns++;
  if (ns * cell > maxSewn || cells.length * cell > 25) return null;
  const tomm = (j) => g.mm(((j % w) + 0.5) * f, (((j / w) | 0) + 0.5) * f);
  return [a, ...cells.slice(1, -1).map(tomm), b];
}

function resample(path, L) {
  const out = [path[0]]; let acc = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const p = path[i], q = path[i + 1], d = dist(p, q);
    if (d > L) {
      const n = Math.ceil(d / L);
      for (let k = 1; k <= n; k++) out.push([p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n]);
      acc = 0; continue;
    }
    acc += d;
    if (acc >= L) { out.push(q); acc = 0; }
  }
  if (dist(out[out.length - 1], path[path.length - 1]) > 1e-6) out.push(path[path.length - 1]);
  return out;
}

function markSewn(g, sewn, pts) {
  if (pts.length < 3) return;
  const P = pts.map(([x, y]) => g.px(x, y));
  const m = new Uint8Array(sewn.length);
  for (let k = 0; k + 2 < P.length; k++) fillPolys(m, g.W, g.H, [P.slice(k, k + 3)]);
  for (let i = 0; i < m.length; i++) if (m[i] && g.mask[i]) sewn[i] = 1;
}

function orient(blocks, cur) {
  const rest = blocks.slice(), out = [];
  while (rest.length) {
    let b;
    if (!cur) b = rest.shift();
    else {
      let bj = 0, brv = false, bd = Infinity;
      rest.forEach((x, j) => {
        for (const rv of [false, true]) { const d = dist(cur, rv ? x.pts[x.pts.length - 1] : x.pts[0]); if (d < bd) { bd = d; bj = j; brv = rv; } }
      });
      b = rest.splice(bj, 1)[0];
      if (brv) b = { ...b, pts: b.pts.slice().reverse() };
    }
    out.push(b); cur = b.pts[b.pts.length - 1];
  }
  return out;
}

function sequence(parts, g, P) {
  g.inner = erode(g.mask, g.W, g.H, 2);
  const sewn = new Uint8Array(g.W * g.H);
  const out = []; let cur = null;
  let rest = parts.filter(p => p.blocks.length);
  while (rest.length) {
    let p;
    if (!cur) {
      let bv = -Infinity;
      for (const c of rest) for (const b of c.blocks) for (const q of b.pts) { const v = q[1] - 0.2 * q[0]; if (v > bv) { bv = v; p = c; } }
    } else {
      const ends = (c) => c.blocks.flatMap(b => [b.pts[0], b.pts[b.pts.length - 1]]);
      const cand = rest.slice().sort((x, y) => Math.min(...ends(x).map(q => dist(cur, q))) - Math.min(...ends(y).map(q => dist(cur, q))));
      p = null;
      for (const c of cand) {
        const q = ends(c).reduce((a, b) => dist(cur, a) <= dist(cur, b) ? a : b);
        if (travelOk(g, sewn, cur, q) || route(g, sewn, cur, q)) { p = c; break; }
      }
      p = p || cand[0];
    }
    rest = rest.filter(x => x !== p);
    const base = p.blocks.filter(b => b.kind === 'base'), top = p.blocks.filter(b => b.kind !== 'base');
    for (const grp of [base, top]) {
      for (const b of orient(grp, cur)) {
        const pts = b.pts;
        let path = null;
        if (cur) path = travelOk(g, sewn, cur, pts[0]) ? [cur, pts[0]] : route(g, sewn, cur, pts[0]);
        if (path) out.push({ pts: resample(path, P.run_len).slice(1, -1).concat(pts), kind: b.kind, connect: true, part: p.id });
        else out.push({ pts, kind: b.kind, connect: false, part: p.id });
        cur = pts[pts.length - 1];
        if (grp === top) markSewn(g, sewn, pts);
      }
    }
    for (let i = 0; i < sewn.length; i++) if (p.mask[i]) sewn[i] = 1;
  }
  return out;
}

// ------------------------------------------------------------------ comandos
// colorGroups: [{color, blocks}] -> [[tipo, x, y]] em 0.1 mm ('S' ponto, 'J' salto, 'C' troca de cor)
export function toCommands(colorGroups, P) {
  const cmds = []; let cur = null;
  colorGroups.forEach((grp, ci) => {
    if (ci > 0 && cur) { lock(cmds, cur); cmds.push(['C', cur[0], cur[1]]); }
    for (const b of grp.blocks) {
      const raw = b.pts.map(([x, y]) => [Math.round(x * 10), Math.round(y * 10)]);
      const clean = [raw[0]];
      for (const p of raw.slice(1)) if (dist(p, clean[clean.length - 1]) >= P.min_stitch * 10) clean.push(p);
      if (clean.length < 2) continue;
      const pts = [clean[0]], mx = P.max_stitch * 10;
      for (const p of clean.slice(1)) {
        const q = pts[pts.length - 1], d = dist(q, p);
        if (d > mx) { const n = Math.ceil(d / (mx * 0.6)); for (let k = 1; k < n; k++) pts.push([Math.round(q[0] + (p[0] - q[0]) * k / n), Math.round(q[1] + (p[1] - q[1]) * k / n)]); }
        pts.push(p);
      }
      const firstOfColor = cmds.length === 0 || cmds[cmds.length - 1][0] === 'C';
      if (cur && !firstOfColor && (b.connect || dist(cur, pts[0]) <= 10)) {
        for (const p of pts) cmds.push(['S', p[0], p[1]]);
      } else {
        if (cur && !firstOfColor) lock(cmds, cur);
        cmds.push(['J', pts[0][0], pts[0][1]]);
        lock(cmds, pts[0], pts[1]);
        for (const p of pts.slice(1)) cmds.push(['S', p[0], p[1]]);
      }
      cur = pts[pts.length - 1];
    }
  });
  if (cur) { lock(cmds, cur); cmds.push(['J', 0, 0]); }
  return cmds;
}

function lock(cmds, at, toward) {
  if (!toward) {
    for (let i = cmds.length - 1; i >= 0; i--) {
      const c = cmds[i];
      if (c[0] === 'S' && (c[1] !== at[0] || c[2] !== at[1])) { toward = [c[1], c[2]]; break; }
    }
    if (!toward) return;
  }
  const d = dist(at, toward) || 1, ux = (toward[0] - at[0]) / d, uy = (toward[1] - at[1]) / d;
  for (const k of [1, 0, 1, 0]) cmds.push(['S', Math.round(at[0] + ux * 6 * k), Math.round(at[1] + uy * 6 * k)]);
}

// ------------------------------------------------------------------ desenho completo
const area = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
function inside(pt, r) {
  let c = false; const [x, y] = pt;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi) c = !c;
  }
  return c;
}
export function groupRegions(rings) {
  rings = rings.filter(r => Math.abs(area(r)) > 0.01);
  const A = rings.map(r => Math.abs(area(r)));
  const depth = rings.map((r, i) => rings.reduce((n, o, j) => n + (j !== i && A[j] > A[i] && inside(r[0], o) ? 1 : 0), 0));
  const regs = [];
  rings.forEach((r, i) => {
    if (depth[i] % 2 === 0) regs.push([r, ...rings.filter((h, j) => depth[j] === depth[i] + 1 && inside(h[0], r))]);
  });
  return regs;
}

// shapes: [{color:[r,g,b], rings:[[[x,y],...]]}] em mm, y para cima. Devolve {cmds, info, groups}
export function digitize(shapes, P = {}, onProgress) {
  P = { ...PARAM, ...P };
  const byCol = new Map();
  for (const s of shapes) {
    const k = s.color.join(',');
    if (!byCol.has(k)) byCol.set(k, { color: s.color, rings: [] });
    byCol.get(k).rings.push(...s.rings);
  }
  const groups = [], info = [];
  const allRegs = [...byCol.values()].map(c => groupRegions(c.rings));
  const total = allRegs.reduce((s, r) => s + r.length, 0); let done = 0;
  [...byCol.values()].forEach((col, ci) => {
    const regs = allRegs[ci];
    regs.sort((a, b) => {
      const ka = -Math.round(Math.max(...a[0].map(p => p[1])) / 4), kb = -Math.round(Math.max(...b[0].map(p => p[1])) / 4);
      return ka - kb || Math.min(...a[0].map(p => p[0])) - Math.min(...b[0].map(p => p[0]));
    });
    let per = regs.map(reg => { const r = digitizeRegion(reg, P, info); done++; onProgress && onProgress(done / total); return r; }).filter(b => b.length);
    const blocks = []; let cur = null;
    while (per.length) {
      let nxt = per[0];
      if (cur) nxt = per.reduce((a, b) => dist(cur, a[0].pts[0]) <= dist(cur, b[0].pts[0]) ? a : b);
      per = per.filter(x => x !== nxt); blocks.push(...nxt); cur = nxt[nxt.length - 1].pts.at(-1);
    }
    groups.push({ color: col.color, blocks });
  });
  const cmds = toCommands(groups, P);
  return { cmds, info, groups };
}
