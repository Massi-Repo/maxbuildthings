// Registra i video da postare (senza audio: la musica si aggiunge dall'app del social). Escono in promo/.
// Uso: node strumenti/video.mjs [url]   (predefinito il sito online)
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const url = process.argv[2] || 'https://maxbuildthings.vercel.app/?lang=it';
const browser = await chromium.launch();
const aspetta = ms => new Promise(r => setTimeout(r, ms));

async function registra(nome, viewport, mobile) {
  const dir = mkdtempSync(join(tmpdir(), 'video-'));
  const ctx = await browser.newContext({ viewport, recordVideo: { dir, size: viewport }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => sessionStorage.setItem('dlg', '1'));
  const t0 = Date.now();
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const taglio = (Date.now() - t0) / 1000 + 0.3;          // i primi secondi sono bianchi: pagina non ancora disegnata
  await page.waitForFunction(() => { const b = document.getElementById('boot'); return !b || b.hidden || getComputedStyle(b).display === 'none' || getComputedStyle(b).opacity === '0'; }, null, { timeout: 15000 }).catch(() => {}); // boot BIOS
  await page.locator('#amp').click({ timeout: 5000 }); // il player: i visual si muovono
  await aspetta(3500);                                   // hero con la scena 3D
  for (let i = 0; i < 14; i++) { await page.mouse.wheel(0, mobile ? 170 : 130); await aspetta(420); } // la griglia
  await aspetta(1000);
  if (!mobile) {                                         // una finestra trascinata, che è il bello del desktop finto
    // solo una finestra davvero in vista, lontana dal player: altrimenti il trascinamento seleziona il testo
    const b = await page.evaluate(() => { const r = [...document.querySelectorAll('#grid .win .bar')].map(e => e.getBoundingClientRect()).find(q => q.top > 40 && q.top < innerHeight - 300 && q.left < 500 && q.width > 100); return r && { x: r.x, y: r.y }; });
    if (b) { await page.mouse.move(b.x + 60, b.y + 8); await page.mouse.down(); await page.mouse.move(b.x + 320, b.y + 70, { steps: 25 }); await page.mouse.up(); }
    await aspetta(1500);
  }
  const video = page.video(); await ctx.close(); const sorgente = await video.path();
  // il browser registra al rallentatore: si riporta tutto a circa 20 secondi
  const durata = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', sorgente]));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(taglio), '-i', sorgente, '-an', '-vf', `setpts=${(20 / (durata - taglio)).toFixed(3)}*PTS`, '-c:v', 'libx264', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `promo/${nome}.mp4`]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `promo/${nome}.mp4`, '-vf', `fps=1/2,scale=${mobile ? 180 : 320}:-1,tile=4x3`, '-frames:v', '1', `/tmp/${nome}-foglio.jpg`]);
}
await registra('video-orizzontale', { width: 1280, height: 720 }, false);
await registra('video-verticale', { width: 720, height: 1280 }, true);
await browser.close();
console.log(readdirSync('promo').join(', '));
