// Server locale che si comporta come Vercel: stesse intestazioni di vercel.json e 404.html per i file che non esistono.
// Uso: node strumenti/serve.mjs [porta]   (dalla cartella del progetto; porta predefinita 5182)
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve, sep } from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

const compressi = new Map();   // file già compressi, per non rifarlo a ogni richiesta
// come Vercel: quello che è in .vercelignore non viene pubblicato
const ignorati = existsSync('.vercelignore') ? readFileSync('.vercelignore', 'utf8').split(/\r?\n/).map(r => r.trim()).filter(r => r && !r.startsWith('#')) : [];

const porta = Number(process.argv[2] || 5182);
const radice = resolve('.');
const regole = JSON.parse(readFileSync('vercel.json', 'utf8')).headers
  .map(r => ({ re: new RegExp('^' + r.source + '$'), headers: r.headers }));
const tipi = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
};

createServer((req, res) => {
  const percorso = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const r of regole) if (r.re.test(percorso)) for (const h of r.headers) res.setHeader(h.key, h.value);
  let file = join(radice, percorso === '/' ? 'index.html' : percorso);
  const escluso = ignorati.some(i => i.endsWith('/') ? percorso.startsWith('/' + i) : percorso === '/' + i);
  if (escluso || !file.startsWith(radice + sep) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': tipi['.html'] });
    return res.end(readFileSync(join(radice, '404.html')));
  }
  const tipo = tipi[extname(file)] || 'application/octet-stream';
  let corpo = readFileSync(file);
  // come Vercel: testo compresso con brotli o gzip (senza, le misure di Lighthouse sono falsate)
  const accetta = req.headers['accept-encoding'] || '';
  const comprimibile = /text|javascript|json|xml|svg|manifest/.test(tipo);
  const intestazioni = { 'Content-Type': tipo, Vary: 'Accept-Encoding' };
  const chiave = `${file}|${statSync(file).mtimeMs}`;
  if (comprimibile && accetta.includes('br')) { corpo = compressi.get('br' + chiave) ?? compressi.set('br' + chiave, brotliCompressSync(corpo, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } })).get('br' + chiave); intestazioni['Content-Encoding'] = 'br'; }
  else if (comprimibile && accetta.includes('gzip')) { corpo = compressi.get('gz' + chiave) ?? compressi.set('gz' + chiave, gzipSync(corpo)).get('gz' + chiave); intestazioni['Content-Encoding'] = 'gzip'; }
  res.writeHead(200, intestazioni);
  res.end(corpo);
}).listen(porta, () => console.log(`http://localhost:${porta}/`));
