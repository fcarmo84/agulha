// Leitura de formas vetoriais preenchidas de PDF (CorelDRAW, Illustrator...) e SVG.
// Sem dependencias: o PDF e lido diretamente (objetos, streams Flate, conteudo da 1.a pagina).

const PT_MM = 25.4 / 72;

// ------------------------------------------------------------------ util
async function inflate(bytes) {
  for (const fmt of ['deflate', 'deflate-raw']) {
    try {
      const ds = new DecompressionStream(fmt);
      const s = new Blob([fmt === 'deflate-raw' ? bytes.subarray(2) : bytes]).stream().pipeThrough(ds);
      return new Uint8Array(await new Response(s).arrayBuffer());
    } catch (e) { /* tenta o seguinte */ }
  }
  throw new Error('Nao foi possivel descomprimir uma parte do PDF.');
}
const latin1 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return s; };

// ------------------------------------------------------------------ objetos PDF
class Lexer {
  constructor(s, i = 0) { this.s = s; this.i = i; }
  ws() {
    const s = this.s;
    for (;;) {
      while (this.i < s.length && /[\s\0]/.test(s[this.i])) this.i++;
      if (s[this.i] === '%') { while (this.i < s.length && s[this.i] !== '\n' && s[this.i] !== '\r') this.i++; } else break;
    }
  }
  value() {
    this.ws(); const s = this.s, c = s[this.i];
    if (c === '<' && s[this.i + 1] === '<') {
      this.i += 2; const d = {};
      for (;;) { this.ws(); if (s[this.i] === '>' && s[this.i + 1] === '>') { this.i += 2; return d; } const k = this.value(); d[k.name] = this.value(); }
    }
    if (c === '[') { this.i++; const a = []; for (;;) { this.ws(); if (s[this.i] === ']') { this.i++; return a; } a.push(this.value()); } }
    if (c === '/') { let j = this.i + 1; while (j < s.length && !/[\s\0/<>\[\]()%{}]/.test(s[j])) j++; const n = s.slice(this.i + 1, j); this.i = j; return { name: n }; }
    if (c === '(') { let depth = 0, j = this.i; do { if (s[j] === '\\') j++; else if (s[j] === '(') depth++; else if (s[j] === ')') depth--; j++; } while (depth > 0 && j < s.length); const v = s.slice(this.i + 1, j - 1); this.i = j; return { str: v }; }
    if (c === '<') { const j = s.indexOf('>', this.i); const v = s.slice(this.i + 1, j); this.i = j + 1; return { hex: v }; }
    const m = /^[+-]?(\d+\.?\d*|\.\d+)/.exec(s.slice(this.i, this.i + 40));
    if (m) {
      this.i += m[0].length;
      const r = /^\s+(\d+)\s+R(?![A-Za-z])/.exec(s.slice(this.i, this.i + 20));
      if (r && /^\d+$/.test(m[0])) { this.i += r[0].length; return { ref: +m[0] }; }
      return +m[0];
    }
    let j = this.i; while (j < s.length && /[A-Za-z*'"]/.test(s[j])) j++;
    const w = s.slice(this.i, j); this.i = Math.max(j, this.i + 1);
    if (w === 'true') return true; if (w === 'false') return false; if (w === 'null') return null;
    return { op: w };
  }
}

async function loadPDF(u8) {
  const s = latin1(u8);
  const objs = new Map();
  // 1) objetos "N G obj ... endobj" em todo o ficheiro (robusto mesmo com xref estragada)
  const re = /(\d+)\s+(\d+)\s+obj\b/g; let m;
  while ((m = re.exec(s))) {
    const num = +m[1]; const lx = new Lexer(s, re.lastIndex);
    let val; try { val = lx.value(); } catch (e) { continue; }
    lx.ws();
    let stream = null;
    if (s.startsWith('stream', lx.i)) {
      let st = lx.i + 6; if (s[st] === '\r') st++; if (s[st] === '\n') st++;
      const len = val && typeof val.Length === 'number' ? val.Length : -1;
      let end = len >= 0 && /^\s*endstream/.test(s.slice(st + len, st + len + 20)) ? st + len : s.indexOf('endstream', st);
      if (end < 0) end = s.length;
      stream = u8.subarray(st, end);
      re.lastIndex = end;
    }
    objs.set(num, { val, stream });
  }
  const decode = async (o) => {
    if (!o.stream) return null;
    if (o.data) return o.data;
    let f = o.val.Filter; f = !f ? [] : Array.isArray(f) ? f : [f];
    let d = o.stream;
    for (const x of f) {
      if (x.name === 'FlateDecode') d = await inflate(d);
      else throw new Error('Filtro de PDF nao suportado: ' + x.name);
    }
    o.data = d; return d;
  };
  // 2) objetos dentro de object streams (PDF 1.5+)
  for (const [, o] of [...objs]) {
    if (o.val && o.val.Type && o.val.Type.name === 'ObjStm') {
      const d = latin1(await decode(o)); const n = o.val.N, first = o.val.First;
      const lx = new Lexer(d); const hdr = [];
      for (let k = 0; k < n; k++) hdr.push([lx.value(), lx.value()]);
      for (const [num, off] of hdr) {
        if (objs.has(num) && objs.get(num).stream) continue;
        const l2 = new Lexer(d, first + off); objs.set(num, { val: l2.value(), stream: null });
      }
    }
  }
  const get = (v) => (v && v.ref !== undefined ? (objs.get(v.ref) || {}).val : v);
  const getObj = (v) => (v && v.ref !== undefined ? objs.get(v.ref) : null);
  return { objs, get, getObj, decode };
}

// ------------------------------------------------------------------ interpretador
function cmykToRgb(c, m, y, k) { return [255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k)].map(Math.round); }

async function runContent(pdf, bytes, resources, ctm0, out, warn, depth = 0) {
  const s = latin1(bytes); const lx = new Lexer(s);
  const st = []; let gs = { ctm: ctm0, fill: [0, 0, 0], ncs: 1 };
  let path = [], cur = null, ops = [];
  const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
  const T = (x, y) => { const c = gs.ctm; return [c[0] * x + c[2] * y + c[4], c[1] * x + c[3] * y + c[5]]; };
  const bez = (p0, p1, p2, p3) => {
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) + Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
    const n = Math.max(2, Math.ceil(Math.sqrt(L / 0.15))); const r = [];
    for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t; r.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]); }
    return r;
  };
  const sub = () => { if (cur && cur.length > 2) path.push(cur); cur = null; };
  const setColor = (nums, space) => {
    if (nums.length === 4) gs.fill = cmykToRgb(...nums);
    else if (nums.length === 3) gs.fill = nums.map(v => Math.round(v * 255));
    else if (nums.length === 1) gs.fill = [1, 1, 1].map(() => Math.round(nums[0] * 255));
  };
  const xobjs = resources && pdf.get(resources.XObject) || {};
  for (;;) {
    lx.ws(); if (lx.i >= s.length) break;
    const v = lx.value();
    if (!v || v.op === undefined) { ops.push(v); continue; }
    const a = ops; ops = [];
    switch (v.op) {
      case 'q': st.push({ ...gs }); break;
      case 'Q': gs = st.pop() || gs; break;
      case 'cm': gs.ctm = mul(a, gs.ctm); break;
      case 'm': sub(); cur = [T(a[0], a[1])]; break;
      case 'l': if (cur) cur.push(T(a[0], a[1])); break;
      case 'c': if (cur) { const p0 = cur[cur.length - 1]; cur.push(...bez(p0, T(a[0], a[1]), T(a[2], a[3]), T(a[4], a[5]))); } break;
      case 'v': if (cur) { const p0 = cur[cur.length - 1]; cur.push(...bez(p0, p0, T(a[0], a[1]), T(a[2], a[3]))); } break;
      case 'y': if (cur) { const p0 = cur[cur.length - 1], p3 = T(a[2], a[3]); cur.push(...bez(p0, T(a[0], a[1]), p3, p3)); } break;
      case 'h': if (cur) { const f = cur[0]; sub(); cur = [f]; } break;
      case 're': { sub(); const [x, y, w, h] = a; path.push([T(x, y), T(x + w, y), T(x + w, y + h), T(x, y + h)]); break; }
      case 'f': case 'F': case 'f*': case 'B': case 'B*': case 'b': case 'b*':
        sub(); if (path.length) out.push({ color: gs.fill.slice(), rings: path }); path = []; cur = null; break;
      case 'S': case 's': sub(); if (path.length) warn.add('contornos'); path = []; cur = null; break;
      case 'n': path = []; cur = null; break;
      case 'W': case 'W*': break;
      case 'rg': case 'k': case 'g': case 'sc': case 'scn': setColor(a.filter(x => typeof x === 'number')); break;
      case 'cs': break;
      case 'BT': warn.add('texto'); break;
      case 'BI': { const e = s.indexOf('EI', lx.i); lx.i = e + 2; warn.add('imagem'); break; }
      case 'Do': {
        const nm = a[a.length - 1] && a[a.length - 1].name; const ref = xobjs[nm];
        const o = pdf.getObj(ref); if (!o || depth > 6) break;
        if (o.val.Subtype && o.val.Subtype.name === 'Form') {
          const M = o.val.Matrix || [1, 0, 0, 1, 0, 0];
          const data = await pdf.decode(o) || new Uint8Array();
          await runContent(pdf, data, pdf.get(o.val.Resources) || resources, mul(M, gs.ctm), out, warn, depth + 1);
        } else if (o.val.Subtype && o.val.Subtype.name === 'Image') warn.add('imagem');
        break;
      }
      default: break;
    }
  }
}

export async function readPDF(arrayBuffer) {
  const u8 = new Uint8Array(arrayBuffer);
  const pdf = await loadPDF(u8);
  let page = null;
  for (const [, o] of pdf.objs) if (o.val && o.val.Type && o.val.Type.name === 'Page') { page = o.val; break; }
  if (!page) throw new Error('Nao encontrei nenhuma pagina no PDF.');
  let res = pdf.get(page.Resources);
  let pp = page; while (!res && pp.Parent) { pp = pdf.get(pp.Parent); res = pp && pdf.get(pp.Resources); }
  let cont = page.Contents; cont = Array.isArray(cont) ? cont : [cont];
  const parts = [];
  for (const c of cont) { const o = pdf.getObj(c); if (o) parts.push(await pdf.decode(o)); }
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length + 1, 0)); let off = 0;
  for (const p of parts) { all.set(p, off); off += p.length; all[off++] = 10; }
  const shapes = [], warn = new Set();
  await runContent(pdf, all, res, [1, 0, 0, 1, 0, 0], shapes, warn);
  // pt -> mm (y ja e para cima no PDF)
  for (const sh of shapes) sh.rings = sh.rings.map(r => r.map(([x, y]) => [x * PT_MM, y * PT_MM]));
  return { shapes: dropBackground(shapes), warnings: [...warn] };
}

// ------------------------------------------------------------------ SVG
export function readSVG(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const shapes = [], warn = new Set();
  const parseColor = (c) => {
    if (!c || c === 'none') return null;
    const ctx = document.createElement('canvas').getContext('2d'); ctx.fillStyle = '#000'; ctx.fillStyle = c;
    const h = ctx.fillStyle; if (h[0] === '#') return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const m = h.match(/\d+(\.\d+)?/g); return m ? m.slice(0, 3).map(Number) : [0, 0, 0];
  };
  // usa o proprio navegador para obter a geometria (getPointAtLength) com transformacoes
  const holder = document.createElement('div'); holder.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden';
  holder.appendChild(document.importNode(doc.documentElement, true)); document.body.appendChild(holder);
  const svg = holder.querySelector('svg');
  if (holder.querySelector('text')) warn.add('texto');
  if (holder.querySelector('image')) warn.add('imagem');
  for (const el of svg.querySelectorAll('path,rect,circle,ellipse,polygon')) {
    const cs = getComputedStyle(el); const col = parseColor(cs.fill);
    if (!col) { if (cs.stroke && cs.stroke !== 'none') warn.add('contornos'); continue; }
    const M = el.getCTM(); const d = el.getAttribute('d');
    const subs = el.tagName === 'path' ? d.split(/(?=[Mm])/).filter(x => x.trim()) : [null];
    // para paths com varios subcaminhos, cada um e medido separadamente
    let start = null;
    for (const sd of subs) {
      let node = el;
      if (sd !== null) {
        node = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        let dd = sd.trim();
        if (/^m/.test(dd) && start) dd = `M${start[0]},${start[1]} ` + dd.replace(/^m\s*[-\d.e]+[ ,]*[-\d.e]+/i, (t) => 'm0,0'); // relativo ao ultimo ponto
        node.setAttribute('d', dd); el.parentNode.appendChild(node);
      }
      const L = node.getTotalLength(); const n = Math.max(8, Math.ceil(L / 0.3)); const ring = [];
      for (let i = 0; i < n; i++) { const p = node.getPointAtLength(L * i / n); ring.push([M.a * p.x + M.c * p.y + M.e, M.b * p.x + M.d * p.y + M.f]); }
      if (sd !== null) { const e = node.getPointAtLength(L); start = [e.x, e.y]; node.remove(); }
      if (ring.length > 2) shapes.push({ color: col, rings: [ring] });
    }
  }
  holder.remove();
  // juntar subcaminhos da mesma cor; y para cima; px -> mm (96 dpi)
  const k = 25.4 / 96;
  for (const s of shapes) s.rings = s.rings.map(r => r.map(([x, y]) => [x * k, -y * k]));
  return { shapes: dropBackground(shapes), warnings: [...warn] };
}

// remove um retangulo de fundo branco que cubra tudo (comum em exportacoes)
function dropBackground(shapes) {
  return shapes.filter(s => !(s.color.every(v => v > 245)));
}
