// Calculo em segundo plano (Web Worker): camadas de cor + digitalizacao.
import { prepareLayers, colorName } from './camadas.js';
import { digitizeGroups } from './motor.js';

export function run({ shapes, P, order, enabled }, onProgress) {
  const { groups } = prepareLayers(shapes);
  const meta = groups.map((g) => ({ key: g.name || g.color.join(','), color: g.color, name: g.name || colorName(g.color) }));
  // ordem de bordado: as cores ja conhecidas na ordem pedida, as novas no fim (ordem de pintura)
  const keys = meta.map(m => m.key);
  const seq = [...(order || []).filter(k => keys.includes(k)), ...keys.filter(k => !(order || []).includes(k))];
  const chosen = seq.filter(k => !enabled || enabled[k] !== false).map(k => groups[keys.indexOf(k)]);
  const res = digitizeGroups(chosen, P, onProgress);
  return {
    cmds: res.cmds,
    info: res.info.map(r => ({ grid: r.grid, labels: r.labels, color: r.color, parts: r.parts.map(p => ({ id: p.id, ang: p.ang, w: p.w, satin: p.satin, rails: p.rails })) })),
    groups: res.groups.map(g => ({ color: g.color, name: g.name })),
    meta, seq,
  };
}

if (typeof self !== 'undefined' && typeof window === 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = (e) => {
    const { id } = e.data;
    try {
      let last = 0;
      const out = run(e.data, (p) => { if (p - last > 0.02) { last = p; self.postMessage({ id, progress: p }); } });
      self.postMessage({ id, result: out });
    } catch (err) { self.postMessage({ id, error: err.message || String(err) }); }
  };
}
