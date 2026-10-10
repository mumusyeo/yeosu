import { readdirSync,readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const base=new URL('../',import.meta.url);
for(const file of readdirSync(new URL('docs/',base)).filter(f=>f.endsWith('.js'))){
  const result=spawnSync(process.execPath,['--check',new URL(`docs/${file}`,base).pathname.replace(/^\/([A-Za-z]:)/,'$1')],{encoding:'utf8'});
  if(result.status!==0)throw new Error(`${file}: ${result.stderr}`);
}
const html=readFileSync(new URL('docs/index.html',base),'utf8');
assert(!html.includes('KakaoTalk_'));assert(!/service_role/.test(readFileSync(new URL('docs/config.js',base),'utf8').replace(/^\/\/.*$/gm,'')));
for(const match of html.matchAll(/(?:href|src)="(\.\/[^"#]+)"/g))assert(readFileSync(new URL(`docs/${match[1].slice(2)}`,base)).length>0);
const sourceFiles=readdirSync(new URL('docs/',base)).filter(f=>f.endsWith('.js'));
for(const file of sourceFiles)assert(!/KakaoTalk_/.test(readFileSync(new URL(`docs/${file}`,base),'utf8')),`${file} depends on original photos`);
const preview=readFileSync(new URL('preview.html',base),'utf8');
assert.equal(readFileSync(new URL('docs/demo.html',base),'utf8'),preview);
assert(!preview.includes('sb_publishable_'),'Standalone demo must use local storage');
assert(preview.includes('data:image/svg+xml;base64,'));assert(!preview.includes('type="module"'));assert(!preview.includes('src="./app.js"'));assert(!preview.includes('href="./styles.css"'));
console.log('JavaScript syntax, entrypoint assets and public configuration checks passed');
