import { satinSpacing } from './motor.js';
// Cetim rotativo: para tracos curvos sem cruzamentos (S, C, O, U...), o ponto
// acompanha a curva. Linha central = esqueleto da forma; em cada ponto da linha
// central lanca-se a perpendicular ate as bordas exatas do vetor (os "carris").


const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ---------------------------------------------------------------- esqueleto
// Afinamento de Zhang-Suen sobre a mascara (1 = forma)
function thin(mask, W, H) {
  const m = Uint8Array.from(mask);
  const del = [];
  let changed = true;
  const P = (r, c) => (r < 0 || r >= H || c < 0 || c >= W) ? 0 : m[r * W + c];
  while (changed) {
    changed = false;
    for (const step of [0, 1]) {
      del.length = 0;
      for (let r = 1; r < H - 1; r++) for (let c = 1; c < W - 1; c++) {
        if (!m[r * W + c]) continue;
        const p2 = P(r - 1, c), p3 = P(r - 1, c + 1), p4 = P(r, c + 1), p5 = P(r + 1, c + 1),
          p6 = P(r + 1, c), p7 = P(r + 1, c - 1), p8 = P(r, c - 1), p9 = P(r - 1, c - 1);
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
        let A = 0; for (let k = 0; k < 8; k++) if (!seq[k] && seq[k + 1]) A++;
        if (A !== 1) continue;
        if (step === 0 && (p2 * p4 * p6 || p4 * p6 * p8)) continue;
        if (step === 1 && (p2 * p4 * p8 || p2 * p6 * p8)) continue;
        del.push(r * W + c);
      }
      for (const i of del) m[i] = 0;
      if (del.length) changed = true;
    }
  }
  return m;
}

function neighbors8(i, W, H, sk) {
  const r = (i / W) | 0, c = i - r * W, out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && rr < H && cc >= 0 && cc < W && sk[rr * W + cc]) out.push(rr * W + cc);
  }
  return out;
}

// distancia de cada pixel da forma a borda (chamfer 3-4, em pixeis)
function distanceTransform(mask, W, H) {
  const D = new Float32Array(W * H);
  for (let i = 0; i < D.length; i++) D[i] = mask[i] ? 1e9 : 0;
  const at = (r, c) => (r < 0 || r >= H || c < 0 || c >= W) ? 0 : D[r * W + c];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const i = r * W + c; if (!D[i]) continue;
    D[i] = Math.min(D[i], at(r, c - 1) + 3, at(r - 1, c) + 3, at(r - 1, c - 1) + 4, at(r - 1, c + 1) + 4);
  }
  for (let r = H - 1; r >= 0; r--) for (let c = W - 1; c >= 0; c--) {
    const i = r * W + c; if (!D[i]) continue;
    D[i] = Math.min(D[i], at(r, c + 1) + 3, at(r + 1, c) + 3, at(r + 1, c + 1) + 4, at(r + 1, c - 1) + 4);
  }
  for (let i = 0; i < D.length; i++) D[i] /= 3;
  return D;
}

// remove ramos soltos curtos (espinhos do esqueleto)
function prune(sk, W, H, maxLen) {
  for (let pass = 0; pass < 6; pass++) {
    let removed = false;
    const ends = [];
    for (let i = 0; i < sk.length; i++) if (sk[i] && neighbors8(i, W, H, sk).length === 1) ends.push(i);
    for (const e of ends) {
      if (!sk[e]) continue;
      const path = [e]; let prev = -1, cur = e;
      for (;;) {
        const nb = neighbors8(cur, W, H, sk).filter(j => j !== prev && !path.includes(j));
        if (nb.length !== 1) break;
        prev = cur; cur = nb[0];
        if (neighbors8(cur, W, H, sk).length > 2) break;
        path.push(cur);
        if (path.length > maxLen) break;
      }
      const atJunction = neighbors8(cur, W, H, sk).length > 2;
      if (path.length <= maxLen && atJunction) { for (const p of path) sk[p] = 0; removed = true; }
    }
    if (!removed) break;
  }
}

// ordena o esqueleto num caminho (ou laco). Devolve null se tiver cruzamentos.
function trace(sk, W, H) {
  const pts = []; for (let i = 0; i < sk.length; i++) if (sk[i]) pts.push(i);
  if (pts.length < 5) return null;
  // limpar "cantos" de 2 pixeis que criam falsos cruzamentos
  let junctions = 0, ends = [];
  for (const i of pts) {
    const n = neighbors8(i, W, H, sk).length;
    if (n === 1) ends.push(i);
    if (n > 2) {
      // e cruzamento real se os vizinhos nao forem adjacentes entre si
      const nb = neighbors8(i, W, H, sk);
      const groups = nb.filter(j => !nb.some(k => k !== j && k < j && Math.abs(((k / W) | 0) - ((j / W) | 0)) <= 1 && Math.abs(k % W - j % W) <= 1));
      if (groups.length > 2) junctions++;
    }
  }
  _dbg.j = junctions; _dbg.e = ends.length; _dbg.n = pts.length;
  if (junctions > 0) return null;
  const loop = ends.length === 0;
  if (!loop && ends.length !== 2) return null;
  const start = loop ? pts[0] : ends[0];
  const order = [start]; const seen = new Set([start]); let cur = start;
  for (;;) {
    const nb = neighbors8(cur, W, H, sk).filter(j => !seen.has(j));
    if (!nb.length) break;
    // preferir vizinhos ortogonais (caminho mais limpo)
    nb.sort((a, b) => (Math.abs(a - cur) === 1 || Math.abs(a - cur) === W ? 0 : 1) - (Math.abs(b - cur) === 1 || Math.abs(b - cur) === W ? 0 : 1));
    cur = nb[0]; seen.add(cur); order.push(cur);
  }
  _dbg.o = order.length;
  if (order.length < pts.length * 0.9) return null; // sobrou esqueleto: forma ramificada
  return { order, loop };
}

// ---------------------------------------------------------------- geometria
function smooth(pts, win, loop) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    let sx = 0, sy = 0, k = 0;
    for (let j = -win; j <= win; j++) {
      let q = i + j;
      if (loop) q = (q + n) % n; else if (q < 0 || q >= n) continue;
      sx += pts[q][0]; sy += pts[q][1]; k++;
    }
    out.push([sx / k, sy / k]);
  }
  return out;
}

function resample(pts, step, loop) {
  const src = loop ? [...pts, pts[0]] : pts;
  const out = [src[0]]; let acc = 0;
  for (let i = 0; i + 1 < src.length; i++) {
    const a = src[i], b = src[i + 1], d = dist(a, b);
    let t = step - acc;
    while (t <= d) { out.push([a[0] + (b[0] - a[0]) * t / d, a[1] + (b[1] - a[1]) * t / d]); t += step; }
    acc = d - (t - step);
  }
  if (loop) out.pop();
  return out;
}

// distancia ao longo de +dir ate a borda mais proxima do poligono
function rayHit(rings, p, d, maxS) {
  let best = Infinity;
  for (const r of rings) {
    const n = r.length;
    for (let i = 0; i < n; i++) {
      const a = r[i], b = r[(i + 1) % n];
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const den = d[0] * ey - d[1] * ex;
      if (Math.abs(den) < 1e-12) continue;
      const ax = a[0] - p[0], ay = a[1] - p[1];
      const s = (ax * ey - ay * ex) / den, t = (ax * d[1] - ay * d[0]) / den;
      if (s > 1e-6 && t >= 0 && t <= 1 && s < best) best = s;
    }
  }
  return best <= maxS ? best : null;
}

// ---------------------------------------------------------------- coluna
// Tenta tratar a regiao inteira como uma coluna de cetim rotativo.
export let _why = '';
export const _dbg = {};

// caminho mais longo dentro do esqueleto (diametro por BFS duplo); 'blocked' corta o anel
function longestPath(sk, W, H, blocked) {
  const N = sk.length;
  const bfs = (src) => {
    const D = new Int32Array(N).fill(-1), prev = new Int32Array(N).fill(-1);
    const q = [src]; D[src] = 0; let far = src;
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      if (D[i] > D[far]) far = i;
      for (const j of neighbors8(i, W, H, sk)) if (D[j] < 0 && !blocked[j]) { D[j] = D[i] + 1; prev[j] = i; q.push(j); }
    }
    return { far, prev, D };
  };
  let start = -1; for (let i = 0; i < N; i++) if (sk[i] && !blocked[i]) { start = i; break; }
  if (start < 0) return null;
  const a = bfs(start).far, r = bfs(a), path = [];
  for (let i = r.far; i >= 0; i = r.prev[i]) path.push(i);
  return path;
}

export function turningColumn(rings, g, P) {
  _why = '';
  const RES = g.res;
  // recusa rapida: largura media = 2 x area / perimetro (formas largas nao sao tracos de cetim)
  {
    let A = 0, per = 0;
    rings.forEach((r, k) => { let s = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; s += p[0] * q[1] - q[0] * p[1]; per += Math.hypot(q[0] - p[0], q[1] - p[1]); } A += (k === 0 ? 1 : -1) * Math.abs(s / 2); });
    if (2 * A / Math.max(per, 1e-6) > P.satin_max * 2.2) { _why = 'largo (rapido)'; return null; }
  }
  const { W, H } = g;
  const sk = thin(g.mask, W, H);
  const skPts = []; for (let i = 0; i < sk.length; i++) if (sk[i]) skPts.push(i);
  if (skPts.length < 10) { _why = 'pequeno'; return null; }
  // anel (uma letra com um furo, ex.: O): cortar o esqueleto num ponto e fechar no fim
  const loop = rings.length === 2;
  const blocked = new Uint8Array(sk.length);
  if (loop) {
    let cut = skPts[0];
    for (const i of skPts) if ((i % W) > (cut % W)) cut = i; // ponto mais a direita
    const cr = (cut / W) | 0, cc = cut % W;
    for (const i of skPts) if (Math.abs(((i / W) | 0) - cr) <= 1 && Math.abs((i % W) - cc) <= 1) blocked[i] = 1;
  } else if (rings.length > 2) { _why = 'varios furos'; return null; }
  const path = longestPath(sk, W, H, blocked);
  if (!path || path.length < 10) { _why = 'sem caminho'; return null; }
  if (loop) { // o caminho tem de dar a volta completa (P, A, D com pernas nao servem)
    const a = path[0], b = path[path.length - 1];
    if (Math.hypot((a % W) - (b % W), ((a / W) | 0) - ((b / W) | 0)) > 5) { _why = 'anel com pernas'; return null; }
  }
  const DT = distanceTransform(g.mask, W, H);
  let line = path.map(i => g.mm(i % W, (i / W) | 0));
  // largura tipica ao longo do caminho
  const widths = [];
  for (let k = 0; k < line.length; k += 4) {
    const a = line[Math.max(0, k - 3)], b = line[Math.min(line.length - 1, k + 3)];
    const tx = b[0] - a[0], ty = b[1] - a[1], L = Math.hypot(tx, ty) || 1;
    const n = [-ty / L, tx / L];
    const s1 = rayHit(rings, line[k], n, 20), s2 = rayHit(rings, line[k], [-n[0], -n[1]], 20);
    if (s1 !== null && s2 !== null) widths.push(s1 + s2);
  }
  if (!widths.length) { _why = 'sem largura'; return null; }
  widths.sort((a, b) => a - b);
  const wmed = widths[widths.length >> 1];
  // tracos largos tambem servem: acima do cetim maximo os pontos sao divididos (enchimento que acompanha a curva)
  if (wmed > P.satin_max * 3) { _why = 'largo ' + wmed.toFixed(2); return null; }
  let extFrom = 0, extTo = 0;
  if (line.length * RES < wmed * 2.2) { _why = 'curto'; return null; }
  line = resample(smooth(line, Math.max(2, Math.round(wmed * 0.5 / RES)), loop), 0.1, loop);
  if (!loop) {
    // prolongar as pontas ate a borda (remates obliquos do S, por ex.)
    const ext = (p0, p1) => {
      const L = dist(p0, p1) || 1, u = [(p0[0] - p1[0]) / L, (p0[1] - p1[1]) / L], add = [];
      for (let s = 0.1; s < wmed * 1.5; s += 0.1) {
        const q = [p0[0] + u[0] * s, p0[1] + u[1] * s];
        if (!g.look(g.mask, q[0], q[1])) break;
        add.push(q);
      }
      return add;
    };
    const head = ext(line[0], line[Math.min(6, line.length - 1)]).reverse();
    const tail = ext(line[line.length - 1], line[Math.max(0, line.length - 7)]);
    // pontas: as ultimas ~0.6 larguras tambem contam como zona de remate
    const tip = Math.round(wmed * 0.6 / 0.1);
    extFrom = head.length + tip; extTo = head.length + line.length - tip;
    line = [...head, ...line, ...tail];
  } else { extFrom = 0; extTo = line.length; }
  // tracos largos com curvas muito apertadas (cantos do D grande, etc.) ficam para o metodo por partes
  if (wmed > 2.0) {
    const h = Math.max(3, Math.round(wmed * 0.5 / 0.1)), nn = line.length;
    for (let i = 0; i < nn; i++) {
      if (!loop && (i < h || i + h >= nn)) continue;
      const a = line[(i - h + nn) % nn], b = line[i], c = line[(i + h) % nn];
      let d = Math.abs(Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]));
      if (d > Math.PI) d = 2 * Math.PI - d;
      if (d > 75 * Math.PI / 180) { _why = 'curva apertada num traco largo'; return null; }
    }
  }
  // carris: perpendicular exata ate ao vetor
  const n = line.length, R = [];
  const tw = 4;
  let missing = 0, wideMain = 0;
  for (let i = 0; i < n; i++) {
    let a, b;
    if (loop) { a = line[(i - tw + n) % n]; b = line[(i + tw) % n]; }
    else { a = line[Math.max(0, i - tw)]; b = line[Math.min(n - 1, i + tw)]; }
    const tx = b[0] - a[0], ty = b[1] - a[1], L = Math.hypot(tx, ty) || 1;
    const nn = [-ty / L, tx / L], c = line[i];
    const s1 = rayHit(rings, c, nn, P.satin_max * 4), s2 = rayHit(rings, c, [-nn[0], -nn[1]], P.satin_max * 4);
    if (s1 === null || s2 === null) { missing++; continue; }
    // centro fora da letra (pontas suavizadas) ou largura absurda: ignorar este carril
    const main = i >= extFrom && i < extTo;
    if (!g.look(g.mask, c[0], c[1])) { if (main) missing++; continue; }
    if (s1 + s2 > Math.max(2.2 * wmed, wmed + 1)) { if (main) wideMain++; continue; }
    R.push({ i, c, L: [c[0] + nn[0] * s1, c[1] + nn[1] * s1], R: [c[0] - nn[0] * s2, c[1] - nn[1] * s2], w: s1 + s2, n: nn, t: [tx / L, ty / L] });
  }
  if (R.length < 10 || missing > n * 0.05) { _why = 'carris falham'; return null; }
  // a perpendicular nao pode atravessar outro ramo (ex.: braco do meio do E)
  let wide = wideMain;
  for (const r of R) {
    if (r.i < extFrom || r.i >= extTo) continue;
    const loc = 2 * g.look(DT, r.c[0], r.c[1]) * RES;
    if (loc > 0 && r.w > loc * 1.7 + 0.4) wide++;
  }
  _dbg.wide = wide;
  if (wide > Math.max(2, R.length * 0.02)) { _why = 'atravessa ramo'; return null; }
  // teste 1: o lado de dentro nao pode andar para tras (canto vivo -> raios cruzam-se)
  let back = 0;
  for (let i = 0; i + 1 < R.length; i++) {
    for (const s of ['L', 'R']) {
      const d = [R[i + 1][s][0] - R[i][s][0], R[i + 1][s][1] - R[i][s][1]];
      if (d[0] * R[i].t[0] + d[1] * R[i].t[1] < -0.03) back++;
    }
  }
  // teste 2: as faixas entre carris cobrem a forma quase toda e nao saem dela
  const cov = new Uint8Array(W * H);
  const quads = [];
  for (let i = 0; i + 1 < R.length; i++) quads.push([R[i].L, R[i + 1].L, R[i + 1].R, R[i].R]);
  if (loop) quads.push([R[R.length - 1].L, R[0].L, R[0].R, R[R.length - 1].R]);
  for (const q of quads) fillQuad(cov, g, q);
  let inShape = 0, covered = 0, outside = 0;
  for (let i = 0; i < cov.length; i++) {
    if (g.mask[i]) { inShape++; if (cov[i]) covered++; } else if (cov[i]) outside++;
  }
  const coverage = covered / Math.max(1, inShape), spill = outside / Math.max(1, covered + outside);
  const backFrac = back / (2 * R.length);
  _dbg.cov = +coverage.toFixed(3); _dbg.spill = +spill.toFixed(3); _dbg.back = +backFrac.toFixed(3);
  if (coverage < 0.965) { _why = 'nao cobre (ramos/cantos)'; return null; }
  _dbg.backN = back;
  if (back >= 3 || backFrac > 0.02) { _why = 'canto vivo'; return null; }
  if (loop) R.push(...R.slice(0, 8)); // fechar o laco com 0.8 mm de sobreposicao
  return { rails: R, loop, wmed, line };
}

function fillQuad(m, g, q) {
  const P = q.map(([x, y]) => g.px(x, y));
  let ymin = Infinity, ymax = -Infinity;
  for (const p of P) { ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]); }
  for (let r = Math.max(0, Math.ceil(ymin)); r <= Math.min(g.H - 1, Math.floor(ymax)); r++) {
    const xs = [];
    for (let i = 0; i < 4; i++) { const a = P[i], b = P[(i + 1) % 4]; if ((a[1] > r) !== (b[1] > r)) xs.push(a[0] + (r - a[1]) * (b[0] - a[0]) / (b[1] - a[1])); }
    xs.sort((u, v) => u - v);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let c = Math.max(0, Math.floor(xs[k])); c <= Math.min(g.W - 1, Math.ceil(xs[k + 1])); c++) m[r * g.W + c] = 1;
  }
}

// ziguezague que roda com a curva.
// Um ponto novo (alternando lados) sempre que o carril que anda mais depressa (o de fora
// da curva) avancou meio espacamento desde o ultimo ponto: assim cada lado fica com
// 'sp' entre pontos no lado de fora; o lado de dentro fica mais denso e leva pontos curtos.
export function turningSatin(col, P) {
  const sp = satinSpacing(col.wmed, P) / (P.density || 1);
  const pts = []; let last = null, side = 0, prevSame = [null, null], shortToggle = false;
  const pcOf = (w) => Math.min(0.3, Math.max(0.1, 0.1 + 0.04 * w));
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const at = (i, t) => {
    const a = col.rails[i], b = col.rails[Math.min(i + 1, col.rails.length - 1)];
    return { c: lerp(a.c, b.c, t), L: lerp(a.L, b.L, t), R: lerp(a.R, b.R, t), w: a.w + (b.w - a.w) * t };
  };
  const moved = (r) => Math.max(dist(r.L, last.L), dist(r.R, last.R));
  const stations = [];
  last = col.rails[0]; stations.push(last);
  for (let i = 0; i + 1 < col.rails.length; i++) {
    let t0 = 0;
    // pode haver varios pontos dentro do mesmo troco (lado de fora a andar depressa)
    for (let guard = 0; guard < 20; guard++) {
      if (moved(at(i, 1)) < sp) break;
      let lo = t0, hi = 1;
      for (let it = 0; it < 18; it++) { const m = (lo + hi) / 2; if (moved(at(i, m)) < sp) lo = m; else hi = m; }
      last = at(i, hi); stations.push(last); t0 = hi;
    }
  }
  // cada estacao: ponto direito de um lado ao outro (L -> R) e regresso inclinado para a seguinte,
  // como no cetim feito a mao no DG17 (pontas de cada lado alinhadas)
  let stIdx = 0;
  for (const r of stations) {
    stIdx++;
    for (const sd of [0, 1]) {
      let rail = sd === 0 ? r.L : r.R;
      const pc = pcOf(r.w);
      const out = [rail[0] - r.c[0], rail[1] - r.c[1]], ol = Math.hypot(out[0], out[1]) || 1;
      rail = [rail[0] + out[0] / ol * pc, rail[1] + out[1] / ol * pc];
      // lado de dentro da curva apertado: encurtar um ponto sim, um nao (evita amontoar linha)
      const ps = prevSame[sd];
      if (ps && dist(ps, rail) < sp * 0.6) {
        shortToggle = !shortToggle;
        if (shortToggle) rail = [r.c[0] + (rail[0] - r.c[0]) * 0.6, r.c[1] + (rail[1] - r.c[1]) * 0.6];
      }
      if (pts.length) {
        const q = pts[pts.length - 1], d = dist(q, rail);
        if (d > P.satin_max) {
          // passagem larga: dividir em pontos de ~3,5 mm, desencontrados em 3 fases (como o tatami)
          const L = P.fill_len || 3.5, k = Math.max(2, Math.ceil(d / L)), ph = ((stIdx % 3) - 1) / 3;
          for (let j = 1; j < k; j++) { const f = Math.min(0.94, Math.max(0.06, (j + ph * 0.8) / k)); pts.push([q[0] + (rail[0] - q[0]) * f, q[1] + (rail[1] - q[1]) * f]); }
        }
      }
      pts.push(rail);
      prevSame[sd] = rail;
    }
  }
  return pts;
}

// base: ida por um lado e volta pelo outro (a 0.4 mm da borda), ou corrida ao centro se estreito
export function turningUnderlay(col, P) {
  const R = col.rails, step = Math.max(1, Math.round(P.run_len / 0.1));
  if (col.wmed < 1.0) return null;
  if (col.wmed < 2.2) {
    const out = []; for (let i = 0; i < R.length; i += step) out.push(R[i].c); out.push(R[R.length - 1].c);
    return out;
  }
  const inset = (r, side) => {
    const p = side ? r.L : r.R, d = dist(p, r.c) || 1, k = Math.max(0, (d - 0.45) / d);
    return [r.c[0] + (p[0] - r.c[0]) * k, r.c[1] + (p[1] - r.c[1]) * k];
  };
  const go = [], back = [];
  for (let i = 0; i < R.length; i += step) go.push(inset(R[i], 1));
  go.push(inset(R[R.length - 1], 1));
  for (let i = R.length - 1; i >= 0; i -= step) back.push(inset(R[i], 0));
  back.push(inset(R[0], 0));
  return [...go, ...back];
}
