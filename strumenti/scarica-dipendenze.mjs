// Scarica in locale i font e Three.js che prima arrivavano da Google Fonts e dai CDN.
// Così il sito non manda l'IP dei visitatori a terzi (GDPR) e carica da un solo dominio.
// Uso: node strumenti/scarica-dipendenze.mjs   (dalla cartella del progetto; rilancialo solo per aggiornare)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const THREE = 'https://cdn.jsdelivr.net/npm/three@0.128.0';
const file = {
  // Font: solo i sottoinsiemi latin e latin-ext (licenza SIL OFL)
  'fonts/playfair-display-800i-latin.woff2': 'https://fonts.gstatic.com/s/playfairdisplay/v40/nuFRD-vYSZviVYUb_rj3ij__anPXDTnCjmHKM4nYO7KN_iiUXtHA-Q.woff2',
  'fonts/playfair-display-800i-latin-ext.woff2': 'https://fonts.gstatic.com/s/playfairdisplay/v40/nuFRD-vYSZviVYUb_rj3ij__anPXDTnCjmHKM4nYO7KN_iiUXt_A-W2r.woff2',
  'fonts/vt323-latin.woff2': 'https://fonts.gstatic.com/s/vt323/v18/pxiKyp0ihIEF2isfFJU.woff2',
  'fonts/vt323-latin-ext.woff2': 'https://fonts.gstatic.com/s/vt323/v18/pxiKyp0ihIEF2isRFJXGdg.woff2',
  // Three.js r128 (licenza MIT)
  'vendor/three/three.min.js': `${THREE}/build/three.min.js`,
  'vendor/three/CopyShader.js': `${THREE}/examples/js/shaders/CopyShader.js`,
  'vendor/three/LuminosityHighPassShader.js': `${THREE}/examples/js/shaders/LuminosityHighPassShader.js`,
  'vendor/three/EffectComposer.js': `${THREE}/examples/js/postprocessing/EffectComposer.js`,
  'vendor/three/ShaderPass.js': `${THREE}/examples/js/postprocessing/ShaderPass.js`,
  'vendor/three/RenderPass.js': `${THREE}/examples/js/postprocessing/RenderPass.js`,
  'vendor/three/UnrealBloomPass.js': `${THREE}/examples/js/postprocessing/UnrealBloomPass.js`,
  'vendor/three/LICENSE': `${THREE}/LICENSE`,
};

for (const [dest, url] of Object.entries(file)) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  console.log(dest.padEnd(46), (buf.length / 1024).toFixed(1), 'KB');
}
