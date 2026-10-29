// Genera le icone del sito da favicon.svg: favicon.ico (browser vecchi e crawler), icona per iPhone e icone del manifest.
// Uso: node strumenti/icone.mjs   (dalla cartella del progetto)
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync('favicon.svg');
const png = size => sharp(svg, { density: 72 * size / 64 }).resize(size, size).png().toBuffer();

writeFileSync('apple-touch-icon.png', await png(180));
writeFileSync('icon-192.png', await png(192));
writeFileSync('icon-512.png', await png(512));

// favicon.ico con dentro un PNG 48×48 (formato ICO "moderno", letto da tutti i browser)
const p48 = await png(48);
const testa = Buffer.alloc(22);
testa.writeUInt16LE(0, 0); testa.writeUInt16LE(1, 2); testa.writeUInt16LE(1, 4);   // ICO, 1 immagine
testa.writeUInt8(48, 6); testa.writeUInt8(48, 7);                                    // 48×48
testa.writeUInt16LE(1, 10); testa.writeUInt16LE(32, 12);                              // piani, bit per pixel
testa.writeUInt32LE(p48.length, 14); testa.writeUInt32LE(22, 18);                     // dimensione e posizione del PNG
writeFileSync('favicon.ico', Buffer.concat([testa, p48]));

console.log('fatto: favicon.ico, apple-touch-icon.png, icon-192.png, icon-512.png');
