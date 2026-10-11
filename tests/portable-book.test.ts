import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,mkdtempSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createClient} from '@libsql/client';
import {installBundledTextbook,BUNDLED_BOOK_ID} from '../scripts/install-textbook';
import {database,query} from '../src/lib/db';

process.env.DATABASE_URL=`file:test-results/portable-book-${randomUUID()}.db`;
after(()=>database().close());

test('bundled textbook installs into a fresh database without user records or duplicate chapters',async()=>{
  const owner=randomUUID();
  await query('INSERT INTO users(id,name,email,password_hash,role,created_at) VALUES(?,?,?,?,?,?)',[owner,'Учитель','teacher@edutest.local','not-a-real-password-hash','teacher',new Date().toISOString()]);
  const id=await installBundledTextbook();assert.equal(id,BUNDLED_BOOK_ID);
  const book=(await query('SELECT owner_id,original,title FROM books WHERE id=?',[id])).rows[0];
  assert.equal(book.owner_id,owner);assert.equal(book.title,'Математика. 5 класс. Часть 1 — проверенный учебник');
  const blob=book.original as ArrayBuffer|Uint8Array;
  const original=blob instanceof ArrayBuffer?new Uint8Array(blob):blob;
  assert.equal(createHash('sha256').update(original).digest('hex'),'ba26a79a1ea19f125cdddf694215d952a96941844c559c85903c6fdf472cb35e');
  assert.equal((await query('SELECT COUNT(*) AS n FROM chapters WHERE book_id=?',[id])).rows[0].n,225);
  assert.equal((await query('SELECT COUNT(*) AS n FROM attempts')).rows[0].n,0);
  assert.equal((await query('SELECT COUNT(*) AS n FROM tests')).rows[0].n,0);
  assert.equal((await query('SELECT COUNT(*) AS n FROM users')).rows[0].n,1);
  const metadata=JSON.parse(readFileSync(new URL('../materials/math-grade5.json',import.meta.url),'utf8'));
  assert.deepEqual((await query('SELECT title,content FROM chapters WHERE book_id=? ORDER BY position',[id])).rows,metadata.chapters);
  await installBundledTextbook();
  assert.equal((await query('SELECT COUNT(*) AS n FROM chapters WHERE book_id=?',[id])).rows[0].n,225);
  assert.equal((await query('SELECT COUNT(*) AS n FROM books WHERE id=?',[id])).rows[0].n,1);
});

test('fresh local setup creates new credentials and automatically installs the textbook',async()=>{
  const folder=resolve(mkdtempSync('test-results/portable-install-'));
  copyFileSync('.env.example',join(folder,'.env.local'));
  const environment={...process.env};
  for(const name of ['DATABASE_URL','DATABASE_AUTH_TOKEN','GROQ_API_KEY','SESSION_SECRET','TEACHER_INVITE_CODE','LOCAL_TEACHER_PASSWORD','LOCAL_STUDENT_PASSWORD','VERCEL'])delete environment[name];
  const result=spawnSync(process.execPath,['--env-file=.env.local','--import','tsx',resolve('scripts/bootstrap.ts')],{cwd:folder,env:environment,encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,'Fresh bootstrap must complete successfully');
  const config=readFileSync(join(folder,'.env.local'),'utf8');
  assert.equal(/SESSION_SECRET=[a-f0-9]{64}/.test(config),true);
  assert.equal(/TEACHER_INVITE_CODE=[a-f0-9]{64}/.test(config),true);
  assert.equal(config.includes('GROQ_API_KEY=\n'),true);
  const db=createClient({url:`file:${join(folder,'data/edutest.db').replaceAll('\\','/')}`});
  try {
    assert.equal((await db.execute('SELECT COUNT(*) AS n FROM users')).rows[0].n,2);
    assert.equal((await db.execute({sql:'SELECT COUNT(*) AS n FROM chapters WHERE book_id=?',args:[BUNDLED_BOOK_ID]})).rows[0].n,225);
    assert.equal(readFileSync(join(folder,'LOCAL_ACCESS.md'),'utf8').includes('teacher@edutest.local'),true);
  }finally{db.close();}
});
