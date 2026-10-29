// Scatta lo screenshot di una pagina per una finestra del portfolio: 800×774, JPEG sotto i 50 KB.
//
// Uso:  node strumenti/scatto-finestra.mjs <url> <nome> [selettore] [--attesa=ms] [--mobile]
//   url          la pagina da aprire
//   nome         nome del file, senza estensione → screenshot/<nome>.jpg (nella radice del progetto)
//   selettore    (facoltativo) elemento CSS da portare al centro dello schermo prima dello scatto
//   --attesa=ms  (facoltativo) pausa in più subito prima dello scatto, per animazioni lunghe
//   --mobile     (facoltativo) vista da telefono 390×844, uscita larga 400 px, qualità 60: serve
//                solo a controllare il rapporto, non è per le finestre
//
// In ordine: apre la pagina con viewport 1280×1238 (stesso rapporto delle altre finestre), aspetta
// rete ferma + 2 s, chiude l'eventuale banner cookie scegliendo "rifiuta" (poi "solo necessari",
// "necessari", "chiudi" e, come ultima scelta, "accetta"), porta al centro il selettore, scatta il
// viewport, lo porta a 800×774 e lo salva in JPEG (mozjpeg) con la qualità più alta, tra 80, 74, 68
// e 62, che resta sotto i 50 KB. Se nemmeno 62 basta lo dice e salva comunque quella.
import { chromium } from 'playwright';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const radice = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- argomenti ----
const args = process.argv.slice(2);
const opzioni = Object.fromEntries(
  args.filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; })
);
const [url, nome, selettore] = args.filter(a => !a.startsWith('--'));
if (!url || !nome || !/^[\w.-]+$/.test(nome)) {
  console.error('Uso: node strumenti/scatto-finestra.mjs <url> <nome> [selettore] [--attesa=ms] [--mobile]');
  console.error('(nome: solo lettere, numeri, trattino, underscore e punto)');
  process.exit(1);
}
const attesaExtra = Number(opzioni.attesa) || 0;
const mobile = Boolean(opzioni.mobile);

// ---- misure ----
const VIEWPORT = mobile ? { width: 390, height: 844 } : { width: 1280, height: 1238 };
const SCALA = mobile ? 2 : 1;                // il telefono a doppia densità, poi ridotto: esce più nitido
const USCITA = { width: 800, height: 774 };  // la finestra del portfolio
const LIMITE = 50 * 1024;                    // 50 KB
const QUALITA = [80, 74, 68, 62];

// Come chiudere il banner cookie, dalla scelta migliore all'ultima. Le espressioni sono testo
// perché passano dentro la pagina.
const LIVELLI = [
  ['rifiuta',        'rifiut|\\bnega\\b|reject|decline|continua senza accett'],
  ['solo necessari', 'solo.{0,20}necessari|only.{0,20}(necessary|essential)'],
  ['necessari',      'necessari|necessary|essential'],
  ['chiudi',         'chiudi|close|dismiss|^\\s*[×✕✖]\\s*$'],
  ['accetta',        'accett|accept|acconsent|\\bagree\\b|\\bok\\b'],
];

// Cerca il bottone giusto dentro un banner (dialogo, riquadro fisso, id/classe "cookie"/"consenso"…),
// lo clicca e aspetta 800 ms. Restituisce true se ha chiuso qualcosa.
async function chiudiBanner(page) {
  const trovato = await page.evaluate((livelli) => {
    const visibile = (el) => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
    };
    const inBanner = (el) => {
      if (el.closest('nav, header')) return false;  // i menu non sono banner
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const pos = getComputedStyle(n).position;
        if (pos === 'fixed' || pos === 'sticky') return true;
        if (n.matches('[role=dialog], [role=alertdialog], [aria-modal=true]')) return true;
        if (/cookie|consen|gdpr|iubenda|onetrust|cookiebot|didomi|usercentrics/i.test((n.id || '') + ' ' + (n.getAttribute('class') || ''))) return true;
      }
      return false;
    };
    const candidati = [...document.querySelectorAll('button, a, [role=button], input[type=button], input[type=submit]')]
      .filter(el => visibile(el) && inBanner(el))
      .map(el => ({ el, testo: [el.innerText, el.value, el.getAttribute('aria-label'), el.title].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() }))
      .filter(c => c.testo && c.testo.length <= 60);
    for (const [livello, sorgente] of livelli) {
      const re = new RegExp(sorgente, 'i');
      const c = candidati.find(c => re.test(c.testo));
      if (c) { c.el.setAttribute('data-scatto-consenso', '1'); return { livello, testo: c.testo }; }
    }
    return null;
  }, LIVELLI);

  if (!trovato) { console.log('banner: nessuno trovato'); return false; }
  const bottone = page.locator('[data-scatto-consenso="1"]').first();
  try { await bottone.click({ timeout: 3000 }); }
  catch { await bottone.evaluate(el => el.click()); }
  console.log(`banner: cliccato «${trovato.testo}» (scelta: ${trovato.livello})`);
  await page.waitForTimeout(800);
  return true;
}

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALA,
    locale: 'it-IT',
    ...(mobile ? { isMobile: true, hasTouch: true } : {}),
  });
  const page = await ctx.newPage();
  const errori = [];
  page.on('pageerror', e => errori.push(e.message));

  let risposta = null;
  try { risposta = await page.goto(url, { waitUntil: 'networkidle' }); }
  catch (e) {
    if (e.name !== 'TimeoutError') throw e;
    console.log('attenzione: la rete non si è fermata entro 30 s, scatto lo stesso');
  }
  if (risposta && risposta.status() >= 400) console.log(`ATTENZIONE: la pagina risponde HTTP ${risposta.status()}`);
  // Il browser senza testa nasconde la barra di scorrimento ma lascia lo spazio riservato dai siti
  // con "scrollbar-gutter: stable": in foto resterebbe una striscia bianca a destra. La annullo.
  await page.evaluate(() => document.documentElement.style.setProperty('scrollbar-gutter', 'auto', 'important'));
  await page.waitForTimeout(2000);
  console.log('pagina:', await page.title());

  await chiudiBanner(page);

  if (selettore) {
    const el = page.locator(selettore).first();
    try { await el.waitFor({ state: 'attached', timeout: 5000 }); }
    catch { throw new Error(`selettore non trovato nella pagina: ${selettore}`); }
    await el.evaluate(e => e.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
    await page.waitForTimeout(1500);
    console.log(`selettore: ${selettore} portato al centro`);
  }
  if (attesaExtra) await page.waitForTimeout(attesaExtra);

  const png = await page.screenshot();   // solo il viewport, non la pagina intera
  if (errori.length) console.log('errori JS nella pagina:', errori);

  // ---- ridimensiona e salva ----
  let buf, qualita;
  if (mobile) {
    qualita = 60;
    buf = await sharp(png).resize({ width: 400 }).jpeg({ quality: qualita, mozjpeg: true }).toBuffer();
  } else {
    const base = sharp(png).resize(USCITA.width, USCITA.height, { fit: 'fill' });
    for (qualita of QUALITA) {
      buf = await base.clone().jpeg({ quality: qualita, mozjpeg: true }).toBuffer();
      if (buf.length < LIMITE) break;
    }
    if (buf.length >= LIMITE) console.log(`ATTENZIONE: anche a qualità ${qualita} pesa più di 50 KB`);
  }
  mkdirSync(join(radice, 'screenshot'), { recursive: true });
  const file = join(radice, 'screenshot', `${nome}.jpg`);
  writeFileSync(file, buf);
  const { width, height } = await sharp(buf).metadata();
  console.log(`${relative(radice, file)}: ${width}×${height}, ${buf.length} byte (${(buf.length / 1024).toFixed(1)} KB), qualità ${qualita}`);
} catch (e) {
  console.error(`ERRORE: ${String(e.message).split('\n')[0]}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
