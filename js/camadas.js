// Camadas de cor: agrupa as formas por cor de linha, aplica mascaras de recorte e
// retira de cada cor a parte tapada pelas formas pintadas por cima (com uma pequena
// sobreposicao por baixo, para nao abrir fendas entre cores).

import { fillPolys } from './motor.js';

// ---------------------------------------------------------------- cor
function rgbToLab([r, g, b]) {
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const deltaE = (a, b) => { const p = rgbToLab(a), q = rgbToLab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };

export function colorName(rgb) {
  const [r, g, b] = rgb, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 510;
  if (mx - mn < 20) return l > 0.9 ? 'Branco' : l < 0.15 ? 'Preto' : 'Cinzento';
  let h = 0; const d = mx - mn;
  if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (l < 0.35 && (h < 50 || h > 330)) return h < 15 || h > 330 ? 'Bordô' : 'Castanho escuro';
  if (h < 15 || h >= 345) return l > 0.75 ? 'Rosa' : 'Vermelho';
  if (h < 40) return l > 0.65 ? 'Bege' : l < 0.45 ? 'Castanho' : 'Laranja';
  const sat = d / (255 - Math.abs(mx + mn - 255) || 1);
  if (h < 75 && sat > 0.6 && l > 0.4) return h < 45 ? 'Laranja' : 'Amarelo';
  if (h < 65) return l > 0.65 ? 'Creme' : 'Amarelo torrado';
  if (h < 75) return 'Amarelo';
  if (h < 160) return l < 0.3 ? 'Verde escuro' : 'Verde';
  if (h < 200) return 'Turquesa';
  if (h < 250) return l < 0.3 ? 'Azul escuro' : 'Azul';
  if (h < 290) return 'Roxo';
  return 'Rosa';
}

// ---------------------------------------------------------------- raster <-> vetor
function bbox(rings) {
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
  for (const r of rings) for (const [x, y] of r) { if (x < a) a = x; if (x > b) b = x; if (y < c) c = y; if (y > d) d = y; }
  return [a, b, c, d];
}

class Canvas {
  constructor(box, res) {
    this.res = res; this.x0 = box[0] - 2 * res; this.y1 = box[3] + 2 * res;
    this.W = Math.ceil((box[1] - box[0]) / res) + 5; this.H = Math.ceil((box[3] - box[2]) / res) + 5;
  }
  px([x, y]) { return [(x - this.x0) / this.res, (this.y1 - y) / this.res]; }
  mask(rings) { const m = new Uint8Array(this.W * this.H); fillPolys(m, this.W, this.H, rings.map(r => r.map(p => this.px(p)))); return m; }
}

function dilate(m, W, H, n) {
  let a = m;
  for (let k = 0; k < n; k++) {
    const b = Uint8Array.from(a);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const i = r * W + c; if (a[i]) continue;
      if ((c > 0 && a[i - 1]) || (c < W - 1 && a[i + 1]) || (r > 0 && a[i - W]) || (r < H - 1 && a[i + W])) b[i] = 1;
    }
    a = b;
  }
  return a;
}

// marching squares: contornos (aneis) de uma mascara, em mm
function contours(m, cv) {
  const { W, H, res } = cv;
  const at = (r, c) => (r < 0 || c < 0 || r >= H || c >= W) ? 0 : m[r * W + c];
  // pontos nas arestas entre centros de pixeis; id unico por aresta
  const eid = (r, c, v) => ((r + 1) * (W + 2) + (c + 1)) * 2 + v; // v=0 horizontal (r,c)-(r,c+1); v=1 vertical (r,c)-(r+1,c)
  const pos = (id) => { const v = id & 1, k = id >> 1, r = Math.floor(k / (W + 2)) - 1, c = (k % (W + 2)) - 1; return v ? [c, r + 0.5] : [c + 0.5, r]; };
  const next = new Map();
  const seg = (a, b) => next.set(a, b);
  for (let r = -1; r < H; r++) for (let c = -1; c < W; c++) {
    const tl = at(r, c), tr = at(r, c + 1), br = at(r + 1, c + 1), bl = at(r + 1, c);
    const code = tl * 8 + tr * 4 + br * 2 + bl;
    if (code === 0 || code === 15) continue;
    const T = eid(r, c, 0), R = eid(r, c + 1, 1), B = eid(r + 1, c, 0), L = eid(r, c, 1);
    // orientacao: interior a esquerda
    switch (code) {
      case 1: seg(L, B); break; case 2: seg(B, R); break; case 3: seg(L, R); break;
      case 4: seg(R, T); break; case 6: seg(B, T); break; case 7: seg(L, T); break;
      case 8: seg(T, L); break; case 9: seg(T, B); break; case 11: seg(T, R); break;
      case 12: seg(R, L); break; case 13: seg(R, B); break; case 14: seg(B, L); break;
      case 5: seg(L, T); seg(R, B); break;     // diagonais: separar
      case 10: seg(T, R); seg(B, L); break;
    }
  }
  const rings = [];
  const seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const ring = []; let cur = start;
    while (cur !== undefined && !seen.has(cur)) { seen.add(cur); ring.push(pos(cur)); cur = next.get(cur); }
    if (ring.length >= 4) rings.push(ring.map(([c, r]) => [cv.x0 + c * res, cv.y1 - r * res]));
  }
  return rings;
}

function simplify(ring, eps) {
  if (ring.length < 6) return ring;
  // alisar as escadinhas do raster (media com os vizinhos, 2 passagens): so mexe ~1 pixel
  let pts = ring;
  for (let it = 0; it < 2; it++) {
    const n = pts.length;
    pts = pts.map((p, i) => { const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n]; return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4]; });
  }
  const dp = (P) => {
    const keep = new Uint8Array(P.length); keep[0] = keep[P.length - 1] = 1;
    const st = [[0, P.length - 1]];
    while (st.length) {
      const [a, b] = st.pop(); let mx = -1, mi = -1;
      const [x1, y1] = P[a], [x2, y2] = P[b], dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1e-9;
      for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * P[i][0] - dx * P[i][1] + x2 * y1 - y2 * x1) / L; if (d > mx) { mx = d; mi = i; } }
      if (mx > eps) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
    }
    return P.filter((_, i) => keep[i]);
  };
  const h = pts.length >> 1;
  const A = dp(pts.slice(0, h + 1)), B = dp(pts.slice(h).concat([pts[0]]));
  return A.slice(0, -1).concat(B.slice(0, -1));
}
const signedArea = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
const ringArea = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s / 2); };

// ---------------------------------------------------------------- principal
// shapes: [{color, name, rings, clips}] em mm, pela ordem de pintura (de baixo para cima)
// devolve { groups: [{color, name, rings, exact}], merged }
export function prepareLayers(shapes, opt = {}) {
  const overlap = opt.overlap ?? 0.35, tol = opt.mergeTol ?? 10, minW = opt.minWidth ?? 0.3;
  // linhas finissimas (ex.: contornos de 0,1 mm do Illustrator) nao se bordam: ficam de fora
  let hairlines = 0; const hairRings = [];
  shapes = shapes.filter(s => {
    let A = 0, P = 0;
    for (const r of s.rings) { A += ringArea(r) * (Math.sign(signedArea(r)) || 1); for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; P += Math.hypot(q[0] - p[0], q[1] - p[1]); } }
    const w = 2 * Math.abs(A) / Math.max(P, 1e-9);
    if (w < minW) { hairlines++; hairRings.push(...s.rings); return false; }
    return true;
  });
  if (!shapes.length) return { groups: [], res: 0.1, hairlines, hairRings };
  // 1) cor de linha de cada forma (tons quase iguais juntam-se)
  const groups = [];
  const gid = shapes.map((s) => {
    let g = groups.findIndex(G => (s.name && G.name === s.name) || (!s.name && !G.name && deltaE(G.color, s.color) < tol));
    if (g < 0) { groups.push({ color: s.color, name: s.name || null, shapes: [] }); g = groups.length - 1; }
    groups[g].shapes.push(s);
    return g;
  });
  // 2) e preciso rasterizar? (sobreposicoes, recortes ou formas da mesma cor sobrepostas)
  const box = bbox(shapes.flatMap(s => s.rings));
  const maxDim = Math.max(box[1] - box[0], box[3] - box[2]);
  const res = Math.max(0.05, maxDim / 2500);
  const cv = new Canvas(box, res), N = cv.W * cv.H;
  const label = new Int8Array(N).fill(-1);
  const painted = groups.map(() => new Uint8Array(N));
  const dirty = groups.map(() => false);
  shapes.forEach((s, i) => {
    let m = cv.mask(s.rings);
    for (const clip of s.clips || []) {
      const cb = bbox(clip), sb = bbox(s.rings);
      const trivial = clip.length === 1 && clip[0].length <= 5 && cb[0] <= sb[0] && cb[1] >= sb[1] && cb[2] <= sb[2] && cb[3] >= sb[3];
      if (trivial) continue;
      const cm = cv.mask(clip); for (let k = 0; k < N; k++) m[k] &= cm[k];
      dirty[gid[i]] = true;
    }
    const g = gid[i], P = painted[g];
    for (let k = 0; k < N; k++) if (m[k]) {
      if (P[k]) dirty[g] = true;                 // forma da mesma cor por cima de outra
      else P[k] = 1;
      label[k] = g;
    }
  });
  // 3) ordem de bordado por defeito: uma cor que tapa outra e bordada depois dela
  //    (os pormenores de cima, como letras brancas sobre um fundo de cor, ficam para o fim)
  const G = groups.length, cover = groups.map(() => new Float64Array(G));
  for (let a = 0; a < G; a++) { const P = painted[a]; for (let k = 0; k < N; k++) if (P[k] && label[k] !== a && label[k] >= 0) cover[a][label[k]]++; }
  const minPx = 0.3 / (res * res);
  const order = [], done = new Array(G).fill(false);
  while (order.length < G) {
    // escolher a primeira cor (pela ordem do ficheiro) que nao esteja tapada por nenhuma cor ainda por bordar... ao contrario:
    // uma cor so entra quando todas as que ela tapa ja entraram
    let pick = -1;
    for (let b = 0; b < G && pick < 0; b++) {
      if (done[b]) continue;
      let ok = true;
      for (let a = 0; a < G; a++) if (!done[a] && a !== b && cover[a][b] > minPx && cover[a][b] > cover[b][a]) { ok = false; break; }
      if (ok) pick = b;
    }
    if (pick < 0) pick = done.indexOf(false); // ciclo: segue a ordem do ficheiro
    done[pick] = true; order.push(pick);
  }
  // 4) zona visivel de cada cor + sobreposicao por baixo das cores de cima
  const ovPx = Math.max(1, Math.round(overlap / res));
  const out = groups.map((G, g) => {
    const vis = new Uint8Array(N); let covered = 0;
    for (let k = 0; k < N; k++) { if (label[k] === g) vis[k] = 1; else if (painted[g][k]) covered++; }
    if (covered * res * res > 0.3) dirty[g] = true;
    if (!dirty[g]) return { color: G.color, name: G.name, rings: G.shapes.flatMap(s => s.rings), exact: true };
    const grown = dilate(vis, cv.W, cv.H, ovPx);
    for (let k = 0; k < N; k++) if (grown[k] && !vis[k] && !(painted[g][k] && label[k] !== g)) grown[k] = 0;
    const rings = contours(grown, cv).map(r => simplify(r, res * 0.6)).filter(r => ringArea(r) > 0.4);
    return { color: G.color, name: G.name, rings, exact: false };
  });
  const sorted = order.map(i => out[i]).filter(Gr => Gr.rings.length);
  return { groups: sorted, res, hairlines, hairRings };
}
