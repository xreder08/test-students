'use client';
import {MAX_BOOK_TEXT} from './book-limits';
import type {Worker} from 'tesseract.js';

export type PdfText = {text:string;pages:number;ocrPages:number;unreadablePages:number};
export async function recognizePdf(file:File, languages:string[], force:boolean, onProgress:(message:string)=>void, signal:AbortSignal):Promise<PdfText> {
  const pdfjs=await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc='/ocr/pdf.worker.min.mjs';
  const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())});
  let worker:Worker|undefined;
  let currentPage=0,totalPages=0;
  // Let the active recognition finish before terminating its worker; termination
  // mid-recognize would leave Tesseract's pending promise unresolved.
  const cancel=()=>{void task.destroy();};
  signal.addEventListener('abort',cancel,{once:true});
  const check=()=>{if(signal.aborted)throw new Error('Распознавание отменено.');};
  try {
    check();
    const pdf=await task.promise;
    totalPages=pdf.numPages;
    if(totalPages>2000)throw new Error('В PDF больше 2000 страниц. Разделите его на тома.');
    const sections:string[]=[];
    let characters=0,ocrPages=0,unreadablePages=0;
    for(currentPage=1;currentPage<=totalPages;currentPage++) {
      check();
      onProgress(`Читаем страницу ${currentPage} из ${totalPages}…`);
      const page=await pdf.getPage(currentPage);
      try {
        const layer=await page.getTextContent();
        let text=layer.items.map(item=>'str' in item ? item.str+('hasEOL' in item && item.hasEOL?'\n':' ') : '').join('').trim();
        // A watermark or page number alone is not a usable text layer.
        if(force || (text.match(/\p{L}/gu)||[]).length<100 || text.includes('\uFFFD')) {
          onProgress(`Распознаём скан: страница ${currentPage} из ${totalPages}…`);
          if(!worker) {
            const {createWorker,OEM}=await import('tesseract.js');
            worker=await createWorker(languages,OEM.LSTM_ONLY,{
              workerPath:'/ocr/worker.min.js',corePath:'/ocr',langPath:'/ocr',workerBlobURL:false,
              logger:message=>{
                if(message.status==='recognizing text')onProgress(`Распознаём страницу ${currentPage} из ${totalPages}: ${Math.round(message.progress*100)}%`);
              },
            });
            check();
          }
          const base=page.getViewport({scale:1});
          const scale=Math.min(3,2000/Math.max(base.width,base.height));
          const viewport=page.getViewport({scale});
          const canvas=document.createElement('canvas');
          canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
          try {
            await page.render({canvas,viewport}).promise;
            check();
            const result=await worker.recognize(canvas);
            text=result.data.text.trim();ocrPages++;
          } finally {canvas.width=canvas.height=0;}
        }
        check();
        if((text.match(/\p{L}/gu)||[]).length<10) {
          unreadablePages++;
          text='[На этой странице не найден читаемый текст. Она может содержать обложку, рисунок или пустую страницу. Смотрите оригинальный PDF.]';
        }
        const section=`# Страница ${currentPage}\n\n${text}`;
        characters+=section.length;
        if(characters>MAX_BOOK_TEXT)throw new Error('В книге больше 10 миллионов символов текста. Разделите её на тома.');
        sections.push(section);
      } finally {page.cleanup();}
    }
    if(unreadablePages===totalPages)throw new Error('На страницах не удалось распознать текст. Попробуйте более чёткий скан или другой язык.');
    return {text:sections.join('\n\n'),pages:totalPages,ocrPages,unreadablePages};
  } catch(error) {
    check();
    throw error;
  } finally {
    signal.removeEventListener('abort',cancel);
    await worker?.terminate();
    await task.destroy();
  }
}
