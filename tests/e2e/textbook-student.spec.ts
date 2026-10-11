import {test,expect} from '@playwright/test';
import {createClient} from '@libsql/client';

test('student learns a real textbook section, completes its AI test and sees saved results',async({browser})=>{
  const bookId=process.env.EDUTEST_EPUB_EXISTING_BOOK;test.skip(!bookId,'Supply the downloaded textbook book ID.');
  const origin='http://127.0.0.1:3000',email=`student-realbook-${Date.now()}@example.test`;
  const teacher=await browser.newContext(),student=await browser.newContext();
  const client=createClient({url:process.env.DATABASE_URL!});
  try {
    expect((await teacher.request.post('/api/auth',{headers:{Origin:origin},data:{action:'login',email:'teacher@edutest.local',password:process.env.LOCAL_TEACHER_PASSWORD}})).status()).toBe(200);
    const details=await (await teacher.request.get(`/api/books/${bookId}`)).json();
    let section:{id:string;content:string}|undefined;
    for(const candidate of details.chapters.filter((chapter:{position:number;characters:number})=>chapter.position>=8&&chapter.position<40&&chapter.characters>500)) {
      const chapter=(await (await teacher.request.get(`/api/chapters/${candidate.id}`)).json()).chapter;
      if(/натуральн/i.test(chapter.content)&&/цифр|сч[её]т|называются/i.test(chapter.content)&&!/содержание/i.test(chapter.content)){section=chapter;break;}
    }
    expect(section,'A real teaching section on natural numbers must exist').toBeTruthy();
    expect((await student.request.post('/api/auth',{headers:{Origin:origin},data:{action:'register',email,password:'RealBookStudentTest123!',name:'Проверка учебника',role:'student'}})).status()).toBe(200);
    const page=await student.newPage();const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`/?view=reader&book=${bookId}&chapter=${section!.id}`);await expect(page.locator('.chapter-text')).toContainText(/натуральн/i);
    const answer=page.waitForResponse(response=>response.url().endsWith('/api/tutor'));
    await page.getByRole('button',{name:'Объясни проще'}).click();expect((await answer).status()).toBe(200);await expect(page.locator('.chat-message.assistant')).toBeVisible();
    await page.screenshot({path:'test-results/textbook-student-reader.png'});
    const generation=page.waitForResponse(response=>response.url().endsWith('/api/tests/generate'));
    await page.getByRole('button',{name:'Глава изучена',exact:true}).click();const generated=await generation;expect([200,201],await generated.text()).toContain(generated.status());await expect(page.locator('.question-card')).toBeVisible({timeout:65000});
    const attemptId=new URL(page.url()).searchParams.get('attempt');
    const active=(await (await student.request.get(`/api/attempts/${attemptId}`)).json()).attempt;
    for(let index=0;index<active.questions.length;index++) {
      await page.locator('.answer-option').first().click();await expect(page.getByText('Ответы сохраняются.',{exact:false})).toBeVisible();
      if(index<active.questions.length-1)await page.getByRole('button',{name:'Далее',exact:true}).click();
    }
    await page.getByRole('button',{name:'Завершить тест',exact:true}).click();await expect(page.getByText('ТЕСТ ЗАВЕРШЁН')).toBeVisible();
    const result=(await (await student.request.get(`/api/attempts/${attemptId}`)).json()).attempt;expect(result.status).toBe('finished');expect(result.feedback).toHaveLength(active.questions.length);
    const dashboard=await (await teacher.request.get('/api/dashboard')).json();expect(dashboard.results.some((entry:{id:string})=>entry.id===attemptId)).toBeTruthy();
    await page.reload();await expect(page.getByText('ТЕСТ ЗАВЕРШЁН')).toBeVisible();expect(errors).toEqual([]);
  } finally {
    const user=(await client.execute({sql:'SELECT id FROM users WHERE email=?',args:[email]})).rows[0];
    if(user)await client.batch([{sql:'DELETE FROM attempts WHERE user_id=?',args:[user.id]},{sql:'DELETE FROM progress WHERE user_id=?',args:[user.id]},{sql:'DELETE FROM sessions WHERE user_id=?',args:[user.id]},{sql:'DELETE FROM users WHERE id=?',args:[user.id]}],'write');
    client.close();await teacher.close();await student.close();
  }
});
