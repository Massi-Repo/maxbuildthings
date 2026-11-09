// Anteprima di un prodotto per la sezione «Prodotti» del sito: 600×375, JPEG sotto i 30 KB.
//
// Uso:  node strumenti/scatto-prodotto.mjs <url> <nome>
//   → prodotti/<nome>.jpg (file vero accanto a index.html, caricato solo quando la sezione si avvicina)
//
// Apre la pagina a 1200×750, aspetta rete ferma + 1,5 s, scatta il viewport, lo porta a 600×375
// e lo salva con la qualità più alta (80, 72, 64) che resta sotto i 30 KB.
import { chromium } from 'playwright';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const radice = join(dirname(fileURLToPath(import.meta.url)), '..');
const [url, nome] = process.argv.slice(2);
if (!url || !nome || !/^[\w-]+$/.test(nome)) {
  console.error('Uso: node strumenti/scatto-prodotto.mjs <url> <nome>');
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 750 } });
await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(1500);
const png = await page.screenshot();
await browser.close();

let out, q;
for (q of [80, 72, 64]) {
  out = await sharp(png).resize(600, 375).jpeg({ quality: q, mozjpeg: true }).toBuffer();
  if (out.length < 30 * 1024) break;
}
mkdirSync(join(radice, 'prodotti'), { recursive: true });
writeFileSync(join(radice, 'prodotti', nome + '.jpg'), out);
console.log(`prodotti/${nome}.jpg  ${Math.round(out.length / 1024)} KB  (qualità ${q})`);
