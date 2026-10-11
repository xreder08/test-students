import { AppError } from './errors';
import { MAX_UPLOAD_BODY_BYTES } from './book-limits';
import {readBoundedBody} from './request-body';

// Check actual bytes too: Content-Length can be absent or untrusted.
export async function readBookForm(request: Request) {
  if (!request.body) throw new AppError('Выберите файл книги');
  const bytes=await readBoundedBody(request,MAX_UPLOAD_BODY_BYTES,'Книга превышает лимит 100 МБ.');
  if(!/^multipart\/form-data\s*;/i.test(request.headers.get('content-type')||''))throw new AppError('Для загрузки книги требуется multipart/form-data.',415);
  try {return await new Response(bytes as unknown as BodyInit, {
    headers: {'Content-Type': request.headers.get('content-type') || ''},
  }).formData();}catch{throw new AppError('Повреждённая форма загрузки книги.',400);}
}
