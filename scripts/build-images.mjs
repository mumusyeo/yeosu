import { copyFileSync,existsSync } from 'node:fs';
for(const file of ['main_img.jpg','main_img2.jpg']){
  const source=new URL('../'+file,import.meta.url),asset=new URL('../docs/assets/'+file,import.meta.url);
  if(existsSync(source))copyFileSync(source,asset);
  else if(!existsSync(asset))throw new Error('Missing slideshow photograph: '+file);
}
console.log('Copied both slideshow photographs to public assets.');
