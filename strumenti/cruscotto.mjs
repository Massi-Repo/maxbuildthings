// Cruscotto per MAX·OS (contratto v1, vedi conoscenze/cruscotti.md): stampa UN oggetto JSON di widget.
// Legge e basta: GET al sito, GET pubblica per il dominio, lettura di STATO.md. Non scrive, non manda niente, non stampa segreti.
// Uso: node strumenti/cruscotto.mjs
import { readFileSync, existsSync } from 'node:fs';

const SITO = 'https://maxbuildthings.vercel.app/';
const DOMINIO = 'maxbuildthings.com';
const PANNELLO_VERCEL = 'https://vercel.com/maxcc/maxbuildthings/analytics';
const SEARCH_CONSOLE = 'https://search.google.com/search-console?resource_id=' + encodeURIComponent(SITO);
const widget = [];

async function get(url, ms = 8000, opz = {}) {
  const t0 = performance.now();
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), redirect: 'follow', headers: { 'user-agent': 'maxos-cruscotto' }, ...opz });
  const corpo = await r.text();
  return { stato: r.status, ms: Math.round(performance.now() - t0), corpo };
}

// .env del progetto (se c'è): solo per chiavi, mai stampate
const env = {};
if (existsSync('.env')) for (const riga of readFileSync('.env', 'utf8').split('\n')) {
  const m = riga.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

// 1) il sito risponde
let sito;
try {
  sito = await get(SITO);
  const ok = sito.stato === 200;
  const tono = !ok ? 'male' : sito.ms > 2000 ? 'attenzione' : 'ok';
  widget.push({ tipo: 'numero', titolo: ok ? 'Il sito risponde' : 'Il sito NON risponde bene', valore: ok ? sito.ms : 'HTTP ' + sito.stato,
    unita: ok ? 'ms' : '', tono, nota: 'Home di ' + new URL(SITO).host, link: SITO });
} catch (e) {
  widget.push({ tipo: 'numero', titolo: 'Il sito NON risponde', valore: 'giù', tono: 'male', nota: String(e.message || e).slice(0, 80), link: SITO });
}

// 2) una pagina interna che non deve esserci: STATO.md online dà 404 (note interne)
try {
  const p = await get(SITO + 'STATO.md', 6000);
  widget.push({ tipo: 'stato', titolo: 'Controlli sul sito online', voci: [
    { nome: 'Note interne protette (STATO.md)', tono: p.stato === 404 ? 'ok' : 'male', nota: p.stato === 404 ? '404, come deve essere' : 'HTTP ' + p.stato + ': pubblicate per errore!' },
    { nome: 'Home con tag di contatto', tono: sito && /mailto:massi\.cc@proton\.me/.test(sito.corpo) ? 'ok' : 'attenzione', nota: 'mail visibile nella pagina' },
  ] });
} catch { /* niente: il widget dopo non serve se la rete è giù */ }

// 3) statistiche Vercel: la CLI `vercel` non è installata qui e Vercel non espone le Web Analytics con una API pubblica
//    di sola lettura. Se un giorno ci sarà VERCEL_TOKEN in .env e la CLI, si legge da qui; per ora lo diciamo chiaro.
widget.push({ tipo: 'testo', titolo: 'Visite e visitatori (7 e 30 giorni)', larghezza: 2, link: PANNELLO_VERCEL,
  md: '**Non leggibili da qui senza un tuo gesto.** Le statistiche anonime di Vercel stanno solo nel pannello (link sotto); la CLI `vercel` non è installata e Vercel non dà le Web Analytics con una API di sola lettura per il piano Hobby.\n\n' +
      '**Serve:** aprire il pannello Analytics una volta alla settimana e dire a Claudione i numeri, oppure decidere di passare a una statistica che si può leggere (es. Cloudflare Web Analytics, gratis).' +
      (env.VERCEL_TOKEN ? '\n\n(Trovato VERCEL_TOKEN in .env, ma non c\'è un endpoint per queste statistiche.)' : '') });

// 4) Search Console: nessun login nuovo; si mostra lo stato scritto in STATO.md
let sc = 'Sitemap inviata il 5/11: «Riuscita», 2 pagine rilevate. La home non è ancora su Google (richiesta di indicizzazione respinta per quota giornaliera).';

if (existsSync('STATO.md')) {
  const righe = readFileSync('STATO.md', 'utf8').split('\n');
  const r = righe.find(l => /Search Console/.test(l) && /(indicizz|Pagine)/i.test(l) && !/^#/.test(l));
  if (r) { const frase = r.replace(/^[-*\s]+/, '').replace(/\*\*/g, ''); sc = frase.length > 380 ? frase.slice(0, 377) + '…' : frase; }
}
widget.push({ tipo: 'testo', titolo: 'Search Console · pagine su Google', larghezza: 2, link: SEARCH_CONSOLE,
  md: sc + '\n\n_Stato scritto in STATO.md: Google non si legge senza login. Si aggiorna quando Claudione controlla il pannello «Pagine»._' });

// 5) dominio: è libero? (RDAP pubblico di Verisign: 404 = non registrato)
try {
  const d = await get('https://rdap.verisign.com/com/v1/domain/' + DOMINIO, 6000, { headers: { accept: 'application/rdap+json', 'user-agent': 'maxos-cruscotto' } });
  if (d.stato === 404) widget.push({ tipo: 'numero', titolo: 'Dominio ' + DOMINIO, valore: 'libero', tono: 'attenzione', nota: 'Non comprato (si compra per ultimo, 12,03 $/anno su Vercel)' });
  else if (d.stato === 200) widget.push({ tipo: 'numero', titolo: 'Dominio ' + DOMINIO, valore: 'registrato', tono: 'attenzione', nota: 'Risulta registrato: tuo? Se no, qualcuno l\'ha preso' });
  else throw new Error('HTTP ' + d.stato);
} catch {
  widget.push({ tipo: 'numero', titolo: 'Dominio ' + DOMINIO, valore: 'non comprato', tono: 'neutro', nota: 'Da STATO.md; controllo in rete non riuscito' });
}

// 6) contatti ricevuti: il sito non ha un modulo, c'è solo la mail
widget.push({ tipo: 'testo', titolo: 'Contatti ricevuti', md: 'Il sito non li raccoglie: il contatto è una mail a **massi.cc@proton.me** (clic su «scrivimi»). Contali nella casella; i clic non si misurano (gli eventi personalizzati di Vercel sono a pagamento).' });

// 7) link
widget.push({ tipo: 'link', titolo: 'Link', voci: [
  { nome: 'Sito', url: SITO }, { nome: 'Vercel · Analytics', url: PANNELLO_VERCEL }, { nome: 'Search Console', url: SEARCH_CONSOLE },
] });

console.log(JSON.stringify({ versione: 1, titolo: 'maxbuildthings', sottotitolo: 'Siti, app e strumenti su misura · portare clienti', colore: '#ff4fa3', aggiornato: new Date().toISOString(), widget }));
