// Escrita e leitura de ficheiros Tajima DST.
// Coordenadas em unidades de 0.1 mm. Cortes de linha = 3 ou mais saltos seguidos.

function enc(dx, dy, jump) {
  const tern = (v) => { const d = []; for (let i = 0; i < 5; i++) { let r = ((v % 3) + 3) % 3; if (r === 2) r = -1; d.push(r); v = (v - r) / 3; } return d; };
  const tx = tern(dx), ty = tern(dy);
  const xmap = [[0, 0, 1], [1, 0, 1], [0, 2, 3], [1, 2, 3], [2, 2, 3]];
  const ymap = [[0, 7, 6], [1, 7, 6], [0, 5, 4], [1, 5, 4], [2, 5, 4]];
  const B = [0, 0, 0];
  tx.forEach((t, i) => { const [by, pb, nb] = xmap[i]; if (t === 1) B[by] |= 1 << pb; else if (t === -1) B[by] |= 1 << nb; });
  ty.forEach((t, i) => { const [by, pb, nb] = ymap[i]; if (t === 1) B[by] |= 1 << pb; else if (t === -1) B[by] |= 1 << nb; });
  B[2] |= 0x03;
  if (jump) B[2] |= 0x80;
  return B;
}

export function writeDST(cmds, label = 'bordado') {
  const recs = []; let x = 0, y = 0;
  const xs = [0, ...cmds.map(c => c[1])], ys = [0, ...cmds.map(c => c[2])];
  for (const [t, X, Y] of cmds) {
    if (t === 'C') { recs.push([0, 0, 0xC3]); continue; }
    const dx = X - x, dy = Y - y;
    let n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 121));
    if (t === 'J') n = Math.max(n, 3);
    let px = x, py = y;
    for (let k = 1; k <= n; k++) {
      const nx = x + Math.round(dx * k / n), ny = y + Math.round(dy * k / n);
      recs.push(enc(nx - px, ny - py, t === 'J' || k < n));
      px = nx; py = ny;
    }
    x = X; y = Y;
  }
  recs.push([0, 0, 0xF3]);
  const st = recs.length - 1, co = cmds.filter(c => c[0] === 'C').length;
  const pad = (v, n) => String(v).padStart(n, ' ');
  const sgn = (v) => (v >= 0 ? '+' : '-') + pad(Math.abs(v), 5);
  const lab = (label.normalize('NFD').replace(/[^\x20-\x7e]/g, '') + ' '.repeat(16)).slice(0, 16);
  let hdr = `LA:${lab}\rST:${pad(st, 7)}\rCO:${pad(co, 3)}\r` +
    `+X:${pad(Math.max(...xs), 5)}\r-X:${pad(-Math.min(...xs), 5)}\r+Y:${pad(Math.max(...ys), 5)}\r-Y:${pad(-Math.min(...ys), 5)}\r` +
    `AX:${sgn(x)}\rAY:${sgn(y)}\rMX:+${pad(0, 5)}\rMY:+${pad(0, 5)}\rPD:******\r\x1a`;
  const out = new Uint8Array(512 + recs.length * 3);
  out.fill(0x20, 0, 512);
  for (let i = 0; i < hdr.length; i++) out[i] = hdr.charCodeAt(i);
  recs.forEach((r, i) => out.set(r, 512 + i * 3));
  return out;
}

export function readDST(buf) {
  const d = new Uint8Array(buf); let x = 0, y = 0; const out = [];
  const bit = (b, n) => (b >> n) & 1;
  for (let i = 512; i + 2 < d.length; i += 3) {
    const b0 = d[i], b1 = d[i + 1], b2 = d[i + 2];
    if (b2 === 0xF3) break;
    x += (bit(b2, 2) - bit(b2, 3)) * 81 + (bit(b1, 2) - bit(b1, 3)) * 27 + (bit(b0, 2) - bit(b0, 3)) * 9 + (bit(b1, 0) - bit(b1, 1)) * 3 + (bit(b0, 0) - bit(b0, 1));
    y += (bit(b2, 5) - bit(b2, 4)) * 81 + (bit(b1, 5) - bit(b1, 4)) * 27 + (bit(b0, 5) - bit(b0, 4)) * 9 + (bit(b1, 7) - bit(b1, 6)) * 3 + (bit(b0, 7) - bit(b0, 6));
    if ((b2 & 0xC3) === 0xC3) out.push(['C', x, y]);
    else if (b2 & 0x80) out.push(['J', x, y]);
    else out.push(['S', x, y]);
  }
  return out;
}

export function stats(cmds) {
  let prev = null, n = 0, long = 0, max = 0, len = 0, trims = 0, inJ = 0, colors = 1;
  for (const [t, x, y] of cmds) {
    if (t === 'C') { colors++; prev = [x, y]; continue; }
    if (t === 'S' && prev) { const d = Math.hypot(x - prev[0], y - prev[1]) / 10; n++; len += d; if (d > 7) long++; if (d > max) max = d; }
    if (t === 'J') { if (!inJ) trims++; inJ = 1; } else inJ = 0;
    prev = [x, y];
  }
  const xs = cmds.map(c => c[1]), ys = cmds.map(c => c[2]);
  return {
    pontos: n, cores: colors, cortes: Math.max(0, trims - 1), maxPonto: max, longos: long,
    largura: (Math.max(...xs) - Math.min(...xs)) / 10, altura: (Math.max(...ys) - Math.min(...ys)) / 10,
    linhaM: len / 1000, minutos: n / 700 + trims * 0.1,
  };
}
