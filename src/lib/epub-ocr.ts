'use client';
import {epubSections,readEpubArchive} from './epub';
import {MAX_BOOK_TEXT,MAX_BOOK_CHAPTERS} from './book-limits';
import type {PdfText} from './pdf-ocr';
import type {Worker} from 'tesseract.js';

export async function recognizeEpub(file:File,languages:string[],force:boolean,onProgress:(message:string)=>void,signal:AbortSignal):Promise<PdfText> {
  const check=()=>{if(signal.aborted)throw new Error('Распознавание отменено.');};
  check();onProgress('Открываем EPUB и проверяем порядок страниц…');
  const files=readEpubArchive(new Uint8Array(await file.arrayBuffer()));
  const texts=new Map([...files].filter(([path])=>/\.(?:xhtml|html|htm|opf|xml)$/i.test(path)).map(([path,bytes])=>[path,new TextDecoder().decode(bytes)]));
  const pages=epubSections(texts);
  if(pages.length>MAX_BOOK_CHAPTERS)throw new Error('В EPUB больше 2000 разделов. Разделите его на тома.');
  let worker:Worker|undefined,ocrPages=0,unreadablePages=0,totalCharacters=0,current=0;
  const output:string[]=[];
  try {
    for(const page of pages) {
      check();current++;onProgress(`Читаем страницу EPUB ${current} из ${pages.length}…`);
      let text=page.text;
      if(page.images.length&&(force||(text.match(/\p{L}/gu)||[]).length<100)) {
        if(!worker) {
          const {createWorker,OEM}=await import('tesseract.js');
          worker=await createWorker(languages,OEM.LSTM_ONLY,{workerPath:'/ocr/worker.min.js',corePath:'/ocr',langPath:'/ocr',workerBlobURL:false,
            logger:message=>{if(message.status==='recognizing text')onProgress(`Распознаём EPUB: страница ${current} из ${pages.length}, ${Math.round(message.progress*100)}%`);},
          });
        }
        for(const path of page.images) {
          check();const image=files.get(path);
          if(!image)throw new Error(`В EPUB не найдено изображение страницы ${current}.`);
          const bitmap=await createImageBitmap(new Blob([image as unknown as BlobPart]));
          const canvas=document.createElement('canvas');
          try {
            if(bitmap.width*bitmap.height>25_000_000)throw new Error('Изображение в EPUB слишком большое.');
            const scale=Math.min(2,2000/Math.max(bitmap.width,bitmap.height));
            canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
            const context=canvas.getContext('2d')!;context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
            const result=await worker.recognize(canvas);check();text+='\n\n'+result.data.text.trim();
          } finally {bitmap.close();canvas.width=canvas.height=0;}
        }
        ocrPages++;
      }
      if((text.match(/\p{L}/gu)||[]).length<10) {
        unreadablePages++;text='[На этой странице не найден читаемый текст. Она может содержать обложку, рисунок или пустую страницу. Смотрите оригинал книги.]';
      }
      const section=`# ${page.title}\n\n${text.trim()}`;totalCharacters+=section.length;
      if(totalCharacters>MAX_BOOK_TEXT)throw new Error('В книге больше 10 миллионов символов текста. Разделите её на тома.');
      output.push(section);
      // Yield between pages so cancel and progress stay responsive.
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    check();
    if(unreadablePages===pages.length)throw new Error('В EPUB не удалось распознать текст. Проверьте язык и качество страниц.');
    return {text:output.join('\n\n'),pages:pages.length,ocrPages,unreadablePages};
  } finally {await worker?.terminate();}
}
