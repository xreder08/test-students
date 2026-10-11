import {test,expect} from '@playwright/test';
import {createClient} from '@libsql/client';

test('library deletion can be cancelled and removes a book with its tests and results',async({browser})=>{
  const origin='http://127.0.0.1:3000',title=`Удаление E2E ${Date.now()}`,email=`delete-student-${Date.now()}@example.test`;
  const teacher=await browser.newContext(),student=await browser.newContext();
  const db=createClient({url:process.env.DATABASE_URL!});let bookId:string|undefined;
  try {
    await db.execute('PRAGMA busy_timeout=5000');
    expect((await teacher.request.post('/api/auth',{headers:{Origin:origin},data:{action:'login',email:'teacher@edutest.local',password:process.env.LOCAL_TEACHER_PASSWORD}})).status()).toBe(200);
    const upload=await teacher.request.post('/api/books',{headers:{Origin:origin},multipart:{title,subject:'Математика',grade:'5',file:{name:'delete.txt',mimeType:'text/plain',buffer:Buffer.from('# Глава 1\n'+'Натуральные числа используют для счёта. Два плюс два равно четыре. '.repeat(5))}}});
    expect(upload.status()).toBe(201);bookId=(await upload.json()).id;
    const chapter=(await (await teacher.request.get(`/api/books/${bookId}`)).json()).chapters[0];
    const created=await teacher.request.post('/api/tests/manual',{headers:{Origin:origin},data:{chapterId:chapter.id,title:'Проверка удаления',duration:10,questions:[{text:'Сколько будет два плюс два?',options:['1','2','3','4'],correct:3,explanation:'Два плюс два равно четыре.'}]}});expect(created.status()).toBe(201);const testId=(await created.json()).id;
    expect((await student.request.post('/api/auth',{headers:{Origin:origin},data:{action:'register',email,password:'DeleteTestPassword123!',name:'Проверка удаления',role:'student'}})).status()).toBe(200);
    await student.request.post(`/api/chapters/${chapter.id}/study`,{headers:{Origin:origin},data:{}});
    const attemptId=(await (await student.request.post(`/api/tests/${testId}/start`,{headers:{Origin:origin},data:{}})).json()).id;
    await student.request.post(`/api/attempts/${attemptId}`,{headers:{Origin:origin},data:{}});
    const sp=await student.newPage();await sp.goto('/?view=library');await expect(sp.getByRole('heading',{name:title,exact:true})).toBeVisible();expect(await sp.getByRole('button',{name:`Удалить книгу «${title}»`,exact:true}).count()).toBe(0);
    const page=await teacher.newPage();await page.goto('/?view=library');const remove=page.getByRole('button',{name:`Удалить книгу «${title}»`,exact:true});await expect(remove).toBeVisible();
    page.once('dialog',dialog=>dialog.dismiss());await remove.click();expect((await teacher.request.get(`/api/books/${bookId}`)).status()).toBe(200);
    await page.setViewportSize({width:390,height:844});await expect(remove).toBeVisible();
    page.once('dialog',async dialog=>{expect(dialog.message()).toContain(title);expect(dialog.message()).toContain('результаты');await dialog.accept();});await remove.click();
    await expect(page.getByRole('status')).toContainText('удалена');await expect(page.getByRole('heading',{name:title,exact:true})).toHaveCount(0);
    expect((await teacher.request.get(`/api/books/${bookId}`)).status()).toBe(404);
    expect((await student.request.get(`/api/attempts/${attemptId}`)).status()).toBe(404);
    for(const [table,column,id]of [['chapters','book_id',bookId],['tests','id',testId],['progress','chapter_id',chapter.id]])expect((await db.execute({sql:`SELECT COUNT(*) AS n FROM ${table} WHERE ${column}=?`,args:[id]})).rows[0].n).toBe(0);
    await page.reload();await expect(page.getByRole('heading',{name:title,exact:true})).toHaveCount(0);
  } finally {
    if(bookId)await teacher.request.delete(`/api/books/${bookId}`,{headers:{Origin:origin}});
    await teacher.close();await student.close();
    const user=(await db.execute({sql:'SELECT id FROM users WHERE email=?',args:[email]})).rows[0];if(user)await db.batch([{sql:'DELETE FROM sessions WHERE user_id=?',args:[user.id]},{sql:'DELETE FROM users WHERE id=?',args:[user.id]}],'write');
    db.close();
  }
});
