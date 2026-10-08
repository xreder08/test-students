import { randomInt } from 'node:crypto';
import { database, initDb, newId, query } from './db';
import { AppError } from './errors';
import { generateQuestions } from './ai';
import { getChapter } from './books';
import type { Attempt, Question, User } from './types';

export function shuffleQuestions(questions: Question[]): Question[] {
  function shuffle<T>(values: T[]) {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i--) { const j = randomInt(i+1); [result[i],result[j]]=[result[j],result[i]]; }
    return result;
  }
  return shuffle(questions).map(q => {
    const indices = shuffle([0,1,2,3]);
    return {...q,options:indices.map(i => q.options[i]),correct:indices.indexOf(q.correct)};
  });
}
export function scoreQuestions(questions: Question[], answers: Record<string,number>) {
  return {score:questions.filter(q => answers[q.id]===q.correct).length,maxScore:questions.length};
}
export async function createTest(chapterId: string, user: User, count: number, duration: number, automatic: boolean) {
  const chapter = await getChapter(chapterId,user.id);
  if (automatic) {
    if (user.role === 'student' && !chapter.studied) throw new AppError('Сначала изучите главу.',403);
    const existing = await query('SELECT id FROM tests WHERE chapter_id=? AND auto=1',[chapterId]);
    if (existing.rows[0]) return String(existing.rows[0].id);
  } else {
    if (user.role !== 'teacher' || (chapter.ownerId && chapter.ownerId !== user.id)) throw new AppError('Только автор книги может создавать тесты.',403);
  }
  const questions = await generateQuestions(chapter,count);
  const id = newId();
  await query(`${automatic?'INSERT OR IGNORE':'INSERT'} INTO tests(id,chapter_id,title,duration,questions,created_at,auto) VALUES(?,?,?,?,?,?,?)`, [id,chapterId,`${chapter.title} · проверка знаний`,duration,JSON.stringify(questions),new Date().toISOString(),automatic?1:0]);
  if (automatic) return String((await query('SELECT id FROM tests WHERE chapter_id=? AND auto=1',[chapterId])).rows[0].id);
  return id;
}
export async function startAttempt(testId: string, user: User) {
  if (user.role !== 'student') throw new AppError('Тест проходят ученики.',403);
  const test = (await query('SELECT * FROM tests WHERE id=?',[testId])).rows[0];
  if (!test) throw new AppError('Тест не найден',404);
  const chapter = await getChapter(String(test.chapter_id),user.id);
  if (!chapter.studied) throw new AppError('Сначала изучите главу.',403);
  const active = (await query("SELECT id FROM attempts WHERE test_id=? AND user_id=? AND status='active'",[testId,user.id])).rows[0];
  if (active) return String(active.id); // Resumes the original deadline, never resets it.
  const id = newId();
  await query('INSERT OR IGNORE INTO attempts(id,test_id,user_id,deadline,questions) VALUES(?,?,?,?,?)', [id,testId,user.id,new Date(Date.now()+Number(test.duration)*60000).toISOString(),JSON.stringify(shuffleQuestions(JSON.parse(String(test.questions))))]);
  return String((await query("SELECT id FROM attempts WHERE test_id=? AND user_id=? AND status='active'",[testId,user.id])).rows[0].id);
}
export async function updateAttempt(id: string, user: User, answers?: Record<string,number>, finish = false): Promise<Attempt> {
  await initDb();
  const tx = await database().transaction('write');
  try {
    const row = (await tx.execute({sql:'SELECT a.*,t.title FROM attempts a JOIN tests t ON t.id=a.test_id WHERE a.id=? AND a.user_id=?',args:[id,user.id]})).rows[0];
    if (!row) throw new AppError('Попытка не найдена',404);
    const questions: Question[] = JSON.parse(String(row.questions));
    let stored: Record<string,number> = JSON.parse(String(row.answers));
    const expired = Date.now() >= Date.parse(String(row.deadline));
    let status = String(row.status), score = row.score as number | undefined, maxScore = row.max_score as number | undefined;
    if (status === 'active') {
      if (answers && !expired) {
        const validIds = new Set(questions.map(q => q.id));
        if (Object.entries(answers).some(([key,value]) => !validIds.has(key) || !Number.isInteger(value) || value < 0 || value > 3)) throw new AppError('Некорректный ответ.');
        stored = {...stored,...answers};
      }
      if (expired || finish) {
        ({score,maxScore}=scoreQuestions(questions,stored)); status='finished';
        await tx.execute({sql:"UPDATE attempts SET status='finished',answers=?,score=?,max_score=?,completed_at=? WHERE id=?",args:[JSON.stringify(stored),score,maxScore,new Date().toISOString(),id]});
      } else if (answers) {
        await tx.execute({sql:'UPDATE attempts SET answers=? WHERE id=?',args:[JSON.stringify(stored),id]});
      }
    }
    await tx.commit();
    return {
      id,testId:String(row.test_id),title:String(row.title),deadline:String(row.deadline),status,answers:stored,
      questions:questions.map(({id,text,options}) => ({id,text,options})),
      ...(status === 'finished'?{score,maxScore,feedback:questions.map(q => ({...q,selected:stored[q.id]}))}:{}),
    };
  } catch (error) { await tx.rollback(); throw error; }
  finally { tx.close(); }
}
