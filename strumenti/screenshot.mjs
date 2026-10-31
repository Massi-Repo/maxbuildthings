// Screenshot desktop (1440x900) e telefono (390x844 @2x) di uno o piu' URL, con copia JPEG leggera.
// Salta la schermata di avvio e il dialogo (sessionStorage), cosi' si vede il desktop come dopo il primo giro.
// Uso:  node strumenti/screenshot.mjs [--nome=prima] [--locale=it-IT] url...
//   salva screenshot/<dominio>[-nome]-desktop.png|jpg e -mobile.png|jpg
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const arg = process.argv.slice(2);
const opz = k => (arg.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1];
const nome = opz('nome'), locale = opz('locale') || 'it-IT';
const urls = arg.filter(a => !a.startsWith('--'));
if (!urls.length) { console.log('Uso: node strumenti/screenshot.mjs [--nome=x] [--locale=it-IT] url...'); process.exit(1); }
mkdirSync('screenshot', { recursive: true });

const formati = { desktop: { viewport: { width: 1440, height: 900 } }, mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } };
const browser = await chromium.launch({ channel: 'msedge' });
try {
  for (const url of urls) {
    const dominio = new URL(url).host.replace(/[:]/g, '-');
    for (const [tipo, opzioni] of Object.entries(formati)) {
      const ctx = await browser.newContext({ ...opzioni, locale });
      await ctx.addInitScript(() => { try { sessionStorage.setItem('booted', '1'); sessionStorage.setItem('dlg', '1'); } catch (e) {} });
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(1500);
      const base = `screenshot/${dominio}${nome ? '-' + nome : ''}-${tipo}`;
      await page.screenshot({ path: base + '.png', fullPage: false });
      await sharp(base + '.png').resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 70 }).toFile(base + '.jpg');
      console.log(base + '.jpg');
      await ctx.close();
    }
  }
} finally { await browser.close(); }
