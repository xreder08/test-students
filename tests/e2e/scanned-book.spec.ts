import {test,expect} from '@playwright/test';
import {createClient} from '@libsql/client';
import {zipSync,strToU8} from 'fflate';

function imagePdf(jpeg:Buffer) {
  // An original test fixture containing only a page image, no PDF text layer.
  const draw=Buffer.from('q 600 0 0 400 0 0 cm /Im1 Do Q');
  const objects=[Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>'),Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1800 /Height 1200 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),jpeg,Buffer.from('\nendstream')]),Buffer.concat([Buffer.from(`<< /Length ${draw.length} >>\nstream\n`),draw,Buffer.from('\nendstream')])];
  const parts=[Buffer.from('%PDF-1.4\n')],offsets:number[]=[];
  let size=parts[0].length;
  objects.forEach((object,index)=>{offsets.push(size);const part=Buffer.concat([Buffer.from(`${index+1} 0 obj\n`),object,Buffer.from('\nendobj\n')]);parts.push(part);size+=part.length;});
  parts.push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.map(offset=>String(offset).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${size}\n%%EOF`));
  return Buffer.concat(parts);
}

test('scanned PDF and mixed EPUB are OCRed locally in page order and become readable books',async({browser})=>{
  test.setTimeout(150000);
  const origin='http://127.0.0.1:3000',email=`teacher-scan-${Date.now()}@example.test`;
  const context=await browser.newContext();
  const client=createClient({url:process.env.DATABASE_URL!});
  let bookId:string|undefined,epubId:string|undefined;
  try {
    const registration=await context.request.post('/api/auth',{headers:{Origin:origin},data:{action:'register',email,name:'Скан учебника',password:'ScannedBookPassword123!',role:'teacher',inviteCode:process.env.TEACHER_INVITE_CODE}});
    expect(registration.status()).toBe(200);
    const page=await context.newPage();const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    const externalRequests:string[]=[];page.on('request',request=>{if(!request.url().startsWith(origin)&&!request.url().startsWith('blob:')&&!request.url().startsWith('data:'))externalRequests.push(request.url());});
    await page.goto('/');
    const image=await page.evaluate(()=>{
      const canvas=document.createElement('canvas');canvas.width=1800;canvas.height=1200;
      const ctx=canvas.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,1800,1200);ctx.fillStyle='black';ctx.font='48px Arial';
      ['Натуральные числа','Натуральные числа используют для счёта предметов.','Один, два, три, четыре, пять — натуральные числа.','Сложение объединяет количество предметов.','Если взять два яблока и ещё два яблока,','получится четыре яблока. Два плюс два равно четыре.','При вычитании находят разность двух чисел.'].forEach((line,index)=>ctx.fillText(line,80,120+index*125));
      return canvas.toDataURL('image/jpeg',0.95).split(',')[1];
    });
    const original=imagePdf(Buffer.from(image,'base64'));
    await page.getByRole('button',{name:'Добавить книгу',exact:true}).click();
    await page.getByLabel('Файл книги').setInputFiles({name:'scanned-math.pdf',mimeType:'application/pdf',buffer:original});
    await page.getByLabel('Название книги',{exact:true}).fill('Распознанный учебник E2E');
    await page.getByLabel('Предмет',{exact:true}).fill('Математика');
    // A cancelled import must keep metadata and permit another attempt.
    await page.getByRole('button',{name:'Прочитать и распознать PDF'}).click();
    await expect(page.getByRole('status')).toContainText('Распознаём',{timeout:30000});
    await page.getByRole('button',{name:'Отменить обработку'}).click();
    await expect(page.locator('.form-error')).toContainText('отменено',{timeout:30000});
    await expect(page.getByLabel('Название книги',{exact:true})).toHaveValue('Распознанный учебник E2E');
    await page.getByRole('button',{name:'Прочитать и распознать PDF'}).click();
    await expect(page.getByRole('button',{name:'Сохранить книгу',exact:true})).toBeVisible({timeout:90000});
    await expect(page.getByText('Распознано сканов:',{exact:false})).toBeVisible();
    await page.getByText('Проверить и исправить текст книги').click();
    const text=await page.getByLabel('Распознанный текст книги').inputValue();
    expect(text).toContain('Натуральные числа');expect(text).toContain('яблока');
    await page.screenshot({path:'test-results/ocr-preview.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'Сохранить книгу',exact:true}).scrollIntoViewIfNeeded();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
    await page.screenshot({path:'test-results/ocr-mobile.png'});
    const uploaded=page.waitForResponse(response=>response.url().endsWith('/api/books')&&response.request().method()==='POST');
    await page.getByRole('button',{name:'Сохранить книгу',exact:true}).click();
    const response=await uploaded;expect(response.status(),await response.text()).toBe(201);bookId=(await response.json()).id;
    await expect(page.locator('.reading-panel h1')).toHaveText('Страница 1');
    await expect(page.locator('.chapter-text')).toContainText('Натуральные числа');
    const details=await (await context.request.get(`/api/books/${bookId}`)).json();
    const tutor=await context.request.post('/api/tutor',{headers:{Origin:origin},data:{chapterId:details.chapters[0].id,message:'Сколько яблок получится в примере из книги? Объясни по тексту страницы.',mode:'ask',history:[]}});
    expect(tutor.status(),await tutor.text()).toBe(200);expect((await tutor.json()).answer.length).toBeGreaterThan(50);
    const download=await context.request.get(`/api/books/${bookId}/file`);expect((await download.body()).equals(original)).toBeTruthy();
    expect(errors).toEqual([]);expect(externalRequests).toEqual([]);
    await page.screenshot({path:'test-results/scanned-reader.png',fullPage:true});
    await page.goto('/?view=library');
    await page.getByRole('button',{name:'Добавить книгу',exact:true}).click();
    const native='Сложение объединяет количество предметов. Два плюс два равно четыре. '.repeat(5);
    const epub=zipSync({'OPS/two.xhtml':strToU8(`<html><head><title>Ignore metadata</title></head><body><h1>Сложение</h1><p>${native}</p></body></html>`),'OPS/one.xhtml':strToU8('<html><body><img src="images/scan.jpg"/></body></html>'),'OPS/images/scan.jpg':Buffer.from(image,'base64'),'OPS/content.opf':strToU8('<package><manifest><item id="one" href="one.xhtml"/><item id="two" href="two.xhtml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>')});
    await page.getByLabel('Файл книги').setInputFiles({name:'mixed-scans.epub',mimeType:'application/epub+zip',buffer:Buffer.from(epub)});
    await page.getByLabel('Название книги',{exact:true}).fill('EPUB с картинками E2E');
    await page.getByLabel('Предмет',{exact:true}).fill('Математика');
    await page.getByRole('button',{name:'Прочитать и распознать EPUB'}).click();
    await expect(page.getByRole('button',{name:'Сохранить книгу',exact:true})).toBeVisible({timeout:30000});
    await expect(page.locator('.ocr-preview')).toContainText('Обработано страниц: 2. Распознано сканов: 1.');
    const epubUpload=page.waitForResponse(response=>response.url().endsWith('/api/books')&&response.request().method()==='POST');
    await page.getByRole('button',{name:'Сохранить книгу',exact:true}).click();
    const epubResponse=await epubUpload;expect(epubResponse.status(),await epubResponse.text()).toBe(201);epubId=(await epubResponse.json()).id;
    await expect(page.locator('.chapter-text')).toContainText('Натуральные числа');
    const epubDetails=await (await context.request.get(`/api/books/${epubId}`)).json();expect(epubDetails.chapters).toHaveLength(2);expect(epubDetails.chapters[0].title).toBe('Страница 1');expect(epubDetails.chapters[1].title).toBe('Сложение');
    const second=await (await context.request.get(`/api/chapters/${epubDetails.chapters[1].id}`)).json();expect(second.chapter.content).toContain(native.trim());expect(second.chapter.content).not.toContain('Ignore metadata');
    expect(externalRequests).toEqual([]);
  } finally {
    if(epubId)await context.request.delete(`/api/books/${epubId}`,{headers:{Origin:origin}});
    if(bookId)await context.request.delete(`/api/books/${bookId}`,{headers:{Origin:origin}});
    const user=(await client.execute({sql:'SELECT id FROM users WHERE email=?',args:[email]})).rows[0];
    if(user)await client.batch([{sql:'DELETE FROM sessions WHERE user_id=?',args:[user.id]},{sql:'DELETE FROM users WHERE id=?',args:[user.id]}],'write');
    client.close();await context.close();
  }
});
