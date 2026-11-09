// Genera og.jpg (anteprima 1200×630 per WhatsApp, LinkedIn, Telegram) e due screenshot di controllo.
// Uso: node strumenti/og.mjs   (dalla cartella del progetto)
import { chromium } from 'playwright';
import sharp from 'sharp';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

// ?gl=forza: la scena 3D parte anche senza scheda grafica (Chromium senza schermo); in italiano, come la vede chi riceve il link
const url = pathToFileURL(resolve('index.html')).href + '?gl=forza';
mkdirSync('screenshot', { recursive: true });
const browser = await chromium.launch();

async function scatta(viewport, file, scale = 1) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, locale: 'it-IT' });
  await ctx.addInitScript(() => { sessionStorage.setItem('booted', '1'); });
  const page = await ctx.newPage();
  const errori = [];
  page.on('pageerror', e => errori.push(e.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  const png = await page.screenshot();
  await ctx.close();
  if (errori.length) console.log(file, 'errori JS:', errori);
  return png;
}

const og = await scatta({ width: 1200, height: 630 }, 'og');
await sharp(og).jpeg({ quality: 82, mozjpeg: true }).toFile('og.jpg');

const mob = await scatta({ width: 390, height: 844 }, 'mobile', 2);
await sharp(mob).resize({ width: 600 }).jpeg({ quality: 70 }).toFile('screenshot/mobile.jpg');
const desk = await scatta({ width: 1440, height: 900 }, 'desktop');
await sharp(desk).resize({ width: 1200 }).jpeg({ quality: 70 }).toFile('screenshot/desktop.jpg');

await browser.close();
console.log('fatto: og.jpg, screenshot/mobile.jpg, screenshot/desktop.jpg');
