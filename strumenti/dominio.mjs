// Cambia il dominio del sito in tutti i file (canonical, anteprima, sitemap, README).
// Uso: node strumenti/dominio.mjs maxbuildthings.com
import { readFileSync, writeFileSync } from 'node:fs';
const nuovo = process.argv[2];
if (!nuovo) throw new Error('manca il dominio');
const vecchi = /https:\/\/maxbuildthings\.(com|vercel\.app)/g;
for (const f of ['index.html', 'sitemap.xml', 'robots.txt', 'README.md', 'profilo-github/README.md']) {
  const s = readFileSync(f, 'utf8');
  writeFileSync(f, s.replace(vecchi, `https://${nuovo}`).replace(/\[maxbuildthings\.(com|vercel\.app)\]/g, `[${nuovo}]`));
}
console.log('dominio:', nuovo);
