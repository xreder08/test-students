import {Unzip,UnzipInflate} from 'fflate';
import {MAX_ARCHIVE_TEXT_BYTES,MAX_BOOK_BYTES} from './book-limits';

export function xmlText(text:string) {
  return text.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi,entity=>{
    const named:Record<string,string>={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '};
    if(named[entity])return named[entity];
    const code=entity.toLowerCase().startsWith('&#x')?parseInt(entity.slice(3,-1),16):parseInt(entity.slice(2,-1),10);
    return Number.isFinite(code)&&code>=0&&code<=0x10ffff?String.fromCodePoint(code):entity;
  });
}
function attributes(markup:string) {
  const result:Record<string,string>={};
  for(const match of markup.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs))result[match[1].toLowerCase()]=xmlText(match[3]);
  return result;
}
export function resolveEpubPath(base:string,reference:string):string|undefined {
  if(/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference)||reference.includes('\\'))return;
  try {return decodeURIComponent(new URL(reference,'https://epub.invalid/'+base).pathname.slice(1));}catch{return;}
}
export function epubMarkupText(markup:string) {
  return xmlText(markup.replace(/<(?:\w+:)?(head|script|style)\b[^>]*>[\s\S]*?<\/(?:\w+:)?\1\s*>/gi,'')
    .replace(/<\/(?:\w+:)?(?:p|div|h[1-6]|li|tr)>/gi,'\n\n').replace(/<(?:\w+:)?br\b[^>]*\/?>/gi,'\n').replace(/<[^>]+>/g,''))
    .replace(/[ \t]+/g,' ').trim();
}
export type EpubSection={path:string;title:string;text:string;images:string[]};
export function epubSections(files:Map<string,string>):EpubSection[] {
  const container=files.get('META-INF/container.xml');
  const root=container?.match(/<(?:\w+:)?rootfile\b([^>]+)>/i);
  const selected=root?attributes(root[1])['full-path']:undefined;
  const opfPath=selected&&files.has(selected)?selected:[...files.keys()].find(name=>/\.opf$/i.test(name));
  if(!opfPath)throw new Error('В EPUB не найден файл описания книги.');
  const opf=files.get(opfPath)!;
  const manifest=new Map<string,string>();
  for(const match of opf.matchAll(/<(?:\w+:)?item\b([^>]+)>/gi)) {
    const item=attributes(match[1]);
    if(item.id&&item.href){const path=resolveEpubPath(opfPath,item.href);if(path)manifest.set(item.id,path);}
  }
  const sections:EpubSection[]=[];
  for(const match of opf.matchAll(/<(?:\w+:)?itemref\b([^>]+)>/gi)) {
    const item=attributes(match[1]);if(item.linear==='no')continue;
    const path=manifest.get(item.idref);if(!path)throw new Error('В EPUB повреждён порядок страниц.');
    const html=files.get(path);if(html===undefined)throw new Error('В EPUB отсутствует страница из оглавления.');
    const title=html.match(/<(?:\w+:)?h[1-3]\b[^>]*>([\s\S]*?)<\/(?:\w+:)?h[1-3]>/i)?.[1];
    const images:string[]=[];
    for(const image of html.matchAll(/<(?:\w+:)?(?:img|image)\b([^>]+)>/gi)) {
      const attr=attributes(image[1]);const reference=attr.src||attr['xlink:href']||attr.href;
      const resolved=reference?resolveEpubPath(path,reference):undefined;
      if(resolved&&!images.includes(resolved))images.push(resolved);
    }
    sections.push({path,title:title?epubMarkupText(title):`Страница ${sections.length+1}`,text:epubMarkupText(html),images});
  }
  if(!sections.length)throw new Error('В EPUB не найдено страниц для чтения.');
  return sections;
}

// Inflate only local text and raster images, with bounds checked while streaming.
export function readEpubArchive(buffer:Uint8Array) {
  const files=new Map<string,Uint8Array>();let total=0,textBytes=0,entries=0;
  let failure:Error|undefined;
  const unzip=new Unzip(file=>{
    if(++entries>3000)throw new Error('Слишком много файлов внутри EPUB.');
    const text=/\.(?:xhtml|html|htm|opf|xml)$/i.test(file.name);
    if(!text&&!/\.(?:png|jpe?g|webp|gif)$/i.test(file.name))return;
    const chunks:Uint8Array[]=[];let size=0;
    file.ondata=(error,data,final)=>{
      if(error)throw failure||new Error('Повреждённый архив EPUB.');
      total+=data.length;size+=data.length;if(text)textBytes+=data.length;
      if(total>MAX_BOOK_BYTES*2||textBytes>MAX_ARCHIVE_TEXT_BYTES||(!text&&size>25*1024*1024)) {
        failure=new Error('Распакованный EPUB превышает безопасный объём.');file.terminate();throw failure;
      }
      chunks.push(data);
      if(final){const output=new Uint8Array(size);let offset=0;for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.length;}files.set(file.name,output);}
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {for(let offset=0;offset<buffer.length;offset+=16384)unzip.push(buffer.subarray(offset,offset+16384),offset+16384>=buffer.length);}
  catch(error){throw failure||error;}
  return files;
}
