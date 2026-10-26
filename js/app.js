import { readPDF, readSVG, findDesigns } from './vetor.js';
import { Grid } from './motor.js';
import { writeDST, readDST, stats } from './dst.js';
import { run as runLocal } from './trabalho.js';
import { drawStitches, drawDirections, drawPath, drawThin } from './visual.js';

const $ = (s) => document.querySelector(s);
const state = { shapes: null, natural: null, name: 'bordado', result: null, view: 'bordado', dstOnly: null, order: null, enabled: {} };

const TECIDOS = {
  normal: { density: 1.0 },
  malha: { density: 0.92, satin_max: 5.5 },
  grosso: { density: 1.1 },
};

const AVISOS = {
  texto: 'O PDF tem texto que não está convertido em curvas e foi ignorado. No Corel, selecione o texto, use <b>Objeto → Converter em curvas</b> (Ctrl+Q) e exporte de novo.',
  contornos: 'Há linhas só com contorno (sem preenchimento) e foram ignoradas. Para bordar uma linha, use <b>Converter contorno em objeto</b> (Ctrl+Shift+Q) no Corel.',
  imagem: 'O ficheiro tem imagens (bitmap). Só as formas vetoriais são bordadas.',
  gradiente: 'O ficheiro tem gradientes ou padrões, que não se bordam. Use cores sólidas.',
};

// ------------------------------------------------------------------ calculo em segundo plano
let worker = null, reqId = 0;
const pending = new Map();
try {
  worker = new Worker(new URL('./trabalho.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const p = pending.get(e.data.id); if (!p) return;
    if (e.data.progress !== undefined) { p.onProgress(e.data.progress); return; }
    pending.delete(e.data.id);
    e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.result);
  };
  worker.onerror = () => { worker = null; };
} catch (e) { worker = null; }
function compute(job, onProgress) {
  if (!worker) return new Promise((res) => setTimeout(() => res(runLocal(job, onProgress)), 20));
  const id = ++reqId;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject, onProgress }); worker.postMessage({ id, ...job }); });
}

// ------------------------------------------------------------------ ficheiros
async function openFile(file) {
  const ext = file.name.toLowerCase().split('.').pop();
  state.name = file.name.replace(/\.[^.]+$/, '');
  setStatus('A ler ' + file.name + '…');
  try {
    if (ext === 'dst') {
      const cmds = readDST(await file.arrayBuffer());
      state.shapes = null; state.pdf = null; $('#escolha').hidden = true; state.dstOnly = cmds; state.result = { cmds, info: [], groups: [{ color: [30, 50, 140] }] };
      showResult([]); setStatus('A mostrar um DST existente (só visualização).'); return;
    }
    let r;
    if (ext === 'pdf') r = await readPDF(await file.arrayBuffer());
    else if (ext === 'svg') r = readSVG(await file.text());
    else throw new Error('Formato não suportado. Use PDF (recomendado) ou SVG.');
    if (!r.shapes.length) throw new Error('Não encontrei formas preenchidas no ficheiro. ' + (r.warnings.includes('texto') ? 'O texto tem de ser convertido em curvas (Ctrl+Q no Corel, Ctrl+Shift+O no Illustrator).' : 'Confirme que o logótipo é vetorial.'));
    state.pdf = { shapes: r.shapes, warnings: r.warnings, designs: findDesigns(r.shapes) };
    state.design = 0; state.withFundo = false;
    renderDesigns(); applyDesign();
  } catch (e) {
    console.error(e); setStatus(e.message, true);
  }
}

// ------------------------------------------------------------------ varios desenhos no PDF
function applyDesign() {
  const { shapes, designs, warnings } = state.pdf, d = designs[state.design];
  const idx = d.shapes.filter(i => state.withFundo || !d.fundo.includes(i));
  loadShapes(idx.map(i => shapes[i]), warnings);
}

function renderDesigns() {
  const { shapes, designs } = state.pdf, box = $('#escolha');
  const d = designs[state.design];
  const many = designs.length > 1, hasFundo = d.fundo.length > 0;
  box.hidden = !many && !hasFundo;
  if (box.hidden) return;
  $('#escolha-texto').textContent = many ? `Este PDF tem ${designs.length} desenhos. Escolha qual quer bordar:` : 'Este desenho tem um fundo por trás.';
  const wrap = $('#desenhos'); wrap.innerHTML = ''; wrap.hidden = !many;
  designs.forEach((ds, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'desenho'; b.setAttribute('aria-pressed', i === state.design);
    b.setAttribute('aria-label', `Desenho ${i + 1}`);
    const cv = document.createElement('canvas'); cv.width = 240; cv.height = 120; b.appendChild(cv);
    const ctx = cv.getContext('2d'), [x0, x1, y0, y1] = ds.box, k = Math.min(220 / (x1 - x0), 100 / (y1 - y0));
    const ox = (240 - (x1 - x0) * k) / 2, oy = (120 - (y1 - y0) * k) / 2;
    for (const si of ds.shapes) {
      const sh = shapes[si]; ctx.beginPath();
      for (const r of sh.rings) r.forEach(([x, y], j) => { const X = ox + (x - x0) * k, Y = 120 - (oy + (y - y0) * k); j ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
      ctx.fillStyle = `rgb(${sh.color.join(',')})`; ctx.globalAlpha = ds.fundo.includes(si) ? 0.35 : 1; ctx.fill('evenodd');
    }
    const cap = document.createElement('span'); cap.textContent = `Desenho ${i + 1}` + (ds.fundo.length ? ' · com fundo' : ''); b.appendChild(cap);
    b.addEventListener('click', () => { state.design = i; state.withFundo = false; renderDesigns(); applyDesign(); });
    wrap.appendChild(b);
  });
  const op = $('#fundo-op'); op.hidden = !hasFundo;
  if (hasFundo) {
    const c = shapes[d.fundo[0]].color;
    $('#fundo-cor').innerHTML = `<span class="amostra pequena" style="background:rgb(${c.join(',')})"></span>`;
    $('#fundo').checked = state.withFundo;
  }
}

function loadShapes(shapes, warnings) {
  state.dstOnly = null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of shapes) for (const r of s.rings) for (const [x, y] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  state.shapes = shapes; state.natural = { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0 }; state.warnings = warnings;
  state.order = null; state.enabled = {};
  $('#largura').value = Math.round(state.natural.w * 10) / 10;
  syncAltura();
  $('#passo2').hidden = false;
  generate();
}

function syncAltura() {
  if (!state.natural) return;
  const w = parseFloat($('#largura').value) || state.natural.w;
  $('#altura').value = (state.natural.h * w / state.natural.w).toFixed(1);
}

// ------------------------------------------------------------------ gerar
let busy = false, again = false, lastId = 0;
async function generate() {
  if (!state.shapes) return;
  if (busy) { again = true; return; }
  busy = true; const my = ++lastId;
  setStatus('A calcular pontos e direções…'); $('#descarregar').disabled = true;
  try {
    const n = state.natural, w = parseFloat($('#largura').value) || n.w;
    const k = w / n.w, cx = (n.x0 + n.x1) / 2, cy = (n.y0 + n.y1) / 2;
    const T = (rs) => rs.map(r => r.map(([x, y]) => [(x - cx) * k, (y - cy) * k]));
    const shapes = state.shapes.map(s => ({ color: s.color, name: s.name || null, rings: T(s.rings), clips: (s.clips || []).map(T) }));
    const T0 = TECIDOS[$('#tecido').value] || {}, mx = parseFloat($('#pontomax').value) || 7;
    const P = { ...T0, max_stitch: mx, satin_max: Math.min(T0.satin_max ?? Infinity, mx - 1) };
    const t0 = performance.now();
    const r = await compute({ shapes, P, order: state.order, enabled: state.enabled },
      (p) => setStatus(`A calcular pontos e direções… ${Math.round(p * 100)} %`));
    if (my !== lastId) return;
    for (const reg of r.info) Object.setPrototypeOf(reg.grid, Grid.prototype);
    state.result = r; state.meta = r.meta; state.order = r.seq;
    for (const m of r.meta) if (state.enabled[m.key] === undefined) state.enabled[m.key] = true;
    const avisos = (state.warnings || []).map(w => AVISOS[w]).filter(Boolean);
    const finos = r.info.flatMap(x => x.parts).filter(p => p.w > 0 && p.w < 0.8).length;
    if (r.hairlines) avisos.push(`${r.hairlines} linhas finíssimas (menos de 0,3 mm à escala do bordado) foram ignoradas: não se conseguem bordar. <button type="button" class="ligacao" data-ir="finos">Ver onde estão</button>`);
    if (state.pdf && state.pdf.designs[state.design].fundo.length && !state.withFundo) avisos.push('O retângulo de fundo por trás do logótipo não é bordado (o tecido faz de fundo). Pode ativá-lo no passo 1.');
    if (finos) avisos.push(`Há ${finos} partes com traço mais fino que 0,8 mm. Podem ficar falhadas. Se possível, aumente o tamanho do bordado. <button type="button" class="ligacao" data-ir="finos">Ver onde estão</button>`);
    const nOn = r.meta.filter(m => state.enabled[m.key]).length;
    if (nOn > 4) avisos.push(`O desenho tem ${nOn} cores a bordar. Se a máquina tiver menos agulhas do que isso, vai ser preciso trocar linhas a meio ou juntar cores (desligue as que não quer bordar).`);
    showResult(avisos);
    setStatus(`Pronto em ${((performance.now() - t0) / 1000).toFixed(1)} s.`);
  } catch (e) { console.error(e); setStatus('Não foi possível gerar o bordado: ' + e.message, true); }
  finally {
    busy = false;
    if (again) { again = false; generate(); }
  }
}

// ------------------------------------------------------------------ mostrar
function cmdsLong(cmds, lim) {
  let n = 0, prev = null;
  for (const [t, x, y] of cmds) { if (t === 'S' && prev && Math.hypot(x - prev[0], y - prev[1]) > lim * 10 + 0.5) n++; prev = [x, y]; }
  return n;
}

function perColorStitches(cmds) {
  const out = [0]; let prev = null;
  for (const [t, x, y] of cmds) { if (t === 'C') out.push(0); else if (t === 'S' && prev) out[out.length - 1]++; prev = [x, y]; }
  return out;
}

function renderColors() {
  const ul = $('#cores');
  if (state.dstOnly || !state.meta) { ul.innerHTML = ''; return; }
  const byKey = Object.fromEntries(state.meta.map(m => [m.key, m]));
  const counts = perColorStitches(state.result.cmds);
  let ci = 0;
  ul.innerHTML = state.order.map((key, i) => {
    const m = byKey[key]; const on = state.enabled[key] !== false;
    const pts = on ? counts[ci++] : null;
    return `<li class="${on ? '' : 'desligada'}">
      <span class="ordem">${on ? ci : '–'}</span>
      <span class="amostra" style="background:rgb(${m.color.join(',')})"></span>
      <span class="nome">${m.name}<small>${on ? (pts || 0).toLocaleString('pt-PT') + ' pontos' : 'não é bordada'}</small></span>
      <span class="acoes">
        <button type="button" data-mover="${i}" data-dir="-1" aria-label="Bordar mais cedo" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" data-mover="${i}" data-dir="1" aria-label="Bordar mais tarde" ${i === state.order.length - 1 ? 'disabled' : ''}>↓</button>
        <label class="bordar"><input type="checkbox" data-cor="${key}" ${on ? 'checked' : ''}> Bordar</label>
      </span>
    </li>`;
  }).join('');
  $('#bloco-cores').hidden = false;
}

function showResult(avisos) {
  const { cmds } = state.result;
  const s = stats(cmds);
  $('#passo3').hidden = false;
  $('#descarregar').disabled = !!state.dstOnly;
  const fmt = (v, d = 0) => v.toLocaleString('pt-PT', { minimumFractionDigits: d, maximumFractionDigits: d });
  $('#numeros').innerHTML = [
    ['Tamanho', `${fmt(s.largura, 1)} × ${fmt(s.altura, 1)} mm`],
    ['Pontos', fmt(s.pontos)],
    ['Cortes de linha', fmt(s.cortes)],
    ['Cores', fmt(s.cores)],
    ['Maior ponto', `${fmt(s.maxPonto, 1)} mm`],
    ['Tempo aprox.', `${fmt(Math.max(1, Math.round(s.minutos)))} min`],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  const ok = s.longos === 0;
  $('#durabilidade').className = 'selo ' + (ok ? 'bom' : 'atencao');
  const lim = parseFloat($('#pontomax').value) || 7;
  const longos = cmdsLong(cmds, lim);
  $('#durabilidade').className = 'selo ' + (longos === 0 ? 'bom' : 'atencao');
  $('#durabilidade').textContent = longos === 0 ? `Nenhum ponto acima de ${lim} mm` : `${longos} pontos acima de ${lim} mm (podem prender)`;
  renderColors();
  if (state.dstOnly) $('#bloco-cores').hidden = true;
  $('#avisos').innerHTML = avisos.map(a => `<li>${a}</li>`).join('');
  $('#avisos').hidden = !avisos.length;
  $('#vista-direcoes').disabled = !state.result.info.length;
  const nFinos = state.result.info.flatMap(x => x.parts).filter(p => p.w > 0 && p.w < 0.8).length;
  const nHair = state.result.hairlines || 0;
  $('#vista-finos').disabled = !nFinos && !nHair;
  $('#vista-finos').textContent = (nFinos || nHair) ? `Traço < 0,8 mm (${nFinos + nHair})` : 'Traço < 0,8 mm';
  if (!nFinos && !nHair && state.view === 'finos') setView('bordado');
  draw();
}

function draw() {
  if (!state.result) return;
  const cv = $('#tela'), box = cv.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const { cmds } = state.result;
  const s = stats(cmds), ratio = s.altura / Math.max(1, s.largura);
  const cssW = box.width, cssH = Math.min(Math.max(150, cssW * ratio + 48), 640);
  cv.style.height = cssH + 'px';
  cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
  const css = getComputedStyle(document.documentElement);
  const colors = state.result.groups.map(g => g.color);
  if (state.view === 'bordado') drawStitches(cv, cmds, colors, css.getPropertyValue('--tecido').trim());
  else if (state.view === 'direcoes') drawDirections(cv, state.result.info, cmds);
  else if (state.view === 'finos') drawThin(cv, state.result.info, cmds, 0.8, state.result.hairRings || []);
  else drawPath(cv, cmds, css.getPropertyValue('--tinta').trim(), css.getPropertyValue('--salto').trim());
  $('#legenda').textContent = {
    bordado: 'Simulação do bordado na máquina.',
    direcoes: 'Cada cor é uma parte do desenho. Os tracinhos mostram a direção do ponto.',
    percurso: 'Percurso da agulha. A tracejado vermelho: saltos com corte de linha.',
    finos: 'A vermelho: partes bordadas com traço mais fino que 0,8 mm (as pequenas têm um círculo à volta). A roxo: linhas finíssimas (< 0,3 mm) que não são bordadas. A cinzento: o resto do desenho.',
  }[state.view];
}

function download() {
  if (!state.result || state.dstOnly) return;
  const bytes = writeDST(state.result.cmds, state.name);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  a.download = state.name.replace(/[^\w\- ]+/g, '_') + '.dst';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function setStatus(msg, err = false) { const el = $('#estado'); el.textContent = msg; el.classList.toggle('erro', err); }

// ------------------------------------------------------------------ exemplo
function exemplo() {
  // emblema simples: anel, estrela e barra (formas vetoriais geradas aqui mesmo)
  const circle = (r, n = 120, cx = 0, cy = 0) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos(2 * Math.PI * i / n), cy + r * Math.sin(2 * Math.PI * i / n)]);
  const star = (R, r) => Array.from({ length: 10 }, (_, i) => { const a = Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? r : R; return [q * Math.cos(a), q * Math.sin(a) + 2]; });
  const shapes = [
    { color: [24, 44, 120], rings: [circle(30), circle(25).reverse()] },
    { color: [24, 44, 120], rings: [star(17, 7)] },
    { color: [24, 44, 120], rings: [[[-14, -15], [14, -15], [14, -19], [-14, -19]]] },
  ];
  state.name = 'exemplo'; state.pdf = null; $('#escolha').hidden = true;
  loadShapes(shapes, []);
  $('#largura').value = 60; syncAltura(); generate();
}

// ------------------------------------------------------------------ eventos
const zone = $('#zona');
zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('sobre'); });
zone.addEventListener('dragleave', () => zone.classList.remove('sobre'));
zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('sobre'); const f = e.dataTransfer.files[0]; if (f) openFile(f); });
$('#ficheiro').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) openFile(f); e.target.value = ''; });
$('#exemplo').addEventListener('click', exemplo);
$('#fundo').addEventListener('change', (e) => { state.withFundo = e.target.checked; applyDesign(); });
let deb;
$('#largura').addEventListener('input', () => { syncAltura(); clearTimeout(deb); deb = setTimeout(generate, 600); });
$('#altura').addEventListener('input', () => {
  if (!state.natural) return;
  const h = parseFloat($('#altura').value); if (!h) return;
  $('#largura').value = (state.natural.w * h / state.natural.h).toFixed(1);
  clearTimeout(deb); deb = setTimeout(generate, 600);
});
$('#tecido').addEventListener('change', generate);
$('#pontomax').addEventListener('change', generate);
$('#cores').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mover]'); if (!b) return;
  const i = +b.dataset.mover, j = i + +b.dataset.dir;
  if (j < 0 || j >= state.order.length) return;
  [state.order[i], state.order[j]] = [state.order[j], state.order[i]];
  renderColors(); generate();
});
$('#cores').addEventListener('change', (e) => {
  const c = e.target.closest('[data-cor]'); if (!c) return;
  state.enabled[c.dataset.cor] = c.checked;
  if (!Object.values(state.enabled).some(Boolean)) { state.enabled[c.dataset.cor] = true; c.checked = true; return; }
  generate();
});
$('#descarregar').addEventListener('click', download);
function setView(v) {
  state.view = v;
  for (const o of document.querySelectorAll('[data-vista]')) o.setAttribute('aria-pressed', o.dataset.vista === v);
  draw();
}
for (const b of document.querySelectorAll('[data-vista]')) b.addEventListener('click', () => setView(b.dataset.vista));
$('#avisos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ir]'); if (!b) return;
  setView(b.dataset.ir); $('.quadro').scrollIntoView({ behavior: 'smooth', block: 'center' });
});
window.addEventListener('resize', () => { clearTimeout(window._rz); window._rz = setTimeout(draw, 150); });
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', draw);
