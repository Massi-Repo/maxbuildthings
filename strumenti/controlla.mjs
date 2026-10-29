// Controllo prima del deploy: errori JS, violazioni della CSP, richieste a domini terzi, font, scena WebGL, 404, copia della mail.
// Uso: node strumenti/serve.mjs &   poi   node strumenti/controlla.mjs [url]   (predefinito http://localhost:5182/)
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] || 'http://localhost:5182/';
const origine = new URL(base).origin;
mkdirSync('screenshot', { recursive: true });
const browser = await chromium.launch();
let problemi = 0;
const esito = (ok, testo) => { if (!ok) problemi++; console.log(ok ? '  ok ' : '  NO ', testo); };

async function prova(nome, viewport, extra = {}) {
  console.log(`\n${nome} ${viewport.width}×${viewport.height}`);
  const ctx = await browser.newContext({ viewport, ...extra });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: origine });
  await ctx.addInitScript(() => { sessionStorage.setItem('booted', '1'); sessionStorage.setItem('dlg', '1'); });
  const page = await ctx.newPage();
  const errori = [], terzi = new Set();
  page.on('console', m => { if (m.type() === 'error') errori.push(m.text()); });
  page.on('pageerror', e => errori.push(e.message));
  page.on('request', r => { const u = new URL(r.url()); if (u.protocol.startsWith('http') && u.origin !== origine) terzi.add(u.host); });
  const risposta = await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  esito(risposta.status() === 200, `pagina: HTTP ${risposta.status()}`);
  const csp = risposta.headers()['content-security-policy'];
  esito(!!csp, csp ? 'intestazioni di vercel.json applicate' : 'intestazioni di vercel.json ASSENTI (server giusto?)');
  esito(errori.length === 0, `errori in console: ${errori.length}${errori.length ? '\n       ' + errori.slice(0, 5).join('\n       ') : ''}`);
  esito(terzi.size === 0, `domini terzi contattati: ${terzi.size ? [...terzi].join(', ') : 'nessuno'}`);
  const font = await page.evaluate(async () => { await document.fonts.ready;
    return { playfair: document.fonts.check('italic 800 40px "Playfair Display"'), vt323: document.fonts.check('20px "VT323"') }; });
  esito(font.playfair && font.vt323, `font locali caricati: Playfair ${font.playfair}, VT323 ${font.vt323}`);
  const gl = await page.evaluate(() => { const c = document.getElementById('gl'); return { three: !!window.THREE, on: document.getElementById('scene').classList.contains('gl'), w: c ? c.width : 0, h: c ? c.height : 0 }; });
  esito(gl.three && gl.on && gl.w > 300, `scena WebGL attiva: THREE ${gl.three}, canvas ${gl.w}×${gl.h}`);
  const cta = page.locator('a.cta');
  if (await cta.count()) {
    await cta.click({ noWaitAfter: true }).catch(() => {});
    await page.waitForTimeout(300);
    const copiato = await page.evaluate(async () => ({ bottone: document.querySelector('a.cta').textContent, testo: await navigator.clipboard.readText().catch(() => '') }));
    esito(copiato.bottone.includes('copiato') && copiato.testo === 'massi.cc@proton.me', `clic su "scrivimi": il bottone dice "${copiato.bottone}", appunti "${copiato.testo}"`);
    await page.screenshot({ path: `screenshot/controllo-${nome}-copiato.png` });
  }
  // la griglia deve vedersi senza scorrere (regola del progetto): quanto della prima finestra sta sopra la barra in basso?
  const griglia = await page.evaluate(() => { const w = document.querySelector('#grid .win'), tb = document.getElementById('taskbar');
    const r = w.getBoundingClientRect(), fondo = tb.getBoundingClientRect().top; return { visibile: Math.max(0, Math.round(fondo - r.top)), fondo: Math.round(fondo) }; });
  esito(griglia.visibile >= 120, `prima finestra visibile senza scorrere: ${griglia.visibile} px (senza contare la barra del browser del telefono)`);
  const barra = await page.evaluate(() => { const t = document.querySelector('.tasks'); return { serve: t.scrollWidth, c: t.clientWidth }; });
  if (viewport.width >= 1024) esito(barra.serve <= barra.c + 1, `barra in basso: tutti i bottoni entrano (${barra.serve} px su ${barra.c})`);
  const png = await page.screenshot();
  await sharp(png).resize({ width: Math.min(1200, viewport.width * (extra.deviceScaleFactor || 1)) }).jpeg({ quality: 70 }).toFile(`screenshot/controllo-${nome}.jpg`);
  await ctx.close();
}

await prova('desktop', { width: 1440, height: 900 });
await prova('mobile', { width: 390, height: 844 }, { deviceScaleFactor: 2, isMobile: true, hasTouch: true });

console.log('\npagina che non esiste');
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const r404 = await page.goto(new URL('/progetti/che-non-esiste', base).href, { waitUntil: 'networkidle' });
esito(r404.status() === 404, `HTTP ${r404.status()}, titolo "${await page.title()}", percorso mostrato "${await page.textContent('#path')}"`);
await page.screenshot({ path: 'screenshot/controllo-404.png' });
await ctx.close();

for (const f of ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'manifest.webmanifest', 'og.jpg', 'robots.txt', 'sitemap.xml']) {
  const r = await fetch(new URL(f, base));
  esito(r.ok, `${f}: HTTP ${r.status}`);
}
// le note interne non devono essere pubblicate (.vercelignore)
for (const f of ['STATO.md', 'CLAUDE.md', 'README.md', 'profilo-github/README.md', 'strumenti/serve.mjs']) {
  const r = await fetch(new URL(f, base));
  esito(r.status === 404, `${f} non pubblicato: HTTP ${r.status}`);
}
await browser.close();
console.log(problemi ? `\n${problemi} problemi` : '\ntutto a posto');
process.exitCode = problemi ? 1 : 0;
