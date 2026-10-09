import { AppError } from './errors';
import { database, initDb, newId, query } from './db';
import type { Book, Chapter, User } from './types';
import { Unzip, UnzipInflate } from 'fflate';
import { MAX_BOOK_BYTES, MAX_BOOK_MB, MAX_BOOK_TEXT, MAX_BOOK_CHAPTERS, MAX_ARCHIVE_TEXT_BYTES } from './book-limits';

export function decodeEntities(text: string) {
  return text.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi, entity => {
    const standard: Record<string,string> = {'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '};
    if (standard[entity]) return standard[entity];
    const code = entity.startsWith('&#x') ? parseInt(entity.slice(3,-1),16) : parseInt(entity.slice(2,-1),10);
    return Number.isFinite(code) && code>=0 && code<=0x10ffff ? String.fromCodePoint(code) : entity;
  });
}
// Stream inflation, bound output before concatenation, never fetch external relationships.
export function extractArchive(buffer: Uint8Array, accept: (name: string) => boolean) {
  const files = new Map<string,string>();
  let total = 0, entries = 0;
  const unzip = new Unzip(file => {
    if (++entries > 3000) throw new AppError('Слишком много файлов внутри книги.');
    if (!accept(file.name)) return;
    const chunks: Uint8Array[] = [];
    file.ondata = (error,data,final) => {
      if (error) throw new AppError('Повреждённый архив книги.');
      total += data.length;
      if (total > MAX_ARCHIVE_TEXT_BYTES) {file.terminate();throw new AppError('Объём распакованного текста книги превышает 64 МБ.');}
      chunks.push(data);
      if (final) files.set(file.name,Buffer.concat(chunks).toString('utf8'));
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let i=0;i<buffer.length;i+=16384) unzip.push(buffer.subarray(i,i+16384),i+16384>=buffer.length);
  return files;
}
function markupText(markup: string) {
  return decodeEntities(markup.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<\/(?:w:p|p|div|h[1-6])>/gi,'\n\n').replace(/<(?:br|w:br)\b[^>]*\/?>/gi,'\n').replace(/<[^>]+>/g,'')).trim();
}

export function splitChapters(text: string): {title: string; content: string}[] {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\0/g, '').trim();
  if (normalized.length < 150) throw new AppError('В книге слишком мало текста. Для скана PDF нужен файл с распознанным текстом.');
  if (normalized.length > MAX_BOOK_TEXT) throw new AppError('В книге больше 10 миллионов символов текста. Разделите её на тома.');
  const lines = normalized.split('\n');
  const chunks: {title: string; content: string}[] = [];
  let title = 'Введение', buffer: string[] = [];
  const flush = () => {
    const body = buffer.join('\n').trim();
    if (body.length < 30) return;
    if (body.length <= 12000) { chunks.push({title, content: body}); return; }
    let remaining = body, part = 1;
    while (remaining.length) {
      let end = remaining.length <= 12000 ? remaining.length : remaining.lastIndexOf('\n',12000);
      if (end < 4000) end = Math.min(12000, remaining.length);
      chunks.push({title: `${title} · часть ${part++}`, content: remaining.slice(0,end).trim()});
      remaining = remaining.slice(end).trim();
    }
  };
  for (const line of lines) {
    if (/^(?:#{1,3}\s+|глава\s+\d|chapter\s+\d|урок\s+\d|раздел\s+\d|§\s*\d)/iu.test(line.trim()) && line.trim().length < 150) {
      flush(); buffer = []; title = line.trim().replace(/^#{1,3}\s+/, '');
    } else buffer.push(line);
  }
  flush();
  if (!chunks.length || chunks.length > MAX_BOOK_CHAPTERS) throw new AppError(`Не удалось разделить книгу: нужно от 1 до ${MAX_BOOK_CHAPTERS} глав.`);
  return chunks;
}

export async function extractBook(file: File) {
  if (file.size > MAX_BOOK_BYTES || file.size === 0) throw new AppError(`Выберите книгу размером до ${MAX_BOOK_MB} МБ.`);
  const extension = file.name.split('.').pop()?.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());
  let text = '';
  if (extension === 'txt' || extension === 'md') {
    text = new TextDecoder('utf-8', {fatal: true}).decode(buffer);
  } else if (extension === 'pdf') {
    if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new AppError('Файл не является PDF.');
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({data: buffer});
    try {
      const result = await parser.getText();
      text = result.text;
    } finally { await parser.destroy(); }
  } else if (extension === 'docx') {
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new AppError('Файл не является DOCX.');
    const files = extractArchive(buffer,name => name === 'word/document.xml');
    if (!files.has('word/document.xml')) throw new AppError('В DOCX не найден документ.');
    text = markupText(files.get('word/document.xml')!);
  } else if (extension === 'epub') {
    const files = extractArchive(buffer,name => /\.(?:xhtml|html|htm|opf|xml)$/i.test(name));
    const opfEntry = [...files].find(([name]) => name.endsWith('.opf'));
    if (!opfEntry) throw new AppError('В EPUB не найдено оглавление.');
    const [opfPath,opf] = opfEntry;
    const directory = opfPath.slice(0,opfPath.lastIndexOf('/')+1);
    const manifest = new Map<string,string>();
    for (const match of opf.matchAll(/<item\b([^>]+)\/?\s*>/gi)) {
      const attributes = match[1];
      const id = attributes.match(/\bid=["']([^"']+)["']/)?.[1];
      const href = attributes.match(/\bhref=["']([^"']+)["']/)?.[1];
      if (id && href && /\.(?:xhtml|html|htm)$/i.test(href)) manifest.set(id,decodeEntities(href));
    }
    const sections: string[] = [];
    for (const match of opf.matchAll(/<itemref\b[^>]*\bidref=["']([^"']+)["'][^>]*>/gi)) {
      const href = manifest.get(match[1]);
      if (!href) continue;
      const path = new URL(href,'https://book.invalid/'+directory).pathname.slice(1);
      const html = files.get(decodeURIComponent(path));
      if (html) {
        const heading = html.match(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1];
        sections.push(`# ${heading?markupText(heading):`Глава ${sections.length+1}`}\n\n${markupText(html)}`);
      }
    }
    text = sections.join('\n\n');
  } else throw new AppError('Поддерживаются PDF с текстом, EPUB, DOCX, TXT и Markdown.');
  return {buffer, format: extension, chapters: splitChapters(text)};
}
export async function listBooks(user: User): Promise<Book[]> {
  const result = await query(`SELECT b.id,b.title,b.subject,b.grade,b.owner_id AS ownerId,b.source_name AS sourceName,b.format,b.created_at AS createdAt,b.color,COUNT(c.id) AS chapters,COUNT(p.chapter_id) AS completed FROM books b LEFT JOIN chapters c ON c.book_id=b.id LEFT JOIN progress p ON p.chapter_id=c.id AND p.user_id=? GROUP BY b.id ORDER BY b.created_at DESC`, [user.id]);
  return result.rows as unknown as Book[];
}
export async function getChapter(id: string, userId: string): Promise<Chapter & {bookTitle: string; ownerId: string | null; grade: number}> {
  const result = await query(`SELECT c.id,c.book_id AS bookId,c.title,c.content,c.position,c.page_start AS pageStart,c.page_end AS pageEnd,b.title AS bookTitle,b.owner_id AS ownerId,b.grade, CASE WHEN p.chapter_id IS NULL THEN 0 ELSE 1 END AS studied FROM chapters c JOIN books b ON b.id=c.book_id LEFT JOIN progress p ON p.chapter_id=c.id AND p.user_id=? WHERE c.id=?`, [userId,id]);
  if (!result.rows[0]) throw new AppError('Глава не найдена',404);
  return {...result.rows[0],studied: Boolean(result.rows[0].studied)} as unknown as Chapter & {bookTitle: string; ownerId: string | null; grade: number};
}
export async function saveBook(user: User, metadata: {title: string; subject: string; grade: number}, file: File) {
  let extracted: Awaited<ReturnType<typeof extractBook>>;
  try { extracted = await extractBook(file); }
  catch (error) { if (error instanceof AppError) throw error; throw new AppError('Не удалось прочитать книгу. Проверьте формат, кодировку UTF-8 и наличие текста.'); }
  const id = newId();
  await initDb();
  await database().batch([
    {sql: 'INSERT INTO books(id,owner_id,title,subject,grade,source_name,format,original,created_at,color) VALUES(?,?,?,?,?,?,?,?,?,?)', args: [id,user.id,metadata.title,metadata.subject,metadata.grade,file.name.slice(0,200),extracted.format!,extracted.buffer,new Date().toISOString(),Math.floor(Math.random()*5)]},
    ...extracted.chapters.map((c,i) => ({sql: 'INSERT INTO chapters(id,book_id,title,content,position) VALUES(?,?,?,?,?)',args:[newId(),id,c.title,c.content,i]})),
  ],'write');
  return id;
}
