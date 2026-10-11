import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { splitChapters, extractBook, extractArchive } from '../src/lib/books';
import { generatedTestSchema, authSchema } from '../src/lib/validation';
import { hashPassword, verifyPassword } from '../src/lib/auth';
import { shuffleQuestions, scoreQuestions } from '../src/lib/testing';
import { MAX_ARCHIVE_TEXT_BYTES, MAX_BOOK_BYTES, MAX_UPLOAD_BODY_BYTES } from '../src/lib/book-limits';
import { readBookForm } from '../src/lib/upload';
import {epubSections,resolveEpubPath,readEpubArchive} from '../src/lib/epub';
import {readJson,MAX_JSON_BODY_BYTES} from '../src/lib/request-body';
import {checkRoute} from '../src/lib/api-routes';
import {normalizeNumericComparison} from '../src/lib/ai-math';

test('numeric comparison questions have one mathematically correct answer',()=>{
  const question={text:'Как правильно записать сравнение чисел 745 и 815?',options:['745 > 815','745 < 815','745 = 815','745 ≠ 815'],correct:1,explanation:'Сравнение чисел.'};
  const fixed=normalizeNumericComparison(question,'Страница 14');
  assert.deepEqual(fixed.options,['745 < 815','745 > 815','745 = 815','Недостаточно данных для сравнения']);assert.equal(fixed.correct,0);
  const greater=normalizeNumericComparison({...question,text:'Как сравнить 8463 и 8436?',options:['8463 < 8436','8463 > 8436','8463 = 8436','8463 ≠ 8436']},'Страница 14');assert.equal(greater.correct,1);
  assert.equal(normalizeNumericComparison({...question,text:'Какое неравенство неверно?'},'Страница 14').options,question.options);
});

test('passwords are salted and verified without storing plaintext',async()=>{
  const first=await hashPassword('SomePassword123!'),second=await hashPassword('SomePassword123!');
  assert.notEqual(first,second);assert(!first.includes('SomePassword123!'));
  assert(await verifyPassword('SomePassword123!',first));assert(!await verifyPassword('WrongPassword123!',first));
});
test('AI validation rejects invalid answers, duplicate options and truncated output',()=>{
  const valid={text:'Какое число больше?',options:['1','2','3','4'],correct:3,explanation:'Число 4 больше остальных.'};
  assert(generatedTestSchema.safeParse({questions:[valid,valid,valid]}).success);
  assert(!generatedTestSchema.safeParse({questions:[{...valid,correct:-1},valid,valid]}).success);
  assert(!generatedTestSchema.safeParse({questions:[{...valid,options:['1','1','3','4']},valid,valid]}).success);
  assert(!generatedTestSchema.safeParse({questions:[valid]}).success);
});
test('whitespace accounts and short passwords are rejected',()=>{
  assert(!authSchema.safeParse({name:'  ',email:' ',password:'x'}).success);
  assert(authSchema.safeParse({name:'Anna',email:'anna@example.com',password:'longpassword123'}).success);
});
test('chapter extraction preserves content and splits long chapters on boundaries',()=>{
  const text='# Глава 1. Числа\n'+('Натуральные числа нужны для счёта.\n\n'.repeat(15))+'\n# Глава 2. Сложение\n'+('Сложение объединяет количества.\n\n'.repeat(15));
  const chapters=splitChapters(text);assert.equal(chapters.length,2);assert.equal(chapters[1].title,'Глава 2. Сложение');
  assert(splitChapters('Очень длинный учебный материал.\n\n'.repeat(1000)).every(c=>c.content.length<=12000));
  assert.throws(()=>splitChapters('Нет текста'));
  const short=splitChapters('# Глава 1. Теория\n'+ 'Учебный материал для проверки сохранности. '.repeat(5)+'\n# Глава 2. Формула\n2 + 2 = 4');
  assert.equal(short.length,2);assert.equal(short[1].content,'2 + 2 = 4');
});
test('shuffling preserves answer meaning and scoring',()=>{
  const input=[{id:'q1',text:'2+2?',options:['3','4','5','6'],correct:1,explanation:'2+2=4'}];
  for(let i=0;i<100;i++){
    const shuffled=shuffleQuestions(input);assert.equal(shuffled[0].options[shuffled[0].correct],'4');
    assert.deepEqual(scoreQuestions(shuffled,{q1:shuffled[0].correct}),{score:1,maxScore:1});
  }
  assert.deepEqual(scoreQuestions(input,{}),{score:0,maxScore:1});
});
test('DOCX reads text without including external relationships',async()=>{
  const zip=zipSync({'word/document.xml':strToU8('<w:document><w:p><w:r><w:t>Глава 1. Числа</w:t></w:r></w:p><w:p><w:r><w:t>'+('Числа используются для счёта предметов. '.repeat(12))+'</w:t></w:r></w:p></w:document>'),'word/_rels/document.xml.rels':strToU8('<Relationship Target="https://example.com/private"/>')});
  const file=new File([zip as unknown as BlobPart],'book.docx');const result=await extractBook(file);
  assert(result.chapters[0].content.includes('Числа используются'));assert(!result.chapters[0].content.includes('https://'));
});
test('archive inflation is bounded to prevent compressed document bombs',()=>{
  const zip=zipSync({'word/document.xml':new Uint8Array(MAX_ARCHIVE_TEXT_BYTES+1)});
  assert.throws(()=>extractArchive(zip,name=>name==='word/document.xml'));
});
test('EPUB follows spine order rather than archive file order',async()=>{
  const text='Учебный материал для учеников. '.repeat(15);
  const zip=zipSync({'OEBPS/two.xhtml':strToU8('<html><h1>Вторая глава</h1><p>'+text+'</p></html>'),'OEBPS/one.xhtml':strToU8('<html><h1>Первая глава</h1><p>'+text+'</p></html>'),'OEBPS/content.opf':strToU8('<package><manifest><item id="one" href="one.xhtml"/><item id="two" href="two.xhtml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>')});
  const result=await extractBook(new File([zip as unknown as BlobPart],'book.epub'));
  assert.equal(result.chapters[0].title,'Первая глава');assert.equal(result.chapters[1].title,'Вторая глава');
});
test('PDF uploads extract real document text and reject forged signatures',async()=>{
  // A small valid PDF fixture, generated without an additional production dependency.
  const text='Natural numbers count objects. One two three four five. A digit has a place value. Hundreds tens and units make a decimal number. Addition combines quantities. Subtraction finds a difference. A number on the right of the number line is greater.';
  const stream=`BT /F1 10 Tf 20 700 Td (${text}) Tj ET`;
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 2000 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let pdf='%PDF-1.4\n';const offsets=[0];
  objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;});
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  // Images often make a textbook large even when its extracted text is short.
  const result=await extractBook(new File([pdf, '\n%'+ ' '.repeat(5*1024*1024)],'lesson.pdf'));assert(result.buffer.length>4*1024*1024);assert(result.chapters[0].content.includes('Natural numbers count objects'));
  await assert.rejects(()=>extractBook(new File(['fake'],'fake.pdf')));
});

test('large textbooks exceed old file, text and chapter limits without losing text',async()=>{
  const text = '# Глава 1. Большая книга\n' + 'Учебный материал о натуральных числах.\n'.repeat(80000);
  const file = new File([text], 'large.txt');
  assert(file.size > 4*1024*1024);
  const result = await extractBook(file);
  assert(result.chapters.length > 200);
  assert(result.chapters.every(chapter => chapter.content.length <= 12000));
  assert.equal(result.chapters.map(chapter=>chapter.content).join('\n'), text.split('\n').slice(1).join('\n').trim());
  // Reject before reading the body, including a malformed synthetic File.
  await assert.rejects(()=>extractBook({size:MAX_BOOK_BYTES+1} as File), /100 МБ/);
});

test('upload stream enforces actual byte limit without a Content-Length header',async()=>{
  let cancelled = false, supplied = 0;
  const chunk = new Uint8Array(1024*1024);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { supplied += chunk.length; controller.enqueue(chunk); },
    cancel() { cancelled = true; },
  });
  const request = new Request('http://localhost/api/books', {method:'POST',body,duplex:'half'} as RequestInit);
  await assert.rejects(()=>readBookForm(request), /100 МБ/);
  assert(cancelled);
  assert(supplied <= MAX_UPLOAD_BODY_BYTES+2*chunk.length);
});

test('reviewed PDF OCR text is validated and becomes readable chapters',async()=>{
  const pdf = new File(['%PDF-1.4\nimage-only fixture'], 'scan.pdf');
  const text = '# Страница 1\n\n' + 'Натуральные числа используются для счёта предметов. '.repeat(5);
  const result = await extractBook(pdf, text);
  assert.equal(result.chapters[0].title, 'Страница 1');
  assert(result.chapters[0].content.includes('Натуральные числа'));
  await assert.rejects(()=>extractBook(pdf, 'нет текста'));
  await assert.rejects(()=>extractBook(new File(['fake'], 'scan.pdf'),text));
});

test('scanned EPUB reports OCR requirement and accepts reviewed page text',async()=>{
  const zip=zipSync({'OPS/content.opf':strToU8('<package><manifest><item id="p" href="page.xhtml"/></manifest><spine><itemref idref="p"/></spine></package>'),'OPS/page.xhtml':strToU8('<html><head><title>1</title></head><body><img src="images/page.jpg"/></body></html>')});
  const file=new File([zip as unknown as BlobPart],'scan.epub');
  await assert.rejects(()=>extractBook(file),/страницы-картинки/);
  const result=await extractBook(file,'# Страница 1\n'+ 'Натуральные числа используются для счёта. '.repeat(6));
  assert.equal(result.chapters.length,1);assert(result.chapters[0].content.includes('Натуральные числа'));
});

test('EPUB container, namespaced manifest and relative image references preserve spine order',()=>{
  const files=new Map([
    ['META-INF/container.xml','<container><rootfile full-path="OPS/book.opf"/></container>'],
    ['wrong.opf','<invalid/>'],
    ['OPS/book.opf','<opf:package><opf:manifest><opf:item id="one" href="Text/one.xhtml"/><opf:item id="two" href="Text/two.xhtml"/></opf:manifest><opf:spine><opf:itemref idref="two"/><opf:itemref idref="one"/></opf:spine></opf:package>'],
    ['OPS/Text/one.xhtml','<html><head><title>Ignore me</title></head><body><img src="../Images/first%20page.jpg"/></body></html>'],
    ['OPS/Text/two.xhtml','<html><body><svg><image xlink:href="../Images/two.jpg"/></svg><img src="https://example.com/private.jpg"/></body></html>'],
  ]);
  const sections=epubSections(files);assert.equal(sections[0].path,'OPS/Text/two.xhtml');assert.deepEqual(sections[0].images,['OPS/Images/two.jpg']);assert.deepEqual(sections[1].images,['OPS/Images/first page.jpg']);assert.equal(sections[1].text,'');
  assert.equal(resolveEpubPath('OPS/one.xhtml','https://example.com/x.jpg'),undefined);
  const zip=zipSync({'OPS/large.jpg':new Uint8Array(26*1024*1024)});
  assert.throws(()=>readEpubArchive(zip),/безопасный объём/);
});

test('JSON parsing validates media, syntax and actual stream size without trusting headers',async()=>{
  const json=(body:BodyInit,headers:Record<string,string>={'Content-Type':'application/json'})=>new Request('http://localhost/api/auth',{method:'POST',body,headers,duplex:'half'} as RequestInit);
  await assert.rejects(()=>readJson(json('{')),error=>typeof error==='object'&&error!==null&&'status'in error&&error.status===400);
  await assert.rejects(()=>readJson(json('{}',{'Content-Type':'text/plain'})),error=>typeof error==='object'&&error!==null&&'status'in error&&error.status===415);
  let cancelled=false;
  const chunk=new Uint8Array(MAX_JSON_BODY_BYTES);
  const stream=new ReadableStream<Uint8Array>({pull(controller){controller.enqueue(chunk);},cancel(){cancelled=true;}});
  await assert.rejects(()=>readJson(json(stream)),error=>typeof error==='object'&&error!==null&&'status'in error&&error.status===413);assert(cancelled);
  assert.deepEqual(await readJson(json('{"ok":true}')),{ok:true});
  await assert.rejects(()=>readBookForm(new Request('http://localhost/api/books',{method:'POST',headers:{'Content-Type':'multipart/form-data; boundary=wrong'},body:'broken'})),/Повреждённая форма/);
});

test('only exact API routes and supported methods are accepted',()=>{
  checkRoute(['books','id'],'DELETE');checkRoute(['chapters','id','study'],'POST');
  assert.throws(()=>checkRoute(['books','id','unexpected'],'DELETE'),error=>typeof error==='object'&&error!==null&&'status'in error&&error.status===404);
  assert.throws(()=>checkRoute(['auth'],'PUT'),error=>typeof error==='object'&&error!==null&&'status'in error&&error.status===405);
  assert.throws(()=>checkRoute(['chapters','id','study'],'GET'));
});
