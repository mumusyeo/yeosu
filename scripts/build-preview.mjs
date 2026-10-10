import { build } from 'esbuild';
import { readFileSync,writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root=new URL('../',import.meta.url),read=path=>readFileSync(new URL(path,root),'utf8');
const result=await build({entryPoints:[fileURLToPath(new URL('docs/app.js',root))],bundle:true,format:'iife',target:['es2020'],write:false,minify:false});
const svg=`data:image/svg+xml;base64,${Buffer.from(read('docs/assets/landscape.svg')).toString('base64')}`;
// This artifact is deliberately a local demo, regardless of hosted config.
const config="window.TRIP_CONFIG={supabaseUrl:'',supabaseKey:'',tripId:'a0000000-0000-4000-8000-000000000001'};";
let html=read('docs/index.html').replace(/\s*<script data-preview-redirect>.*?<\/script>/,'')
  .replace(/<link rel="stylesheet" href="\.\/styles.css">/,()=>`<style>${read('docs/styles.css')}</style>`)
  .replace(/<script src="\.\/config.js"><\/script>/,()=>`<script>${config}</script>`)
  .replace(/<script type="module" src="\.\/app.js"[^>]*><\/script>/,()=>`<script defer>document.addEventListener('DOMContentLoaded',()=>{${result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')}\n});</script>`)
  .replaceAll('./assets/landscape.svg',svg);
writeFileSync(new URL('preview.html',root),html);
writeFileSync(new URL('docs/demo.html',root),html);
console.log('Built preview.html and docs/demo.html: standalone local demo.');
