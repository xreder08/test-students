import {test,expect} from '@playwright/test';
test.use({trace:'off'});

// Opt-in regression against a user-supplied file. Neither the book nor its text
// is a repository fixture. Keep it locally only when explicitly requested.
test('actual image-based EPUB is recognized in full and becomes an AI learning book',async({browser})=>{
  test.skip(!process.env.EDUTEST_EPUB_TEST_FILE&&!process.env.EDUTEST_EPUB_EXISTING_BOOK,'Supply a local EPUB path or saved book ID to run this regression.');
  test.setTimeout(1200000);
  const origin='http://127.0.0.1:3000';
  const context=await browser.newContext();let bookId:string|undefined=process.env.EDUTEST_EPUB_EXISTING_BOOK;
  let timer:ReturnType<typeof setInterval>|undefined;
  try {
    const login=await context.request.post('/api/auth',{headers:{Origin:origin},data:{action:'login',email:'teacher@edutest.local',password:process.env.LOCAL_TEACHER_PASSWORD}});
    expect(login.status()).toBe(200);
    const page=await context.newPage();await page.goto('/');
    const externalRequests:string[]=[];page.on('request',request=>{if(!request.url().startsWith(origin)&&!request.url().startsWith('blob:')&&!request.url().startsWith('data:'))externalRequests.push(request.url());});
    if(!bookId) {
    await page.getByRole('button',{name:'Добавить книгу',exact:true}).click();
    await page.getByLabel('Файл книги').setInputFiles(process.env.EDUTEST_EPUB_TEST_FILE!);
    await page.getByLabel('Название книги',{exact:true}).fill('Математика. 5 класс. Часть 1');
    await page.getByLabel('Предмет',{exact:true}).fill('Математика');
    await page.getByRole('button',{name:'Прочитать и распознать EPUB'}).click();
    timer=setInterval(()=>{void page.locator('.ocr-progress').textContent().then(value=>{if(value)console.log(value);}).catch(()=>{});},15000);
    await expect(page.getByRole('button',{name:'Сохранить книгу',exact:true})).toBeVisible({timeout:1100000});
    clearInterval(timer);timer=undefined;
    const summary=await page.locator('.ocr-preview').textContent();console.log(summary?.split('Проверьте')[0]);
    await page.getByText('Проверить и исправить текст книги').click();
    const text=await page.getByLabel('Распознанный текст книги').inputValue();
    expect(text.length).toBeGreaterThan(10000);expect(text).toContain('# Страница 224');expect(text.toLowerCase()).toContain('натуральн');
    const upload=page.waitForResponse(response=>response.url().endsWith('/api/books')&&response.request().method()==='POST');
    await page.getByRole('button',{name:'Сохранить книгу',exact:true}).click();
    const response=await upload;expect(response.status(),await response.text()).toBe(201);bookId=(await response.json()).id;
    }
    const details=await (await context.request.get(`/api/books/${bookId}`)).json();expect(details.chapters.length).toBeGreaterThan(200);
    const chosen=details.chapters.find((chapter:{characters:number;position:number})=>chapter.characters>800&&chapter.position>4);
    expect(chosen).toBeTruthy();
    await page.goto(`/?view=reader&book=${bookId}&chapter=${chosen.id}`);
    await expect(page.locator('.chapter-text')).toContainText(/[\s\S]{100}/);
    const answer=await context.request.post('/api/tutor',{headers:{Origin:origin},data:{chapterId:chosen.id,message:'Объясни материал этой страницы простыми словами по книге.',mode:'explain',history:[]}});
    expect(answer.status(),await answer.text()).toBe(200);
    const generated=await context.request.post('/api/tests/generate',{headers:{Origin:origin},data:{chapterId:chosen.id,count:3,duration:10,automatic:false}});
    expect(generated.status(),await generated.text()).toBe(201);
    expect(externalRequests).toEqual([]);
    await page.screenshot({path:'test-results/actual-epub-reader.png',fullPage:true});
    console.log(`Recognized book saved locally: ${details.chapters.length} sections; tutor and generated test passed.`);
  } finally {
    if(timer)clearInterval(timer);
    if(bookId&&process.env.EDUTEST_EPUB_KEEP_BOOK!=='1')await context.request.delete(`/api/books/${bookId}`,{headers:{Origin:origin}});
    await context.close();
  }
});

test('long EPUB navigation scrolls to the selected section on desktop and mobile',async({browser})=>{
  const bookId=process.env.EDUTEST_EPUB_EXISTING_BOOK;
  test.skip(!bookId,'Supply a saved large book ID to check navigation.');
  const context=await browser.newContext();
  try {
    const login=await context.request.post('/api/auth',{headers:{Origin:'http://127.0.0.1:3000'},data:{action:'login',email:'teacher@edutest.local',password:process.env.LOCAL_TEACHER_PASSWORD}});expect(login.status()).toBe(200);
    const details=await (await context.request.get(`/api/books/${bookId}`)).json();
    const chapter=details.chapters.at(-1);
    const page=await context.newPage();await page.goto(`/?view=reader&book=${bookId}&chapter=${chapter.id}`);
    await expect(page.locator('.chapter-item.selected')).toBeInViewport();
    const scrolling=await page.locator('.chapter-panel nav').evaluate(node=>({height:node.clientHeight,full:node.scrollHeight}));
    expect(scrolling.full).toBeGreaterThan(scrolling.height);expect(scrolling.height).toBeLessThan(600);
    await page.screenshot({path:'test-results/actual-epub-desktop.png'});
    await page.setViewportSize({width:390,height:844});await page.reload();
    await expect(page.locator('.chapter-item.selected')).toBeInViewport();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
    await page.screenshot({path:'test-results/actual-epub-mobile.png'});
  } finally {await context.close();}
});
