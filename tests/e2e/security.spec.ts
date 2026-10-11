import {test,expect} from '@playwright/test';
import {createClient} from '@libsql/client';
const origin='http://127.0.0.1:3000';

test('invalid JSON, unsupported media and extra route segments fail safely',async({request})=>{
  for(const payload of ['{','null','[]','"text"']) {
    const response=await request.post('/api/auth',{headers:{Origin:origin,'Content-Type':'application/json'},data:Buffer.from(payload)});
    expect(response.status(),payload).toBe(400);expect(response.headers()['cache-control']).toContain('no-store');
  }
  const media=await request.post('/api/auth',{headers:{Origin:origin,'Content-Type':'text/plain'},data:'{}'});expect(media.status()).toBe(415);
  const extra=await request.get('/api/auth/unexpected');expect(extra.status()).toBe(404);
  const method=await request.put('/api/auth',{headers:{Origin:origin},data:{}});expect(method.status()).toBe(405);
  const huge=await request.post('/api/auth',{headers:{Origin:origin,'Content-Type':'application/json'},data:' '.repeat(1024*1024+1)});expect(huge.status()).toBe(413);
});

test('registration races, foreign ownership and concurrent test attempts are safe',async({browser})=>{
  const stamp=Date.now(),password='AuditTestPassword123!';
  const teacher=await browser.newContext(),student=await browser.newContext(),outsider=await browser.newContext();
  const client=createClient({url:process.env.DATABASE_URL!});
  const emails=[`teacher-audit-${stamp}@example.test`,`student-audit-${stamp}@example.test`,`student-foreign-${stamp}@example.test`];
  let bookId:string|undefined;
  try {
    expect((await teacher.request.post('/api/auth',{headers:{Origin:origin},data:{action:'register',email:emails[0],password,name:'Аудит учителя',role:'teacher',inviteCode:process.env.TEACHER_INVITE_CODE}})).status()).toBe(200);
    const registration={action:'register',email:emails[1],password,name:'Аудит ученика',role:'student'};
    const race=await Promise.all([student.request.post('/api/auth',{headers:{Origin:origin},data:registration}),student.request.post('/api/auth',{headers:{Origin:origin},data:registration})]);
    expect(race.map(response=>response.status()).sort()).toEqual([200,409]);
    expect((await outsider.request.post('/api/auth',{headers:{Origin:origin},data:{...registration,email:emails[2]}})).status()).toBe(200);
    const cookie=race.find(response=>response.status()===200)!.headers()['set-cookie'];expect(cookie).toContain('HttpOnly');expect(cookie).toContain('SameSite=lax');
    const text='# Глава 1. Числа\n'+ 'Натуральные числа используют для счёта предметов. Два плюс два равно четыре. '.repeat(5);
    const upload=await teacher.request.post('/api/books',{headers:{Origin:origin},multipart:{title:'Аудит безопасности E2E',subject:'Математика',grade:'5',file:{name:'audit.txt',mimeType:'text/plain',buffer:Buffer.from(text)}}});expect(upload.status()).toBe(201);bookId=(await upload.json()).id;
    const chapter=(await (await teacher.request.get(`/api/books/${bookId}`)).json()).chapters[0];
    expect((await teacher.request.delete(`/api/books/${bookId}/unexpected`,{headers:{Origin:origin}})).status()).toBe(404);
    expect((await teacher.request.get(`/api/books/${bookId}`)).status()).toBe(200);
    expect((await outsider.request.delete(`/api/books/${bookId}`,{headers:{Origin:origin}})).status()).toBe(403);
    const q={text:'Два плюс два?',options:['1','2','3','4'],correct:3,explanation:'Два плюс два равно четыре.'};
    const manual=await teacher.request.post('/api/tests/manual',{headers:{Origin:origin},data:{chapterId:chapter.id,title:'Аудит теста',duration:10,questions:[q,{...q,text:'Сколько будет 2+2?'}]}});expect(manual.status()).toBe(201);const testId=(await manual.json()).id;
    expect((await student.request.post('/api/tests/manual',{headers:{Origin:origin},data:{chapterId:chapter.id,title:'Подмена',duration:10,questions:[q]}})).status()).toBe(403);
    expect((await student.request.post(`/api/tests/${testId}/start`,{headers:{Origin:origin},data:{}})).status()).toBe(403);
    expect((await student.request.post(`/api/chapters/${chapter.id}/study`,{headers:{Origin:origin},data:{}})).status()).toBe(200);
    const starts=await Promise.all([student.request.post(`/api/tests/${testId}/start`,{headers:{Origin:origin},data:{}}),student.request.post(`/api/tests/${testId}/start`,{headers:{Origin:origin},data:{}})]);
    expect(starts.map(response=>response.status())).toEqual([200,200]);
    const ids=await Promise.all(starts.map(response=>response.json()));expect(ids[0].id).toBe(ids[1].id);const attemptId=ids[0].id;
    const active=(await (await student.request.get(`/api/attempts/${attemptId}`)).json()).attempt;expect(active.questions[0]).not.toHaveProperty('correct');
    const saves=await Promise.all(active.questions.map((question:{id:string})=>student.request.patch(`/api/attempts/${attemptId}`,{headers:{Origin:origin},data:{answers:{[question.id]:0}}})));
    expect(saves.map(response=>response.status())).toEqual([200,200]);
    const saved=(await (await student.request.get(`/api/attempts/${attemptId}`)).json()).attempt;expect(Object.keys(saved.answers)).toHaveLength(2);
    expect((await outsider.request.get(`/api/attempts/${attemptId}`)).status()).toBe(404);
    const finish=await Promise.all([student.request.post(`/api/attempts/${attemptId}`,{headers:{Origin:origin},data:{}}),student.request.post(`/api/attempts/${attemptId}`,{headers:{Origin:origin},data:{}})]);expect(finish.map(response=>response.status())).toEqual([200,200]);
    const results=await Promise.all(finish.map(response=>response.json()));expect(results[0].attempt.score).toBe(results[1].attempt.score);
    expect((await student.request.post('/api/auth',{headers:{Origin:origin},data:{action:'logout'}})).status()).toBe(200);expect((await student.request.get('/api/books')).status()).toBe(401);
  } finally {
    if(bookId)await teacher.request.delete(`/api/books/${bookId}`,{headers:{Origin:origin}});
    for(const email of emails){const user=(await client.execute({sql:'SELECT id FROM users WHERE email=?',args:[email]})).rows[0];if(user)await client.batch([{sql:'DELETE FROM sessions WHERE user_id=?',args:[user.id]},{sql:'DELETE FROM users WHERE id=?',args:[user.id]}],'write');}
    client.close();await teacher.close();await student.close();await outsider.close();
  }
});
