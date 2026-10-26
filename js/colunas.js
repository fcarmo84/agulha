// Letras como tracos (como um digitalizador faz a mao):
// esqueleto -> rede de tracos -> cada pixel da letra vai para um traco ->
// cada traco leva uma coluna de cetim que acompanha o traco.
// Juncoes em T: o traco que continua a direito passa; os bracos comecam na borda dele.
// Cantos vivos: dois tracos encontram-se em meia-esquadria (na bissetriz do canto).

import { thin, neighbors8, distanceTransform, smooth, resample, rayHit, fillQuad, turningSatin, turningUnderlay } from './curvas.js';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export let _why = '';
export const _dbgK = {};

// ---------------------------------------------------------------- grafo do esqueleto
function skeletonGraph(sk, W, H) {
  const deg = new Uint8Array(sk.length);
  const pix = []; for (let i = 0; i < sk.length; i++) if (sk[i]) { pix.push(i); deg[i] = neighbors8(i, W, H, sk).length; }
  // nos: pontas (grau 1) e cachos de juncao (grau >= 3)
  const node = new Int32Array(sk.length).fill(-1); const nodes = [];
  for (const i of pix) {
    if (node[i] >= 0 || deg[i] === 2) continue;
    const id = nodes.length, members = [i]; node[i] = id;
    if (deg[i] >= 3) {
      for (let h = 0; h < members.length; h++) for (const j of neighbors8(members[h], W, H, sk)) if (node[j] < 0 && deg[j] >= 3) { node[j] = id; members.push(j); }
    }
    nodes.push({ id, members, end: deg[i] === 1 });
  }
  const used = new Uint8Array(sk.length), branches = [];
  const walk = (start, first) => {
    const path = [start, first]; let prev = start, cur = first;
    if (node[first] >= 0) return path;
    used[first] = 1;
    for (;;) {
      const nb = neighbors8(cur, W, H, sk).filter(j => j !== prev && !path.includes(j) && (node[j] >= 0 || !used[j]));
      if (!nb.length) return path;
      const nxt = nb.find(j => node[j] >= 0 && node[j] !== node[start]) ?? nb.find(j => node[j] < 0) ?? nb[0];
      path.push(nxt);
      if (node[nxt] >= 0) return path;
      used[nxt] = 1; prev = cur; cur = nxt;
    }
  };
  for (const n of nodes) for (const m of n.members) for (const q of neighbors8(m, W, H, sk)) {
    if (node[q] === n.id || (node[q] < 0 && used[q])) continue;
    if (node[q] >= 0 && node[q] < n.id) continue; // ligacao direta no-no: so uma vez
    const path = walk(m, q);
    const a = node[path[0]], b = node[path[path.length - 1]];
    branches.push({ a, b: b >= 0 ? b : -1, pix: path });
  }
  // ciclos sem nos (ex.: D com cantos): cortar num ponto
  for (const i of pix) if (!used[i] && node[i] < 0) {
    const id = nodes.length; nodes.push({ id, members: [i], end: false }); node[i] = id;
    const nb = neighbors8(i, W, H, sk); if (!nb.length) continue;
    const path = walk(i, nb[0]); path.push(i);
    branches.push({ a: id, b: id, pix: path });
  }
  return { nodes, branches, node };
}

// ---------------------------------------------------------------- principal
export function strokeColumns(rings, g, P) {
  _why = '';
  const { W, H } = g, RES = g.res, N = W * H;
  // so para tracos (letras, simbolos de linha): formas cheias e largas ficam com o enchimento
  let A = 0, per = 0;
  rings.forEach((r, k) => { let s = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; s += p[0] * q[1] - q[0] * p[1]; per += Math.hypot(q[0] - p[0], q[1] - p[1]); } A += (k === 0 ? 1 : -1) * Math.abs(s / 2); });
  if (2 * A / Math.max(per, 1e-6) > P.satin_max * 0.85) { _why = 'largo'; return null; }

  const sk = thin(g.mask, W, H);
  const DT = distanceTransform(g.mask, W, H); // em pixeis
  let { nodes, branches } = skeletonGraph(sk, W, H);
  if (!branches.length) { _why = 'sem esqueleto'; return null; }
  const P2 = (i) => g.mm(i % W, (i / W) | 0);
  const halfW = (i) => DT[i] * RES;
  const nodePt = (id) => { const m = nodes[id].members; let x = 0, y = 0; for (const i of m) { const p = P2(i); x += p[0]; y += p[1]; } return [x / m.length, y / m.length]; };
  const degree = () => { const d = new Map(); for (const b of branches) { d.set(b.a, (d.get(b.a) || 0) + 1); if (b.b >= 0) d.set(b.b, (d.get(b.b) || 0) + 1); } return d; };
  const lenMM = (b) => b.pix.length * RES;

  // 1) limpar o esqueleto: lacos minusculos, juncoes coladas e espinhos curtos
  _dbgK.raw = branches.map(b => `${b.a}${nodes[b.a].end ? 'p' : 'j'}-${b.b}${b.b >= 0 && nodes[b.b].end ? 'p' : 'j'}:${(b.pix.length * RES).toFixed(1)}`).join(' ');
  // largura tipica do traco (mediana no esqueleto): usada nos limiares de limpeza
  const skW = (() => { const v = []; for (let i = 0; i < sk.length; i++) if (sk[i]) v.push(2 * halfW(i)); v.sort((a, b) => a - b); return v[v.length >> 1] || 1; })();
  const wAt = () => skW;
  for (let it = 0; it < 12; it++) {
    let changed = false;
    // lacos minusculos (artefactos do afinamento)
    const before = branches.length;
    branches = branches.filter(b => !(b.a === b.b && lenMM(b) < 2 * wAt(b.a) + 0.3));
    if (branches.length !== before) changed = true;
    // juncoes a menos de ~0,7 larguras uma da outra contam como uma so
    for (const b of branches) {
      if (b.b < 0 || b.a === b.b || nodes[b.a].end || nodes[b.b].end) continue;
      if (lenMM(b) < 0.7 * Math.max(wAt(b.a), wAt(b.b))) {
        const keep = b.a, drop = b.b;
        nodes[keep].members.push(...nodes[drop].members);
        for (const o of branches) { if (o.a === drop) o.a = keep; if (o.b === drop) o.b = keep; }
        branches = branches.filter(o => o !== b && !(o.a === keep && o.b === keep && lenMM(o) < 2 * wAt(keep) + 0.3));
        changed = true; break;
      }
    }
    if (!changed) break;
  }
  // espinhos: ramos curtos que acabam numa ponta solta
  for (let it = 0; it < 8; it++) {
    const d = degree(); let removed = false;
    branches = branches.filter(b => {
      const endA = nodes[b.a].end, endB = b.b < 0 || nodes[b.b].end;
      if (endA === endB) return true; // ramo entre duas pontas ou entre duas juncoes
      const jn = endA ? b.b : b.a; if ((d.get(jn) || 0) < 3) return true;
      if (lenMM(b) < Math.max(0.3, 0.6 * skW)) { removed = true; return false; }
      return true;
    });
    // juncoes que ficaram com 2 ramos: juntar os dois ramos num so
    const d2 = degree();
    for (const [id, k] of d2) {
      if (k !== 2 || nodes[id].end) continue;
      const bs = branches.filter(b => b.a === id || b.b === id); if (bs.length !== 2 || bs[0] === bs[1]) continue;
      const [x, y] = bs;
      const ox = x.b === id ? x.pix : x.pix.slice().reverse(), oy = y.a === id ? y.pix : y.pix.slice().reverse();
      const na = x.b === id ? x.a : x.b, nb = y.a === id ? y.b : y.a;
      branches = branches.filter(b => b !== x && b !== y);
      branches.push({ a: na, b: nb, pix: [...ox, ...oy] });
      nodes[id].end = true; nodes[id].merged = true; removed = true;
    }
    if (!removed) break;
  }
  _dbgK.branches = branches.map(b => `${b.a}${nodes[b.a].end ? 'p' : 'j'}-${b.b}${b.b >= 0 && nodes[b.b].end ? 'p' : 'j'}:${(b.pix.length * RES).toFixed(1)}`).join(' ');
  if (branches.length > 14) { _why = 'demasiados ramos'; return null; }

  // 2) polilinhas em mm
  let segs = branches.map(b => {
    const pts = resample(smooth(b.pix.map(P2), 3, false), 0.1, false);
    const ws = b.pix.map(i => 2 * halfW(i)).sort((x, y) => x - y);
    return { a: b.a, b: b.b, pts, w: ws[ws.length >> 1] || RES * 2 };
  }).filter(s => s.pts.length >= 3);

  // 3) juncoes em T / cruzamentos: o traco que continua a direito passa; os bracos sao aparados
  const dir = (s, atStart) => {
    const p = atStart ? s.pts : s.pts.slice().reverse(), k = Math.min(p.length - 1, Math.max(4, Math.round(Math.max(1, s.w) / 0.1)));
    const v = [p[k][0] - p[0][0], p[k][1] - p[0][1]], L = Math.hypot(...v) || 1; return [v[0] / L, v[1] / L];
  };
  const junctions = [...degree()].filter(([id, k]) => k >= 3 && !nodes[id].end).map(([id]) => id);
  for (const jn of junctions) {
    const at = segs.map((s, i) => ({ s, i, start: s.a === jn, end: s.b === jn })).filter(x => x.start || x.end);
    let best = null;
    for (let i = 0; i < at.length; i++) for (let j = i + 1; j < at.length; j++) {
      const d1 = dir(at[i].s, at[i].start), d2 = dir(at[j].s, at[j].start);
      const ang = Math.acos(Math.max(-1, Math.min(1, -(d1[0] * d2[0] + d1[1] * d2[1])))) * 180 / Math.PI; // 0 = continua a direito
      const rw = Math.max(at[i].s.w, at[j].s.w) / Math.max(1e-6, Math.min(at[i].s.w, at[j].s.w));
      if (ang < 35 && rw < 1.7 && (!best || ang < best.ang)) best = { ang, i, j };
    }
    if (!best) continue;
    const X = at[best.i], Y = at[best.j];
    const px = X.end ? X.s.pts : X.s.pts.slice().reverse(), py = Y.start ? Y.s.pts : Y.s.pts.slice().reverse();
    const merged = { a: X.end ? X.s.a : X.s.b, b: Y.start ? Y.s.b : Y.s.a, pts: resample(smooth([...px, ...py], 3, false), 0.1, false), w: Math.max(X.s.w, Y.s.w), through: true };
    const half = merged.w / 2 + 0.05;
    const jp = nodePt(jn);
    // bracos: retirar a parte da polilinha dentro do traco principal
    for (const o of at) {
      if (o === X || o === Y) continue;
      const pts = o.start ? o.s.pts : o.s.pts.slice().reverse();
      let k = 0; while (k < pts.length - 3 && dist(pts[k], jp) < half) k++;
      const cut = pts.slice(k); o.s.pts = o.start ? cut : cut.reverse(); o.s.arm = true;
    }
    segs = segs.filter(s => s !== X.s && s !== Y.s); segs.push(merged);
  }

  // 4) cada traco fica inteiro; os cantos vivos sao feitos em leque (ver passo 6)
  const pieces = segs.map(sg => ({ pts: sg.pts, w: sg.w, arm: sg.arm }));
  _dbgK.pieces = pieces.map(p => `${p.pts.length * 0.1 | 0}mm${p.arm ? 'b' : ''}${p.through ? 't' : ''}`).join(',');
  _dbgK.junctions = junctions.length;
  if (!pieces.length || pieces.length > 20) { _why = 'pecas'; return null; }
  if (Math.max(...pieces.map(p => p.w)) > P.satin_max * 1.1) { _why = 'traco largo'; return null; }

  // 5) cada pixel da letra vai para o traco mais proximo (cantos -> bissetriz; bracos aparados -> T limpo)
  const L = new Int32Array(N);
  const samp = pieces.map(s => s.pts.filter((_, i) => i % 2 === 0 || i === s.pts.length - 1));
  const bb = samp.map(ps => { let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity; for (const [x, y] of ps) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, y); d = Math.max(d, y); } return [a, b, c, d]; });
  const reach = Math.max(...pieces.map(s => s.w)) * 1.5 + 1;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const i = r * W + c; if (!g.mask[i]) continue;
    const [x, y] = g.mm(c, r); let best = Infinity, bi = -1;
    for (let k = 0; k < samp.length; k++) {
      const B = bb[k]; if (x < B[0] - reach || x > B[1] + reach || y < B[2] - reach || y > B[3] + reach) continue;
      for (const q of samp[k]) { const d = (q[0] - x) ** 2 + (q[1] - y) ** 2; if (d < best) { best = d; bi = k; } }
    }
    L[i] = bi + 1;
  }

  // 6) coluna de cetim por traco; os carris param na borda do vetor OU na emenda com o vizinho
  const ovPx = Math.max(1, Math.round(0.15 / RES));
  const parts = [], cov = new Uint8Array(N);
  pieces.forEach((s, k) => {
    const id = k + 1;
    const m = new Uint8Array(N); for (let i = 0; i < N; i++) if (L[i] === id) m[i] = 1;
    const md = dilateN(m, W, H, ovPx);
    for (let i = 0; i < N; i++) md[i] &= g.mask[i];
    // prolongar o eixo nas pontas ate sair da parte
    let pts = s.pts;
    // perpendicular que passa em q: troco de md mais proximo de q (para pontas cortadas na obliqua)
    const crossRun = (q, u) => {
      const n = [-u[1], u[0]], lim = s.w * 1.6 + 0.5, st = RES / 2; let best = null, run = null;
      for (let t = -lim; t <= lim; t += st) {
        const on = g.look(md, q[0] + n[0] * t, q[1] + n[1] * t);
        if (on && !run) run = [t, t]; else if (on) run[1] = t;
        if ((!on || t + st > lim) && run) { const mid = (run[0] + run[1]) / 2; if (!best || Math.abs(mid) < Math.abs((best[0] + best[1]) / 2)) best = run; run = null; }
      }
      return best && best[1] - best[0] >= 0.1 ? best : null;
    };
    const ext = (p0, p1) => {
      const l = dist(p0, p1) || 1, u = [(p0[0] - p1[0]) / l, (p0[1] - p1[1]) / l], add = [];
      for (let t = 0.1; t < s.w * 1.8 + 0.5; t += 0.1) { const q = [p0[0] + u[0] * t, p0[1] + u[1] * t]; if (!g.look(md, q[0], q[1]) && !crossRun(q, u)) break; add.push(q); }
      return add;
    };
    pts = [...ext(pts[0], pts[Math.min(5, pts.length - 1)]).reverse(), ...pts, ...ext(pts[pts.length - 1], pts[Math.max(0, pts.length - 6)])];
    const rails = [];
    const maxS = P.satin_max * 4, step = RES / 2;
    const ray = (c, dv) => {
      const sp = rayHit(rings, c, dv, maxS) ?? maxS;
      let sm = 0; while (sm < sp && g.look(md, c[0] + dv[0] * sm, c[1] + dv[1] * sm)) sm += step;
      const s = Math.min(sp, sm); return { s, edge: sp - sm < RES * 1.5 };
    };
    // cantos vivos: o ponto roda em leque a volta do vertice de dentro do canto
    const hC = Math.max(3, Math.round(Math.max(0.6, s.w * 0.5) / 0.1));
    const turnAt = (i) => {
      const a = pts[Math.max(0, i - hC)], b = pts[i], c = pts[Math.min(pts.length - 1, i + hC)];
      const u1 = [b[0] - a[0], b[1] - a[1]], u2 = [c[0] - b[0], c[1] - b[1]];
      let d = Math.abs(Math.atan2(u2[1], u2[0]) - Math.atan2(u1[1], u1[0])); if (d > Math.PI) d = 2 * Math.PI - d;
      return { deg: d * 180 / Math.PI, u1, u2 };
    };
    const corners = [];
    for (let i = hC; i < pts.length - hC; i++) {
      const t = turnAt(i).deg;
      if (t > 40 && t >= turnAt(i - 1).deg && t >= turnAt(i + 1).deg && (!corners.length || i - corners[corners.length - 1].i > 2 * hC)) {
        const { u1, u2 } = turnAt(i), l1 = Math.hypot(...u1) || 1, l2 = Math.hypot(...u2) || 1;
        let bv = [u2[0] / l2 - u1[0] / l1, u2[1] / l2 - u1[1] / l1]; const lb = Math.hypot(...bv) || 1; bv = [bv[0] / lb, bv[1] / lb];
        const hit = rayHit(rings, pts[i], bv, s.w * 2) ?? s.w / 2;
        corners.push({ i, pivot: [pts[i][0] + bv[0] * hit, pts[i][1] + bv[1] * hit], left: u1[0] * u2[1] - u1[1] * u2[0] > 0, zone: Math.round(Math.max(0.5, s.w * 0.7) / 0.1) });
      }
    }
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 4)], b = pts[Math.min(pts.length - 1, i + 4)];
      const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1, n = [-ty / l, tx / l], c = pts[i];
      if (!g.look(md, c[0], c[1])) {
        // ponta para la do eixo (remate obliquo): a passagem e o troco da forma nesta perpendicular
        const run = crossRun(c, [tx / l, ty / l]);
        if (!run) continue;
        const nn = [-ty / l, tx / l];
        const Lp = [c[0] + nn[0] * run[1], c[1] + nn[1] * run[1]], Rp = [c[0] + nn[0] * run[0], c[1] + nn[1] * run[0]];
        rails.push({ c: [(Lp[0] + Rp[0]) / 2, (Lp[1] + Rp[1]) / 2], L: Lp, R: Rp, w: run[1] - run[0], n, t: [tx / l, ty / l], eL: true, eR: true });
        continue;
      }
      const cn = corners.find(k => Math.abs(i - k.i) <= k.zone);
      if (cn) {
        // leque: lado de dentro fixo no vertice; lado de fora na direcao vertice -> eixo
        const dv0 = [c[0] - cn.pivot[0], c[1] - cn.pivot[1]], ld = Math.hypot(...dv0);
        if (ld > 0.05) {
          const dv = [dv0[0] / ld, dv0[1] / ld], o = ray(c, dv);
          const outer = [c[0] + dv[0] * o.s, c[1] + dv[1] * o.s];
          const inL = cn.left; // a virar a esquerda: o lado de dentro e o L (+n)
          rails.push({ c, L: inL ? cn.pivot : outer, R: inL ? outer : cn.pivot, w: ld + o.s, n, t: [tx / l, ty / l], eL: inL ? true : o.edge, eR: inL ? o.edge : true, fan: true });
          continue;
        }
      }
      const s1 = ray(c, n), s2 = ray(c, [-n[0], -n[1]]);
      if (s1.s + s2.s < 0.15) continue;
      rails.push({ c, L: [c[0] + n[0] * s1.s, c[1] + n[1] * s1.s], R: [c[0] - n[0] * s2.s, c[1] - n[1] * s2.s], w: s1.s + s2.s, n, t: [tx / l, ty / l], eL: s1.edge, eR: s2.edge });
    }
    if (rails.length < 3) return;
    for (let i = 0; i + 1 < rails.length; i++) fillQuad(cov, g, [rails[i].L, rails[i + 1].L, rails[i + 1].R, rails[i].R]);
    const ws = rails.map(r => r.w).sort((x, y) => x - y), wmed = ws[ws.length >> 1];
    const col = { rails, wmed, loop: false };
    const blocks = [];
    const ul = turningUnderlay(col, P); if (ul && ul.length > 1) blocks.push({ pts: ul, kind: 'base', part: id });
    blocks.push({ pts: turningSatin(col, P), kind: 'cetim', part: id });
    parts.push({ id, ang: 0, mask: m, blocks, satin: true, w: wmed, curva: true, rails });
  });
  // 7) a forma tem de ficar bem coberta; senao fica o metodo antigo
  let inS = 0, cv = 0; for (let i = 0; i < N; i++) if (g.mask[i]) { inS++; if (cov[i]) cv++; }
  const minCov = skW < 1.5 ? 0.955 : 0.975; // em tracos finos o arredondamento aos pixeis pesa mais
  if (!parts.length || cv / inS < minCov) { _why = 'cobertura ' + (cv / Math.max(1, inS)).toFixed(3); return null; }
  return { parts, labels: L };
}

function dilateN(m, W, H, n) {
  let a = Uint8Array.from(m);
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
