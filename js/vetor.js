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


// ------------------------------------------------------------------ cores
function labToRgb(L, a, b, wp = [0.9642, 1, 0.8249]) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const g = (t) => t > 6 / 29 ? t * t * t : 3 * (6 / 29) ** 2 * (t - 4 / 29);
  let X = wp[0] * g(fx), Y = wp[1] * g(fy), Z = wp[2] * g(fz);
  // D50 -> D65 (Bradford) e XYZ -> sRGB
  const x = 0.9555766 * X - 0.0230393 * Y + 0.0631636 * Z, y = -0.0282895 * X + 1.0099416 * Y + 0.0210077 * Z, z = 0.0122982 * X - 0.020483 * Y + 1.3299098 * Z;
  const lin = [3.2404542 * x - 1.5371385 * y - 0.4985314 * z, -0.969266 * x + 1.8760108 * y + 0.041556 * z, 0.0556434 * x - 0.2040259 * y + 1.0572252 * z];
  return lin.map(v => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055))));
}

// avaliador de funcoes PDF (tipos 0, 2, 3 e 4)
async function loadFunction(pdf, ref) {
  const o = pdf.getObj(ref); const d = o ? o.val : pdf.get(ref);
  if (!d) return null;
  if (Array.isArray(d)) { const fs = []; for (const f of d) fs.push(await loadFunction(pdf, f)); return (x) => fs.map(f => f(x)[0]); }
  const clip = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const dom = d.Domain || [0, 1], rng = d.Range;
  const fin = (out) => rng ? out.map((v, i) => clip(v, rng[2 * i], rng[2 * i + 1])) : out;
  switch (d.FunctionType) {
    case 2: {
      const C0 = d.C0 || [0], C1 = d.C1 || [1], N = d.N ?? 1;
      return (x) => { const t = clip(x[0], dom[0], dom[1]); return fin(C0.map((c, i) => c + Math.pow(t, N) * (C1[i] - c))); };
    }
    case 3: {
      const fs = []; for (const f of d.Functions) fs.push(await loadFunction(pdf, f));
      const B = d.Bounds || [], E = d.Encode || [];
      return (x) => {
        const t = clip(x[0], dom[0], dom[1]); let k = 0; while (k < B.length && t >= B[k]) k++;
        const a = k === 0 ? dom[0] : B[k - 1], b = k === B.length ? dom[1] : B[k];
        const e0 = E[2 * k] ?? 0, e1 = E[2 * k + 1] ?? 1;
        return fin(fs[k]([b === a ? e0 : e0 + (t - a) * (e1 - e0) / (b - a)]));
      };
    }
    case 0: {
      const data = await pdf.decode(o); const bps = d.BitsPerSample || 8, size = d.Size, m = size.length, n = rng.length / 2;
      const enc = d.Encode || size.flatMap(s => [0, s - 1]), dec = d.Decode || rng;
      const sample = (idx, j) => {
        const bit = (idx * n + j) * bps; let v = 0;
        for (let b = 0; b < bps; b++) { const bi = bit + b; v = (v << 1) | ((data[bi >> 3] >> (7 - (bi & 7))) & 1); }
        return v / (2 ** bps - 1);
      };
      return (x) => {
        if (m !== 1) { // varias entradas: amostra mais proxima
          let idx = 0, mulk = 1;
          for (let i = 0; i < m; i++) { const e = enc[2 * i] + (clip(x[i], dom[2 * i], dom[2 * i + 1]) - dom[2 * i]) * (enc[2 * i + 1] - enc[2 * i]) / (dom[2 * i + 1] - dom[2 * i]); idx += Math.round(clip(e, 0, size[i] - 1)) * mulk; mulk *= size[i]; }
          return fin(Array.from({ length: n }, (_, j) => dec[2 * j] + sample(idx, j) * (dec[2 * j + 1] - dec[2 * j])));
        }
        const e = clip(enc[0] + (clip(x[0], dom[0], dom[1]) - dom[0]) * (enc[1] - enc[0]) / (dom[1] - dom[0]), 0, size[0] - 1);
        const i0 = Math.floor(e), i1 = Math.min(size[0] - 1, i0 + 1), f = e - i0;
        return fin(Array.from({ length: n }, (_, j) => { const v = sample(i0, j) * (1 - f) + sample(i1, j) * f; return dec[2 * j] + v * (dec[2 * j + 1] - dec[2 * j]); }));
      };
    }
    case 4: {
      const src = latin1(await pdf.decode(o));
      const toks = src.replace(/[{}]/g, m => ` ${m} `).trim().split(/\s+/);
      let p = 0;
      const parse = () => { const out = []; while (p < toks.length) { const t = toks[p++]; if (t === '{') out.push(parse()); else if (t === '}') return out; else out.push(isNaN(+t) ? t : +t); } return out; };
      p = 1; const prog = parse(); // salta o primeiro '{'
      const run = (code, st) => {
        for (let i = 0; i < code.length; i++) {
          const t = code[i];
          if (typeof t === 'number' || Array.isArray(t)) { st.push(t); continue; }
          const b = () => st.pop();
          switch (t) {
            case 'add': { const y = b(); st.push(b() + y); break; } case 'sub': { const y = b(); st.push(b() - y); break; }
            case 'mul': { const y = b(); st.push(b() * y); break; } case 'div': { const y = b(); st.push(b() / y); break; }
            case 'idiv': { const y = b(); st.push(Math.trunc(b() / y)); break; } case 'mod': { const y = b(); st.push(b() % y); break; }
            case 'neg': st.push(-b()); break; case 'abs': st.push(Math.abs(b())); break;
            case 'ceiling': st.push(Math.ceil(b())); break; case 'floor': st.push(Math.floor(b())); break;
            case 'round': st.push(Math.round(b())); break; case 'truncate': case 'cvi': st.push(Math.trunc(b())); break; case 'cvr': break;
            case 'sqrt': st.push(Math.sqrt(b())); break; case 'exp': { const e = b(); st.push(Math.pow(b(), e)); break; }
            case 'ln': st.push(Math.log(b())); break; case 'log': st.push(Math.log10(b())); break;
            case 'sin': st.push(Math.sin(b() * Math.PI / 180)); break; case 'cos': st.push(Math.cos(b() * Math.PI / 180)); break;
            case 'atan': { const den = b(); st.push((Math.atan2(b(), den) * 180 / Math.PI + 360) % 360); break; }
            case 'dup': st.push(st[st.length - 1]); break; case 'pop': b(); break;
            case 'exch': { const y = b(), x = b(); st.push(y, x); break; }
            case 'copy': { const n = b(); st.push(...st.slice(st.length - n)); break; }
            case 'index': { const n = b(); st.push(st[st.length - 1 - n]); break; }
            case 'roll': { const j = b(), n = b(); if (n > 0) { const a = st.splice(st.length - n, n); const s2 = ((j % n) + n) % n; st.push(...a.slice(n - s2), ...a.slice(0, n - s2)); } break; }
            case 'eq': st.push(b() === b()); break; case 'ne': st.push(b() !== b()); break;
            case 'gt': { const y = b(); st.push(b() > y); break; } case 'ge': { const y = b(); st.push(b() >= y); break; }
            case 'lt': { const y = b(); st.push(b() < y); break; } case 'le': { const y = b(); st.push(b() <= y); break; }
            case 'and': { const y = b(), x = b(); st.push(typeof x === 'boolean' ? x && y : x & y); break; }
            case 'or': { const y = b(), x = b(); st.push(typeof x === 'boolean' ? x || y : x | y); break; }
            case 'not': { const x = b(); st.push(typeof x === 'boolean' ? !x : ~x); break; }
            case 'true': st.push(true); break; case 'false': st.push(false); break;
            case 'if': { const c = b(); if (b()) run(c, st); break; }
            case 'ifelse': { const c2 = b(), c1 = b(); run(b() ? c1 : c2, st); break; }
            default: break;
          }
        }
        return st;
      };
      return (x) => fin(run(prog, [...x]).slice(-(rng.length / 2)));
    }
    default: return null;
  }
}

const hashColor = (name) => { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0; return [60 + h % 160, 60 + (h >> 8) % 160, 60 + (h >> 16) % 160]; };

// devolve { n, rgb(comps), name } para um espaco de cor
async function resolveCS(pdf, cs, resources, depth = 0) {
  const dev = { DeviceGray: 1, G: 1, CalGray: 1, DeviceRGB: 3, RGB: 3, CalRGB: 3, DeviceCMYK: 4, CMYK: 4 };
  const byN = (n) => ({ n, rgb: (c) => n === 4 ? cmykToRgb(...c) : n === 3 ? c.map(v => Math.round(v * 255)) : [c[0], c[0], c[0]].map(v => Math.round(v * 255)) });
  if (!cs || depth > 5) return byN(1);
  if (cs.name) {
    if (dev[cs.name]) return byN(dev[cs.name]);
    if (cs.name === 'Pattern') return { n: 0, pattern: true, rgb: () => [128, 128, 128] };
    const csd = resources && pdf.get(resources.ColorSpace) || {};
    const ref = csd[cs.name];
    if (ref) return resolveCS(pdf, pdf.get(ref), resources, depth + 1);
    return byN(1);
  }
  const arr = pdf.get(cs); if (!Array.isArray(arr)) return byN(1);
  const kind = arr[0] && arr[0].name;
  if (kind === 'ICCBased') { const st = pdf.getObj(arr[1]); const N = st && st.val.N || 3; if (st && st.val.Alternate) return resolveCS(pdf, st.val.Alternate, resources, depth + 1); return byN(N); }
  if (kind === 'CalRGB') return byN(3); if (kind === 'CalGray') return byN(1);
  if (kind === 'Lab') { const d = pdf.get(arr[1]) || {}; const wp = d.WhitePoint || [0.9642, 1, 0.8249]; return { n: 3, rgb: (c) => labToRgb(c[0], c[1], c[2], wp) }; }
  if (kind === 'Separation' || kind === 'DeviceN') {
    const names = kind === 'Separation' ? [arr[1].name] : (pdf.get(arr[1]) || []).map(x => x.name);
    const alt = await resolveCS(pdf, arr[2], resources, depth + 1);
    let fn = null; try { fn = await loadFunction(pdf, arr[3]); } catch (e) { fn = null; }
    const name = names.filter(n => n && n !== 'None').map(n => n.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))).join(' + ');
    if (names.length === 1 && names[0] === 'All') return { n: 1, rgb: (c) => [1, 1, 1].map(() => Math.round(255 * (1 - c[0]))), name: 'Registo' };
    return {
      n: names.length, name: name || null,
      rgb: (c) => { try { if (fn) { const out = fn(c); if (out.every(Number.isFinite)) return alt.rgb(out); } } catch (e) { /* recorre ao nome */ } return hashColor(name); },
    };
  }
  if (kind === 'Indexed') {
    const base = await resolveCS(pdf, arr[1], resources, depth + 1); const hival = arr[2]; let lut = arr[3]; let bytes;
    const lo = pdf.getObj(lut);
    if (lo && lo.stream) bytes = await pdf.decode(lo);
    else if (lut && lut.hex !== undefined) { const h = lut.hex.replace(/\s/g, ''); bytes = Uint8Array.from(h.match(/../g) || [], x => parseInt(x, 16)); }
    else if (lut && lut.str !== undefined) bytes = Uint8Array.from(lut.str, ch => ch.charCodeAt(0) & 255);
    return { n: 1, rgb: (c) => { const i = Math.min(hival, Math.max(0, Math.round(c[0]))); const comps = []; for (let k = 0; k < base.n; k++) comps.push((bytes ? bytes[i * base.n + k] : 0) / 255); return base.rgb(comps); } };
  }
  if (kind === 'Pattern') return { n: 0, pattern: true, rgb: () => [128, 128, 128] };
  return byN(1);
}

// ------------------------------------------------------------------ interpretador
function cmykToRgb(c, m, y, k) { return [255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k)].map(Math.round); }

async function runContent(pdf, bytes, resources, ctm0, out, warn, depth = 0, clip0 = null) {
  const s = latin1(bytes); const lx = new Lexer(s);
  const st = []; let gs = { ctm: ctm0, fill: [0, 0, 0], cs: null, name: null, clip: clip0 || [] };
  let pendingClip = false;
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
  const setColor = (nums) => {
    if (gs.cs) {
      if (gs.cs.pattern) { warn.add('gradiente'); return; }
      gs.fill = gs.cs.rgb(nums.slice(0, gs.cs.n)); gs.name = gs.cs.name ? gs.cs.name + (nums[0] < 0.999 && gs.cs.n === 1 ? ` ${Math.round(nums[0] * 100)}%` : '') : null;
      return;
    }
    if (nums.length === 4) gs.fill = cmykToRgb(...nums);
    else if (nums.length === 3) gs.fill = nums.map(v => Math.round(v * 255));
    else if (nums.length === 1) gs.fill = [1, 1, 1].map(() => Math.round(nums[0] * 255));
    gs.name = null;
  };
  const endPath = () => { if (pendingClip) { sub(); if (path.length) gs.clip = [...gs.clip, path.map(r => r.slice())]; pendingClip = false; } };
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
        sub(); if (path.length) out.push({ color: gs.fill.slice(), name: gs.name, rings: path, clips: gs.clip, eo: v.op.endsWith('*') });
        endPath(); path = []; cur = null; break;
      case 'S': case 's': sub(); if (path.length) warn.add('contornos'); endPath(); path = []; cur = null; break;
      case 'n': endPath(); path = []; cur = null; break;
      case 'W': case 'W*': pendingClip = true; break;
      case 'rg': case 'k': case 'g': gs.cs = null; setColor(a.filter(x => typeof x === 'number')); break;
      case 'sc': case 'scn': {
        const nm = a[a.length - 1];
        if (nm && nm.name) { warn.add('gradiente'); break; } // padrao/gradiente
        setColor(a.filter(x => typeof x === 'number')); break;
      }
      case 'cs': {
        const c = a[a.length - 1];
        gs.cs = await resolveCS(pdf, c, resources);
        setColor(gs.cs.n === 4 ? [0, 0, 0, 1] : gs.cs.n === 3 ? [0, 0, 0] : gs.cs.n === 1 && !gs.cs.name ? [0] : new Array(Math.max(1, gs.cs.n)).fill(gs.cs.name ? 1 : 0));
        break;
      }
      case 'sh': warn.add('gradiente'); break;
      case 'BT': warn.add('texto'); break;
      case 'BI': { const e = s.indexOf('EI', lx.i); lx.i = e + 2; warn.add('imagem'); break; }
      case 'Do': {
        const nm = a[a.length - 1] && a[a.length - 1].name; const ref = xobjs[nm];
        const o = pdf.getObj(ref); if (!o || depth > 6) break;
        if (o.val.Subtype && o.val.Subtype.name === 'Form') {
          const M = o.val.Matrix || [1, 0, 0, 1, 0, 0];
          const data = await pdf.decode(o) || new Uint8Array();
          await runContent(pdf, data, pdf.get(o.val.Resources) || resources, mul(M, gs.ctm), out, warn, depth + 1, gs.clip);
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
  const mm = (rs) => rs.map(r => r.map(([x, y]) => [x * PT_MM, y * PT_MM]));
  for (const sh of shapes) { sh.rings = mm(sh.rings); sh.clips = (sh.clips || []).map(mm); }
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

// remove um fundo branco/quase branco que cubra o desenho todo (comum em exportacoes)
function dropBackground(shapes) {
  const bb = (rs) => { let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity; for (const r of rs) for (const [x, y] of r) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, y); d = Math.max(d, y); } return [a, b, c, d]; };
  const all = bb(shapes.flatMap(s => s.rings)); const A = (all[1] - all[0]) * (all[3] - all[2]);
  return shapes.filter((s, i) => {
    if (!s.color.every(v => v > 240)) return true;
    const b = bb(s.rings); return !(i < 2 && (b[1] - b[0]) * (b[3] - b[2]) > 0.9 * A);
  });
}

// ------------------------------------------------------------------ varios desenhos na mesma pagina
// Junta as formas em grupos separados por espaco vazio (ex.: o logotipo em versao clara e escura
// lado a lado) e marca retangulos de fundo por tras de um desenho.
export function findDesigns(shapes) {
  const bb = (rs) => { let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity; for (const r of rs) for (const [x, y] of r) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, y); d = Math.max(d, y); } return [a, b, c, d]; };
  const boxes = shapes.map(s => bb(s.rings));
  const all = bb(shapes.flatMap(s => s.rings));
  const gap = Math.max(3, 0.03 * Math.hypot(all[1] - all[0], all[3] - all[2]));
  const parent = shapes.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const A = boxes[i], B = boxes[j];
    if (A[0] - gap <= B[1] && B[0] - gap <= A[1] && A[2] - gap <= B[3] && B[2] - gap <= A[3]) parent[find(i)] = find(j);
  }
  const groups = new Map();
  shapes.forEach((s, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
  const area = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; s += p[0] * q[1] - q[0] * p[1]; } return Math.abs(s / 2); };
  const designs = [...groups.values()].map(idx => {
    const box = bb(idx.flatMap(i => shapes[i].rings));
    const boxA = (box[1] - box[0]) * (box[3] - box[2]);
    // fundo: retangulo (ou quase) que ocupa a maior parte do desenho e tem formas por cima
    const fundo = idx.filter((i, k) => {
      const s = shapes[i]; if (s.rings.length !== 1) return false;
      const b = boxes[i], bA = (b[1] - b[0]) * (b[3] - b[2]);
      if (area(s.rings[0]) < 0.9 * bA || bA < 0.5 * boxA) return false;
      const above = idx.slice(k + 1).filter(j => boxes[j][0] >= b[0] - 0.5 && boxes[j][1] <= b[1] + 0.5 && boxes[j][2] >= b[2] - 0.5 && boxes[j][3] <= b[3] + 0.5);
      return above.length >= 3;
    });
    return { shapes: idx, fundo, box };
  });
  // peças do mesmo logotipo (ex.: simbolo + texto lado a lado) juntam-se: estao alinhadas,
  // perto uma da outra (menos de 1x a menor altura) e NAO tem o mesmo tamanho
  // (duas versoes do mesmo logotipo, com o mesmo tamanho, ficam separadas)
  let list = designs.slice();
  for (let changed = true; changed;) {
    changed = false;
    outer: for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const A = list[i].box, B = list[j].box;
      const wA = A[1] - A[0], hA = A[3] - A[2], wB = B[1] - B[0], hB = B[3] - B[2];
      const ox = Math.min(A[1], B[1]) - Math.max(A[0], B[0]), oy = Math.min(A[3], B[3]) - Math.max(A[2], B[2]);
      const rowAligned = oy >= 0.5 * Math.min(hA, hB), colAligned = ox >= 0.5 * Math.min(wA, wB);
      const gapX = Math.max(0, Math.max(A[0], B[0]) - Math.min(A[1], B[1])), gapY = Math.max(0, Math.max(A[2], B[2]) - Math.min(A[3], B[3]));
      const lim = 1.0 * Math.min(Math.min(wA, hA), Math.min(wB, hB));
      const near = (rowAligned && gapX < lim) || (colAligned && gapY < lim);
      const r1 = wA / wB, r2 = hA / hB, same = r1 > 0.8 && r1 < 1.25 && r2 > 0.8 && r2 < 1.25;
      if (near && !same) {
        const M = { shapes: [...list[i].shapes, ...list[j].shapes].sort((a, b) => a - b), fundo: [...list[i].fundo, ...list[j].fundo],
          box: [Math.min(A[0], B[0]), Math.max(A[1], B[1]), Math.min(A[2], B[2]), Math.max(A[3], B[3])] };
        list.splice(j, 1); list[i] = M; changed = true; break outer;
      }
    }
  }
  // desenhos muito pequenos ao lado de outros (ex.: um ponto perdido) ficam de fora da escolha
  const big = list.filter(d => (d.box[1] - d.box[0]) * (d.box[3] - d.box[2]) > 25);
  return (big.length ? big : list).sort((a, b) => a.shapes[0] - b.shapes[0]);
}
