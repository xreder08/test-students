import {mkdir,copyFile,readdir,access,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../',import.meta.url));
const target = root+'public/ocr/';
await mkdir(target,{recursive:true});
await copyFile(root+'node_modules/tesseract.js/dist/worker.min.js',target+'worker.min.js');
await copyFile(root+'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',target+'pdf.worker.min.mjs');
for(const name of await readdir(root+'node_modules/tesseract.js-core')) {
  if(name.endsWith('.wasm.js') || name.endsWith('.wasm')) await copyFile(root+'node_modules/tesseract.js-core/'+name,target+name);
}
// Only OCR language models are downloaded during installation, never user documents.
// Pin tessdata_fast to its 4.1.0 release instead of a moving branch.
const revision='4.1.0';
for(const language of ['rus','eng','kaz']) {
  const destination=target+language+'.traineddata.gz';
  try {await access(destination);continue;} catch {}
  const response=await fetch(`https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/${revision}/${language}.traineddata`);
  if(!response.ok) throw new Error(`Cannot install OCR language ${language}: ${response.status}`);
  await writeFile(destination,gzipSync(Buffer.from(await response.arrayBuffer())));
}
console.log('Local OCR assets ready: Russian, English, Kazakh.');
