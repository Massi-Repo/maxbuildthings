// Misura quanto pesa ogni animazione CSS sul telefono simulato, una alla volta.
// Edge senza finestra (headless), emulazione via CDP: Emulation.setDeviceMetricsOverride mobile:true 390x844 @3x, touch, CPU rallentata 4x.
// Per ogni animazione: pagina con TUTTE le animazioni CSS spente tranne quella, fps a riposo e durante lo scroll.
// Riferimenti: "tutto acceso" (il sito com'e'), "nessuna" (tutte spente), "senza WebGL" (three.js bloccato, animazioni accese).
// I giri sono intrecciati (A B C... A B C...) per spalmare il rumore del PC; si stampa la mediana.
// Uso:  node strumenti/misura-animazioni.mjs [url] [--giri=3] [--solo=nome1,nome2]     (url di default: http://localhost:5182/)
import { chromium } from 'playwright';

const argomenti = process.argv.slice(2);
const giri = Math.max(1, parseInt((argomenti.find(a => a.startsWith('--giri=')) || '').split('=')[1], 10) || 3);
const solo = ((argomenti.find(a => a.startsWith('--solo=')) || '').split('=')[1] || '').split(',').filter(Boolean);
const url = argomenti.find(a => !a.startsWith('--')) || 'http://localhost:5182/';
const ATTESA_MS = 3500, FERMO_MS = 4000, SCROLL_MS = 4000;

// nome -> selettori delle animazioni CSS del sito (index.html)
const ANIMAZIONI = {
  'scritta che scorre (ticker)': '.ticker-track',
  'luccichio MAX BUILD THINGS': '.word i',
  'glitch del titolo': '.word i::before,.word i::after,.word.glitch i::before,.word.glitch i::after',
  'riquadro .com': '.dotcom',
  'frecce progetti': '.hint i',
  'cursore del prompt': '.prompt .cur',
  'REC lampeggiante': '.osd .rec',
  'barra olografica finestra attiva': '.win.active .bar',
  'led LIVE': '.led.live',
  'stella NEW!': '.newb,.newb b',
  'pallini ReteVeloce': '.net i',
  'nastro In costruzione': '.construction',
  'badge BEST VIEWED': '.b88.blink',
  'pavimento CSS di riserva': '.floor',
};
const TUTTE = Object.values(ANIMAZIONI).join(',');
const spegni = sel => sel ? `${sel}{animation:none!important}` : '';

const varianti = [
  { nome: 'tutto acceso', css: '' },
  { nome: 'nessuna animazione CSS', css: spegni(TUTTE) + '*,*::before,*::after{animation:none!important}' },
  { nome: 'senza WebGL', css: '', senzaGL: true },
  // "senza X": tutto acceso tranne X. Da sola nessuna animazione satura il frame (misura del 31/10: tutte ~55 fps),
  // e' la somma che pesa: per vedere il contributo di ciascuna la si toglie dal sito pieno.
  ...Object.entries(ANIMAZIONI).map(([nome, sel]) => ({ nome: 'senza ' + nome, css: spegni(sel) })),
].filter(v => !solo.length || solo.some(s => v.nome.includes(s)));

function contaFrame({ durata, scorri }) {
  return new Promise(risolvi => {
    const intervalli = []; const doc = document.scrollingElement || document.documentElement;
    let t0 = null, prec = null, timer = null, finito = false;
    const fine = () => { if (finito) return; finito = true; clearInterval(timer); risolvi(intervalli); };
    if (scorri) {
      const inizio = performance.now();
      timer = setInterval(() => {
        const max = Math.max(1, doc.scrollHeight - innerHeight), ciclo = (performance.now() - inizio) % (2 * max);
        window.scrollBy({ top: (ciclo <= max ? ciclo : 2 * max - ciclo) - doc.scrollTop, behavior: 'instant' });
      }, 50);
    }
    function f(ora) { if (t0 === null) t0 = ora; else intervalli.push(ora - prec); prec = ora; if (ora - t0 < durata) requestAnimationFrame(f); else fine(); }
    requestAnimationFrame(f); setTimeout(fine, durata + 8000);
  });
}
const fps = v => v.length < 2 ? 0 : v.length / (v.reduce((a, b) => a + b, 0) / 1000);
const mediana = v => { const s = [...v].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

async function misura(browser, v) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => { try { sessionStorage.setItem('booted', '1'); sessionStorage.setItem('dlg', '1'); } catch (e) {} });
  if (v.css) await ctx.addInitScript(css => { document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); }); }, v.css);
  if (v.senzaGL) await ctx.route('**/vendor/three/**', r => r.abort());
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(ATTESA_MS);
  await cdp.send('Performance.enable');
  const metriche = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const m0 = await metriche();
  const fermo = fps(await page.evaluate(contaFrame, { durata: FERMO_MS, scorri: false }));
  const m1 = await metriche();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  const scroll = fps(await page.evaluate(contaFrame, { durata: SCROLL_MS, scorri: true }));
  await ctx.close();
  // thread principale occupato, in ms per secondo, a pagina ferma (tempi gia' rallentati 4x)
  const sec = m1.Timestamp - m0.Timestamp;
  return { fermo, scroll, cpu: (m1.TaskDuration - m0.TaskDuration) / sec * 1000, stile: (m1.RecalcStyleDuration - m0.RecalcStyleDuration) / sec * 1000 };
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ris = new Map(varianti.map(v => [v.nome, []]));
try {
  const p = await browser.newPage();
  const gpu = await p.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl'); const e = gl && gl.getExtension('WEBGL_debug_renderer_info'); return gl ? (e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'nessun WebGL'; });
  await p.close();
  console.log(`Edge headless ${browser.version()} | WebGL: ${gpu}\nTelefono simulato 390x844 @3x, mobile:true, touch, CPU 4x | ${giri} giri intrecciati, mediana | ${url}\n`);
  for (let g = 1; g <= giri; g++) {
    for (const v of varianti) { ris.get(v.nome).push(await misura(browser, v)); process.stdout.write('.'); }
    process.stdout.write(` giro ${g}/${giri}\n`);
  }
} finally { await browser.close(); }

const pieno = ris.get('tutto acceso') ? mediana(ris.get('tutto acceso').map(r => r.cpu)) : null;
console.log('\n' + 'variante'.padEnd(44) + 'fermo'.padStart(7) + 'scroll'.padStart(8) + 'CPU ms/s'.padStart(10) + 'stile'.padStart(7) + '   (fps mediani; CPU = thread principale a pagina ferma; tra parentesi CPU risparmiata rispetto a "tutto acceso")');
for (const v of varianti) {
  const r = ris.get(v.nome), f = mediana(r.map(x => x.fermo)), s = mediana(r.map(x => x.scroll)), c = mediana(r.map(x => x.cpu)), st = mediana(r.map(x => x.stile));
  const delta = v.nome !== 'tutto acceso' && pieno != null ? `  (${(pieno - c).toFixed(0)})` : '';
  console.log(v.nome.padEnd(44) + f.toFixed(1).padStart(7) + s.toFixed(1).padStart(8) + c.toFixed(0).padStart(10) + st.toFixed(0).padStart(7) + delta);
}
