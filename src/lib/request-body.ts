import {AppError} from './errors';
export const MAX_JSON_BODY_BYTES=1024*1024;

export async function readBoundedBody(request:Request,limit:number,message='Запрос слишком большой') {
  if(!request.body)return new Uint8Array();
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try {
    while(true) {
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>limit){await reader.cancel();throw new AppError(message,413);}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  return Buffer.concat(chunks);
}
export async function readJson(request:Request):Promise<unknown> {
  if(!/^application\/(?:[\w.+-]+\+)?json(?:;|$)/i.test(request.headers.get('content-type')||''))throw new AppError('Запрос должен содержать JSON.',415);
  const bytes=await readBoundedBody(request,MAX_JSON_BODY_BYTES);
  try {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch {throw new AppError('Некорректный JSON. Проверьте данные запроса.',400);}
}
