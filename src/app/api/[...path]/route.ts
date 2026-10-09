import { z } from 'zod';
import { createHash } from 'node:crypto';
import { authSchema, tutorSchema, questionSchema } from '@/lib/validation';
import { checkOrigin, createSession, hashPassword, logout, rateLimit, requireUser, safeEqual, sessionUser, verifyPassword } from '@/lib/auth';
import { AppError, errorResponse } from '@/lib/errors';
import { database, newId, query } from '@/lib/db';
import { getChapter, listBooks, saveBook } from '@/lib/books';
import { tutor } from '@/lib/ai';
import { createTest, startAttempt, updateAttempt } from '@/lib/testing';
import { MAX_UPLOAD_BODY_BYTES, MAX_BOOK_TEXT } from '@/lib/book-limits';
import { readBookForm } from '@/lib/upload';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
type Context = {params:Promise<{path:string[]}>};
const idSchema = z.string().uuid();
const reply = (data: unknown, status = 200) => Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});

async function handle(request: Request, context: Context) {
  try {
    const {path} = await context.params;
    const method = request.method;
    if (method !== 'GET') checkOrigin(request);
    const bookUpload = method === 'POST' && path.length === 1 && path[0] === 'books';
    const bodyLimit = bookUpload ? MAX_UPLOAD_BODY_BYTES : 1024 * 1024;
    if (method !== 'GET' && Number(request.headers.get('content-length') || 0) > bodyLimit) throw new AppError('Запрос слишком большой',413);

    if (path[0] === 'auth') {
      if (method === 'GET') return reply({user:await sessionUser()});
      if (method !== 'POST') throw new AppError('Метод не поддерживается',405);
      const data = await request.json();
      if (data.action === 'logout') {await logout(); return reply({ok:true});}
      if (!['login','register'].includes(data.action)) throw new AppError('Неизвестное действие');
      const parsed = authSchema.parse(data);
      const ip = process.env.VERCEL ? request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown' : 'local';
      const identity = createHash('sha256').update(`${ip}:${parsed.email}`).digest('hex');
      await rateLimit(`auth:${identity}`, 10, 900);
      await rateLimit(`auth-ip:${createHash('sha256').update(ip).digest('hex')}`,50,900);
      if (data.action === 'register') {
        if (!parsed.name) throw new AppError('Введите имя');
        if (parsed.role === 'teacher' && (!process.env.TEACHER_INVITE_CODE || !safeEqual(parsed.inviteCode||'',process.env.TEACHER_INVITE_CODE))) throw new AppError('Нужен действующий код приглашения учителя.',403);
        if ((await query('SELECT id FROM users WHERE email=?',[parsed.email])).rows.length) throw new AppError('Этот email уже используется',409);
        const id = newId();
        await query('INSERT INTO users(id,name,email,password_hash,role,created_at) VALUES(?,?,?,?,?,?)',[id,parsed.name,parsed.email,await hashPassword(parsed.password),parsed.role,new Date().toISOString()]);
        await createSession(id);
      } else {
        const user = (await query('SELECT * FROM users WHERE email=?',[parsed.email])).rows[0];
        if (!user) {await hashPassword(parsed.password); throw new AppError('Неверный email или пароль',401);}
        if (!await verifyPassword(parsed.password,String(user.password_hash))) throw new AppError('Неверный email или пароль',401);
        await createSession(String(user.id));
      }
      return reply({user:await sessionUser()});
    }

    const user = await requireUser();
    if (method !== 'GET') await rateLimit(`write:${user.id}`,80);
    if (path[0] === 'dashboard' && method === 'GET') {
      const books = await listBooks(user);
      const results = user.role === 'teacher'
        ? await query(`SELECT a.id,u.id AS studentId,u.name AS studentName,t.title,a.score,a.max_score AS maxScore,a.completed_at AS completedAt,b.title AS bookTitle FROM attempts a JOIN users u ON u.id=a.user_id JOIN tests t ON t.id=a.test_id JOIN chapters c ON c.id=t.chapter_id JOIN books b ON b.id=c.book_id WHERE (b.owner_id=? OR b.owner_id IS NULL) AND a.status='finished' ORDER BY a.completed_at DESC LIMIT 100`,[user.id])
        : await query(`SELECT a.id,t.title,a.score,a.max_score AS maxScore,a.completed_at AS completedAt,b.title AS bookTitle FROM attempts a JOIN tests t ON t.id=a.test_id JOIN chapters c ON c.id=t.chapter_id JOIN books b ON b.id=c.book_id WHERE a.user_id=? AND a.status='finished' ORDER BY a.completed_at DESC LIMIT 100`,[user.id]);
      const active = (await query(`SELECT a.id,t.title,a.deadline FROM attempts a JOIN tests t ON t.id=a.test_id WHERE a.user_id=? AND a.status='active' ORDER BY a.deadline`,[user.id])).rows;
      const aiConfigured = Boolean(process.env.GROQ_API_KEY);
      return reply({user,books,results:results.rows,active,aiConfigured});
    }
    if (path[0] === 'books') {
      if (path.length === 1 && method === 'GET') return reply({books:await listBooks(user)});
      if (path.length === 1 && method === 'POST') {
        await requireUser('teacher'); await rateLimit(`upload:${user.id}`,8,3600);
        const data = await readBookForm(request);
        const file = data.get('file');
        if (!(file instanceof File)) throw new AppError('Выберите файл книги');
        const metadata = z.object({title:z.string().trim().min(2).max(150),subject:z.string().trim().min(2).max(80),grade:z.coerce.number().int().min(1).max(12)}).parse({title:data.get('title'),subject:data.get('subject'),grade:data.get('grade')});
        const rawText = data.get('recognizedText');
        const recognizedText = rawText === null ? undefined : z.string().max(MAX_BOOK_TEXT).parse(rawText);
        return reply({id:await saveBook(user,metadata,file,recognizedText)},201);
      }
      const id = idSchema.parse(path[1]);
      const book = (await query('SELECT id,owner_id,title,source_name,format FROM books WHERE id=?',[id])).rows[0];
      if (!book) throw new AppError('Книга не найдена',404);
      if (method === 'GET' && path[2] === 'file') {
        const original: unknown = (await query('SELECT original FROM books WHERE id=?',[id])).rows[0].original;
        if (!original) throw new AppError('Для этой учебной книги файл не требуется',404);
        if (!(original instanceof ArrayBuffer) && !(original instanceof Uint8Array)) throw new AppError('Файл повреждён',500);
        const file = original instanceof ArrayBuffer ? new Uint8Array(original) : original;
        return new Response(file as unknown as BodyInit,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="book.${String(book.format)}"; filename*=UTF-8''${encodeURIComponent(String(book.source_name))}`,'Cache-Control':'private, no-store'}});
      }
      if (method === 'GET') {
        const chapters = await query(`SELECT c.id,c.title,c.position,length(c.content) AS characters,CASE WHEN p.chapter_id IS NULL THEN 0 ELSE 1 END AS studied FROM chapters c LEFT JOIN progress p ON p.chapter_id=c.id AND p.user_id=? WHERE c.book_id=? ORDER BY c.position`,[user.id,id]);
        return reply({book,chapters:chapters.rows});
      }
      if (method === 'DELETE') {
        if (user.role !== 'teacher' || book.owner_id !== user.id) throw new AppError('Удалить книгу может только её автор',403);
        // Explicit child cleanup is atomic even for hosts with foreign_keys disabled.
        await database().batch([
          {sql:'DELETE FROM attempts WHERE test_id IN (SELECT t.id FROM tests t JOIN chapters c ON c.id=t.chapter_id WHERE c.book_id=?)',args:[id]},
          {sql:'DELETE FROM tests WHERE chapter_id IN (SELECT id FROM chapters WHERE book_id=?)',args:[id]},
          {sql:'DELETE FROM progress WHERE chapter_id IN (SELECT id FROM chapters WHERE book_id=?)',args:[id]},
          {sql:'DELETE FROM chapters WHERE book_id=?',args:[id]},
          {sql:'DELETE FROM books WHERE id=?',args:[id]},
        ],'write');
        return reply({ok:true});
      }
    }
    if (path[0] === 'chapters') {
      const id = idSchema.parse(path[1]);
      const chapter = await getChapter(id,user.id);
      if (method === 'GET') return reply({chapter});
      if (method === 'POST' && path[2] === 'study') {
        await query('INSERT OR IGNORE INTO progress(user_id,chapter_id,studied_at) VALUES(?,?,?)',[user.id,id,new Date().toISOString()]);
        return reply({ok:true});
      }
    }
    if (path[0] === 'tutor' && method === 'POST') {
      await rateLimit(`ai:${user.id}`,12,600);
      const data = tutorSchema.parse(await request.json());
      const chapter = await getChapter(data.chapterId,user.id);
      return reply({answer:await tutor(chapter,data.message,data.mode,data.history),source:chapter.title});
    }
    if (path[0] === 'tests') {
      if (method === 'POST' && path[1] === 'manual') {
        await requireUser('teacher');
        const data = z.object({chapterId:idSchema,title:z.string().trim().min(2).max(150),duration:z.number().int().min(1).max(120),questions:z.array(questionSchema).min(1).max(10)}).parse(await request.json());
        const chapter = await getChapter(data.chapterId,user.id);
        if (chapter.ownerId && chapter.ownerId !== user.id) throw new AppError('Нет доступа к изменению этой книги',403);
        const id = newId();
        await query('INSERT INTO tests(id,chapter_id,title,duration,questions,created_at,auto) VALUES(?,?,?,?,?,?,0)',[id,data.chapterId,data.title,data.duration,JSON.stringify(data.questions.map(q=>({...q,id:newId()}))),new Date().toISOString()]);
        return reply({id},201);
      }
      if (method === 'GET') {
        const chapterId = new URL(request.url).searchParams.get('chapterId');
        const clauses: string[] = []; const args: string[] = [];
        if (chapterId) {clauses.push('t.chapter_id=?');args.push(idSchema.parse(chapterId));}
        if (user.role === 'student') {clauses.push('EXISTS (SELECT 1 FROM progress p WHERE p.chapter_id=t.chapter_id AND p.user_id=?)');args.push(user.id);}
        const result = await query(`SELECT t.id,t.chapter_id AS chapterId,t.title,t.duration,t.created_at AS createdAt,json_array_length(t.questions) AS questionCount,b.title AS bookTitle FROM tests t JOIN chapters c ON c.id=t.chapter_id JOIN books b ON b.id=c.book_id ${clauses.length?'WHERE '+clauses.join(' AND '):''} ORDER BY t.created_at DESC`,args);
        return reply({tests:result.rows});
      }
      if (method === 'POST' && path[1] === 'generate') {
        const data = z.object({chapterId:idSchema,count:z.number().int().min(3).max(10).default(5),duration:z.number().int().min(1).max(120).default(10),automatic:z.boolean().default(true)}).parse(await request.json());
        if (data.automatic) {
          const chapter = await getChapter(data.chapterId,user.id);
          if (user.role==='student' && !chapter.studied) throw new AppError('Сначала изучите главу',403);
          const existing = (await query('SELECT id FROM tests WHERE chapter_id=? AND auto=1',[data.chapterId])).rows[0];
          if (existing) return reply({id:existing.id});
        }
        await rateLimit(`ai:${user.id}`,12,600);
        return reply({id:await createTest(data.chapterId,user,data.count,data.duration,data.automatic)},201);
      }
      if (method === 'POST' && path[2] === 'start') return reply({id:await startAttempt(idSchema.parse(path[1]),user)});
    }
    if (path[0] === 'attempts') {
      const id = idSchema.parse(path[1]);
      if (method === 'GET') return reply({attempt:await updateAttempt(id,user)});
      if (method === 'PATCH' || method === 'POST') {
        const data = z.object({answers:z.record(z.string().uuid(),z.number().int().min(0).max(3)).refine(a => Object.keys(a).length <= 10).optional()}).parse(await request.json());
        return reply({attempt:await updateAttempt(id,user,data.answers,method==='POST')});
      }
    }
    throw new AppError('Страница не найдена',404);
  } catch(error) { return errorResponse(error); }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
