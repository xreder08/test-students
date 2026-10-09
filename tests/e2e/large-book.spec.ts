import { test, expect } from '@playwright/test';
import { createClient } from '@libsql/client';

test('teacher uploads a large textbook in browser and downloads the exact original', async ({browser}) => {
  const origin = 'http://127.0.0.1:3000';
  const email = `teacher-large-${Date.now()}@example.test`;
  const context = await browser.newContext();
  const client = createClient({url:process.env.DATABASE_URL!});
  let bookId: string | undefined;
  try {
    const registration = await context.request.post('/api/auth', {
      headers: {Origin:origin},
      data: {action:'register', name:'Большая книга', email, password:'LargeBookTestPassword123!', role:'teacher', inviteCode:process.env.TEACHER_INVITE_CODE},
    });
    expect(registration.status()).toBe(200);
    const page = await context.newPage();
    await page.goto('/');
    await page.getByRole('button', {name:'Добавить книгу',exact:true}).click();
    await expect(page.getByText('PDF с текстом, EPUB, DOCX, TXT, MD · до 100 МБ')).toBeVisible();
    const original = Buffer.from('# Глава 1. Большой учебник\n' + 'Учебный материал о натуральных числах.\n'.repeat(80000));
    expect(original.length).toBeGreaterThan(4*1024*1024);
    await page.getByLabel('Файл книги').setInputFiles({name:'large-textbook.txt',mimeType:'text/plain',buffer:original});
    await page.getByLabel('Название книги',{exact:true}).fill('Большой учебник E2E');
    await page.getByLabel('Предмет',{exact:true}).fill('Математика');
    const upload = page.waitForResponse(response=>response.url().endsWith('/api/books') && response.request().method()==='POST');
    await page.getByRole('button',{name:'Добавить в библиотеку'}).click();
    const response = await upload;
    expect(response.status(),await response.text()).toBe(201);
    bookId = (await response.json()).id;
    await expect(page.locator('.reading-panel h1')).toContainText('Большой учебник');
    const details = await (await context.request.get(`/api/books/${bookId}`)).json();
    expect(details.chapters.length).toBeGreaterThan(200);
    const last = await (await context.request.get(`/api/chapters/${details.chapters.at(-1).id}`)).json();
    expect(last.chapter.content).toContain('натуральных числах');
    const download = await context.request.get(`/api/books/${bookId}/file`);
    expect(download.status()).toBe(200);
    expect((await download.body()).equals(original)).toBeTruthy();
    await page.reload();
    await expect(page.locator('.reading-panel h1')).toContainText('Большой учебник');
  } finally {
    if(bookId) await context.request.delete(`/api/books/${bookId}`,{headers:{Origin:origin}});
    const user = (await client.execute({sql:'SELECT id FROM users WHERE email=?',args:[email]})).rows[0];
    if(user) await client.batch([{sql:'DELETE FROM sessions WHERE user_id=?',args:[user.id]},{sql:'DELETE FROM users WHERE id=?',args:[user.id]}],'write');
    client.close();
    await context.close();
  }
});
