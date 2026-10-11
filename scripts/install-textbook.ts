import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {z} from 'zod';
import {database,initDb,newId,query} from '../src/lib/db';

export const BUNDLED_BOOK_ID='50dd06d8-f7ec-472c-a163-ffb3483b4662';
export async function installBundledTextbook() {
  if(process.env.VERCEL||!process.env.DATABASE_URL?.startsWith('file:'))throw new Error('Установка комплекта разрешена только в локальную SQLite-базу.');
  const metadata=z.object({
    version:z.literal(1),title:z.string().min(1).max(150),subject:z.string().min(1).max(80),grade:z.number().int().min(1).max(12),
    sha256:z.string().regex(/^[a-f0-9]{64}$/),
    chapters:z.array(z.object({title:z.string().min(1).max(200),content:z.string().min(1).max(12000)})).min(1).max(2000),
  }).parse(JSON.parse(readFileSync(new URL('../materials/math-grade5.json',import.meta.url),'utf8')));
  const original=readFileSync(new URL('../materials/math-grade5.epub',import.meta.url));
  if(createHash('sha256').update(original).digest('hex')!==metadata.sha256)throw new Error('Исходник учебника повреждён: контрольная сумма не совпадает.');
  await initDb();
  if((await query('SELECT id FROM books WHERE id=?',[BUNDLED_BOOK_ID])).rows.length){console.log('Учебник уже установлен; данные сохранены.');return BUNDLED_BOOK_ID;}
  const owner=(await query("SELECT id FROM users WHERE email=? AND role='teacher'",['teacher@edutest.local'])).rows[0];
  if(!owner)throw new Error('Сначала создайте локального учителя: npm run setup:local.');
  const sourceName='2455_математика_1_часть_5_класс.epub';
  await database().batch([
    {sql:'INSERT INTO books(id,owner_id,title,subject,grade,source_name,format,original,created_at,color) VALUES(?,?,?,?,?,?,?,?,?,?)',args:[BUNDLED_BOOK_ID,owner.id,metadata.title,metadata.subject,metadata.grade,sourceName,'epub',original,new Date().toISOString(),0]},
    ...metadata.chapters.map((chapter,position)=>({sql:'INSERT INTO chapters(id,book_id,title,content,position) VALUES(?,?,?,?,?)',args:[newId(),BUNDLED_BOOK_ID,chapter.title,chapter.content,position]})),
  ],'write');
  console.log(`Учебник установлен: ${metadata.chapters.length} разделов. Повторное OCR не требуется.`);
  return BUNDLED_BOOK_ID;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await installBundledTextbook();
