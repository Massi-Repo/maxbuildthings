// Misura le prestazioni del sito vetrina con Playwright (stessa base di og.mjs).
//   1. mobile 390x844 @3x, touch, CPU rallentata 4x: fps a riposo e durante lo scroll, canvas, memoria JS
//   2. desktop 1440x900, nessun rallentamento: stessa misura
//   3. mobile con JavaScript spento: screenshot a pagina intera in screenshot/nojs-mobile.jpg
// Uso:  node strumenti/prestazioni.mjs [url] [--giri=N] [--software]      (url di default: http://localhost:5181/)
//   --giri=N     ripete le misure 1 e 2 N volte e stampa la mediana (il PC e' rumoroso: per confronti prima/dopo usa 3)
//   --software   forza SwiftShader (WebGL su CPU, caso peggiore con fps molto piu' bassi); senza, usa la GPU vera del PC
// Il sito va servito prima (server statico sulla cartella del progetto). La riga "WebGL:" dice quale renderer e' in uso.
import { chromium } from 'playwright';
import sharp from 'sharp';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const argomenti = process.argv.slice(2);
const software = argomenti.includes('--software');
const giri = Math.max(1, parseInt((argomenti.find(a => a.startsWith('--giri=')) || '').split('=')[1], 10) || 1);
const url = argomenti.find(a => !a.startsWith('--')) || 'http://localhost:5181/';
const radice = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ATTESA_MS = 4000;   // dopo il caricamento, prima di misurare
const FERMO_MS = 5000;    // durata misura a pagina ferma
const SCROLL_MS = 5000;   // durata misura mentre scorre

const un = (n, c = 1) => Number(n).toFixed(c);
const mb = b => (b / 1048576).toFixed(1) + ' MB';
const mediana = v => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// ---- eseguito dentro la pagina: conta i frame con requestAnimationFrame (e scorre, se richiesto) ----
function contaFrame({ durata, scorri }) {
  return new Promise(risolvi => {
    const intervalli = [];
    const doc = document.scrollingElement || document.documentElement;
    let t0 = null, prec = null, timer = null, scrollMax = 0, finito = false;
    const fine = () => {
      if (finito) return; finito = true;
      clearInterval(timer);
      risolvi({ intervalli, scrollMax, altezza: doc.scrollHeight - innerHeight });
    };
    if (scorri) {
      // un passo ogni 50 ms che segue l'orologio (~1000 px/s, come un dito che scorre anche se i frame sono lenti);
      // scende fino in fondo e poi risale
      const inizio = performance.now();
      timer = setInterval(() => {
        const max = Math.max(1, doc.scrollHeight - innerHeight);
        const ciclo = (performance.now() - inizio) % (2 * max);
        const y = ciclo <= max ? ciclo : 2 * max - ciclo;
        window.scrollBy({ top: y - doc.scrollTop, behavior: 'instant' });   // 'instant': il sito ha scroll-behavior:smooth
        scrollMax = Math.max(scrollMax, doc.scrollTop);
      }, 50);
    }
    function f(ora) {
      if (t0 === null) t0 = ora; else intervalli.push(ora - prec);   // il primo frame fa solo da riferimento
      prec = ora;
      if (ora - t0 < durata) requestAnimationFrame(f); else fine();
    }
    requestAnimationFrame(f);
    setTimeout(fine, durata + 8000);   // rete di sicurezza se i frame si bloccano
  });
}

// ---- eseguito dentro la pagina: elenco dei canvas e versione di three.js (non tocca nulla) ----
function elencoCanvas() {
  return {
    three: typeof THREE !== 'undefined' ? 'r' + THREE.REVISION : null,
    canvas: [...document.querySelectorAll('canvas')].map(c => {
      const r = c.getBoundingClientRect();
      const dimensioni = r.width > 0 && r.height > 0;
      return {
        nome: c.id ? '#' + c.id : (c.className ? '.' + String(c.className).split(' ')[0] : 'canvas'),
        css: Math.round(r.width) + 'x' + Math.round(r.height),
        px: c.width + 'x' + c.height,
        visibile: dimensioni && c.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
        nelViewport: dimensioni && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth,
      };
    }),
  };
}

// ---- eseguito dentro la pagina, a misura finita (crea un contesto WebGL di prova): quale renderer c'e' sotto ----
function rendererWebGL() {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return 'WebGL non disponibile';
    const e = gl.getExtension('WEBGL_debug_renderer_info');
    const r = e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const perdi = gl.getExtension('WEBGL_lose_context'); if (perdi) perdi.loseContext();
    return r;
  } catch { return 'WebGL non disponibile'; }
}

const memoriaOra = page => page.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize : null);

function statistiche(intervalli) {
  if (intervalli.length < 2) return { fps: 0, max: 0, p95: 0, frame: intervalli.length, secondi: intervalli.reduce((a, b) => a + b, 0) / 1000 };
  const tot = intervalli.reduce((a, b) => a + b, 0);
  const ord = [...intervalli].sort((a, b) => a - b);
  return { fps: intervalli.length / (tot / 1000), max: ord[ord.length - 1], p95: ord[Math.floor(0.95 * (ord.length - 1))], frame: intervalli.length, secondi: tot / 1000 };
}

function riga(nome, s, extra = '') {
  return `  ${nome.padEnd(14)} ${un(s.fps).padStart(5)} fps | frame max ${un(s.max, 0).padStart(5)} ms | p95 ${un(s.p95, 0).padStart(4)} ms | ${s.frame} frame in ${un(s.secondi)} s${extra}`;
}

// Una misura completa su un profilo. Se dettagli e' true stampa anche canvas, renderer ed errori.
async function misura(browser, { viewport, scale, mobile, rallenta }, dettagli, etichetta) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript(() => { sessionStorage.setItem('booted', '1'); sessionStorage.setItem('dlg', '1'); });   // salta schermata di avvio e dialogo
  const page = await ctx.newPage();
  const problemi = [];
  page.on('pageerror', e => problemi.push('errore JS: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') problemi.push('console.error: ' + m.text()); });
  page.on('requestfailed', r => problemi.push('richiesta fallita: ' + r.url().slice(0, 100)));
  if (rallenta > 1) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: rallenta });
  }
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(ATTESA_MS);

  const { three, canvas } = await page.evaluate(elencoCanvas);
  if (dettagli) {
    const visibili = canvas.filter(c => c.visibile).length;
    const nelViewport = canvas.filter(c => c.visibile && c.nelViewport).length;
    console.log(`  canvas: ${canvas.length} totali, ${visibili} visibili, ${nelViewport} visibili nel viewport`);
    for (const c of canvas) {
      console.log(`    ${c.nome.padEnd(8)} ${c.css.padStart(9)} css, ${c.px.padStart(10)} px | ${c.visibile ? 'visibile' : 'nascosto'}${c.visibile && !c.nelViewport ? ' (fuori viewport)' : ''}`);
    }
  }

  const fermo = statistiche((await page.evaluate(contaFrame, { durata: FERMO_MS, scorri: false })).intervalli);
  const memFermo = await memoriaOra(page);
  console.log(riga(`fermo${etichetta}`, fermo, memFermo != null ? ` | heap JS ${mb(memFermo)}` : ''));

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  const sc = await page.evaluate(contaFrame, { durata: SCROLL_MS, scorri: true });
  const scroll = statistiche(sc.intervalli);
  const memScroll = await memoriaOra(page);
  console.log(riga(`scroll${etichetta}`, scroll, ` | scroll fino a ${Math.round(sc.scrollMax)} px su ${Math.round(sc.altezza)}${memScroll != null ? ` | heap JS ${mb(memScroll)}` : ''}`));

  if (dettagli) {
    if (memFermo == null) console.log('  memoria JS non disponibile (performance.memory assente)');
    console.log(`  three.js: ${three ?? 'NON CARICATO'} | WebGL: ${await page.evaluate(rendererWebGL)}`);
    const unici = [...new Set(problemi)];
    console.log(`  errori/avvisi: ${unici.length ? '' : 'nessuno'}`);
    for (const p of unici.slice(0, 4)) console.log('    - ' + p.slice(0, 160));
  }
  await ctx.close();
  return { fermo, scroll };
}

async function profilo(browser, nome, p) {
  console.log(`\n== ${nome}: ${p.viewport.width}x${p.viewport.height} @${p.scale}x${p.mobile ? ', touch' : ''}${p.rallenta > 1 ? `, CPU rallentata ${p.rallenta}x` : ', nessun rallentamento'}${giri > 1 ? `, ${giri} giri` : ''} ==`);
  const risultati = [];
  for (let i = 1; i <= giri; i++) risultati.push(await misura(browser, p, i === 1, giri > 1 ? ` ${i}/${giri}` : ''));
  if (giri > 1) {
    const m = k => ({ fps: mediana(risultati.map(r => r[k].fps)), max: mediana(risultati.map(r => r[k].max)), p95: mediana(risultati.map(r => r[k].p95)), frame: Math.round(mediana(risultati.map(r => r[k].frame))), secondi: mediana(risultati.map(r => r[k].secondi)) });
    console.log(riga('mediana fermo', m('fermo')));
    console.log(riga('mediana scroll', m('scroll')));
  }
}

async function senzaJs(browser) {
  const viewport = { width: 390, height: 844 };
  console.log(`\n== SENZA JAVASCRIPT: ${viewport.width}x${viewport.height}, touch ==`);
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(2000);
  try {
    // con JS spento Playwright riesce comunque a interrogare il DOM (se no, resta solo lo screenshot)
    const d = await page.evaluate(() => {
      const vis = el => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      const win = [...document.querySelectorAll('.win')];
      const link = [...document.querySelectorAll('a[href]')];
      const boot = document.querySelector('#boot');
      return {
        win: win.length, winVisibili: win.filter(vis).length,
        link: link.length, linkVisibili: link.filter(vis).length,
        linkEsterni: link.filter(a => /^https?:/.test(a.getAttribute('href'))).length,
        bootVisibile: boot ? vis(boot) : false,
        altezza: document.documentElement.scrollHeight,
      };
    });
    console.log(`  finestre .win: ${d.win} (visibili ${d.winVisibili}) | link: ${d.link} (visibili ${d.linkVisibili}, esterni http ${d.linkEsterni}) | schermata di avvio visibile: ${d.bootVisibile ? 'SI' : 'no'} | pagina alta ${d.altezza} px`);
  } catch (e) {
    console.log('  controllo DOM non riuscito: ' + String(e.message).split('\n')[0]);
  }
  const png = await page.screenshot({ fullPage: true });
  await ctx.close();
  mkdirSync(join(radice, 'screenshot'), { recursive: true });
  const file = join(radice, 'screenshot', 'nojs-mobile.jpg');
  const info = await sharp(png).resize({ width: 500 }).jpeg({ quality: 60, mozjpeg: true }).toFile(file);
  console.log(`  screenshot: ${file} (${info.width}x${info.height}, ${(info.size / 1024).toFixed(0)} KB)`);
}

console.log(`Misure su ${url} (${software ? 'forzato SwiftShader, WebGL su CPU' : 'GPU del PC se disponibile'})`);
const opzioni = { args: ['--enable-precise-memory-info'] };
if (!software) opzioni.channel = 'chromium';   // Chromium completo in "new headless": usa la GPU; il launch di default usa la shell headless con SwiftShader
const browser = await chromium.launch(opzioni);
try {
  await profilo(browser, 'MOBILE', { viewport: { width: 390, height: 844 }, scale: 3, mobile: true, rallenta: 4 });
  await profilo(browser, 'DESKTOP', { viewport: { width: 1440, height: 900 }, scale: 1, mobile: false, rallenta: 1 });
  await senzaJs(browser);
} finally {
  await browser.close();
}
