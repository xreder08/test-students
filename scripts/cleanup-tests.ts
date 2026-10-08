import { database,query } from '../src/lib/db';
if(process.env.VERCEL || !process.env.DATABASE_URL?.startsWith('file:'))throw new Error('Cleanup is restricted to the local test database.');
const users=(await query("SELECT id FROM users WHERE email LIKE 'teacher-%@example.test' OR email LIKE 'student-%@example.test'")).rows;
let books=0;
for(const user of users){
  const owned=(await query("SELECT id FROM books WHERE owner_id=? AND title='Учебная математика E2E'",[user.id])).rows;
  for(const book of owned){
    await database().batch([
      {sql:'DELETE FROM attempts WHERE test_id IN (SELECT t.id FROM tests t JOIN chapters c ON c.id=t.chapter_id WHERE c.book_id=?)',args:[book.id]},
      {sql:'DELETE FROM tests WHERE chapter_id IN (SELECT id FROM chapters WHERE book_id=?)',args:[book.id]},
      {sql:'DELETE FROM progress WHERE chapter_id IN (SELECT id FROM chapters WHERE book_id=?)',args:[book.id]},
      {sql:'DELETE FROM chapters WHERE book_id=?',args:[book.id]},
      {sql:'DELETE FROM books WHERE id=?',args:[book.id]},
    ],'write');books++;
  }
  await database().batch([
    {sql:'DELETE FROM attempts WHERE user_id=?',args:[user.id]},
    {sql:'DELETE FROM progress WHERE user_id=?',args:[user.id]},
    {sql:'DELETE FROM sessions WHERE user_id=?',args:[user.id]},
    {sql:'DELETE FROM users WHERE id=?',args:[user.id]},
  ],'write');
}
console.log(`Removed synthetic test accounts: ${users.length}; test books: ${books}.`);
