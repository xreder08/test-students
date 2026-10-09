import { AppError } from './errors';
import { MAX_UPLOAD_BODY_BYTES } from './book-limits';

// Check actual bytes too: Content-Length can be absent or untrusted.
export async function readBookForm(request: Request) {
  if (!request.body) throw new AppError('Выберите файл книги');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_UPLOAD_BODY_BYTES) {
        await reader.cancel();
        throw new AppError('Книга превышает лимит 100 МБ.', 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new Response(Buffer.concat(chunks) as unknown as BodyInit, {
    headers: {'Content-Type': request.headers.get('content-type') || ''},
  }).formData();
}
