import { readPDF, readSVG } from './vetor.js';
import { digitize } from './motor.js';
import { writeDST, readDST, stats } from './dst.js';
import { drawStitches, drawDirections, drawPath } from './visual.js';

const $ = (s) => document.querySelector(s);
const state = { shapes: null, natural: null, name: 'bordado', result: null, view: 'bordado', dstOnly: null };

const TECIDOS = {
  normal: { density: 1.0 },
  malha: { density: 0.92, satin_max: 5.5 },
  grosso: { density: 1.1 },
};

const AVISOS = {
  texto: 'O PDF tem texto que não está convertido em curvas e foi ignorado. No Corel, selecione o texto, use <b>Objeto → Converter em curvas</b> (Ctrl+Q) e exporte de novo.',
  contornos: 'Há linhas só com contorno (sem preenchimento) e foram ignoradas. Para bordar uma linha, use <b>Converter contorno em objeto</b> (Ctrl+Shift+Q) no Corel.',
  imagem: 'O ficheiro tem imagens (bitmap). Só as formas vetoriais são bordadas.',
};

// ------------------------------------------------------------------ ficheiros
async function openFile(file) {
  const ext = file.name.toLowerCase().split('.').pop();
  state.name = file.name.replace(/\.[^.]+$/, '');
  setStatus('A ler ' + file.name + '…');
  try {
    if (ext === 'dst') {
      const cmds = readDST(await file.arrayBuffer());
      state.shapes = null; state.dstOnly = cmds; state.result = { cmds, info: [], groups: [{ color: [30, 50, 140] }] };
      showResult([]); setStatus('A mostrar um DST existente (só visualização).'); return;
    }
    let r;
    if (ext === 'pdf') r = await readPDF(await file.arrayBuffer());
    else if (ext === 'svg') r = readSVG(await file.text());
    else throw new Error('Formato não suportado. Use PDF (recomendado) ou SVG.');
    if (!r.shapes.length) throw new Error('Não encontrei formas preenchidas no ficheiro. ' + (r.warnings.includes('texto') ? 'O texto tem de ser convertido em curvas no Corel (Ctrl+Q).' : 'Confirme que o logótipo é vetorial.'));
    loadShapes(r.shapes, r.warnings);
  } catch (e) {
    console.error(e); setStatus(e.message, true);
  }
}

function loadShapes(shapes, warnings) {
  state.dstOnly = null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of shapes) for (const r of s.rings) for (const [x, y] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  state.shapes = shapes; state.natural = { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0 }; state.warnings = warnings;
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
let busy = false, again = false;
async function generate() {
  if (!state.shapes) return;
  if (busy) { again = true; return; }
  busy = true;
  setStatus('A calcular pontos e direções…'); $('#descarregar').disabled = true;
  await new Promise(r => setTimeout(r, 30));
  try {
    const n = state.natural, w = parseFloat($('#largura').value) || n.w;
    const k = w / n.w, cx = (n.x0 + n.x1) / 2, cy = (n.y0 + n.y1) / 2;
    const shapes = state.shapes.map(s => ({ color: s.color, rings: s.rings.map(r => r.map(([x, y]) => [(x - cx) * k, (y - cy) * k])) }));
    const P = TECIDOS[$('#tecido').value] || {};
    const t0 = performance.now();
    state.result = digitize(shapes, P);
    const avisos = (state.warnings || []).map(w => AVISOS[w]).filter(Boolean);
    const finos = state.result.info.flatMap(r => r.parts).filter(p => p.w > 0 && p.w < 0.8).length;
    if (finos) avisos.push(`Há ${finos} partes com traço mais fino que 0,8 mm. Podem ficar falhadas. Se possível, aumente o tamanho do bordado.`);
    showResult(avisos);
    setStatus(`Pronto em ${((performance.now() - t0) / 1000).toFixed(1)} s.`);
  } catch (e) { console.error(e); setStatus('Não foi possível gerar o bordado: ' + e.message, true); }
  busy = false;
  if (again) { again = false; generate(); }
}

// ------------------------------------------------------------------ mostrar
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
  $('#durabilidade').textContent = ok ? 'Nenhum ponto acima de 7 mm' : `${s.longos} pontos acima de 7 mm (podem prender)`;
  const cores = state.result.groups.map(g => g.color);
  $('#cores').innerHTML = state.dstOnly ? '' : cores.map((c, i) => `<li><span class="amostra" style="background:rgb(${c.join(',')})"></span>Cor ${i + 1}</li>`).join('');
  $('#avisos').innerHTML = avisos.map(a => `<li>${a}</li>`).join('');
  $('#avisos').hidden = !avisos.length;
  $('#vista-direcoes').disabled = !state.result.info.length;
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
  else drawPath(cv, cmds, css.getPropertyValue('--tinta').trim(), css.getPropertyValue('--salto').trim());
  $('#legenda').textContent = {
    bordado: 'Simulação do bordado na máquina.',
    direcoes: 'Cada cor é uma parte do desenho. Os tracinhos mostram a direção do ponto.',
    percurso: 'Percurso da agulha. A tracejado vermelho: saltos com corte de linha.',
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
  state.name = 'exemplo';
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
let deb;
$('#largura').addEventListener('input', () => { syncAltura(); clearTimeout(deb); deb = setTimeout(generate, 600); });
$('#altura').addEventListener('input', () => {
  if (!state.natural) return;
  const h = parseFloat($('#altura').value); if (!h) return;
  $('#largura').value = (state.natural.w * h / state.natural.h).toFixed(1);
  clearTimeout(deb); deb = setTimeout(generate, 600);
});
$('#tecido').addEventListener('change', generate);
$('#descarregar').addEventListener('click', download);
for (const b of document.querySelectorAll('[data-vista]')) {
  b.addEventListener('click', () => {
    state.view = b.dataset.vista;
    for (const o of document.querySelectorAll('[data-vista]')) o.setAttribute('aria-pressed', o === b);
    draw();
  });
}
window.addEventListener('resize', () => { clearTimeout(window._rz); window._rz = setTimeout(draw, 150); });
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', draw);
