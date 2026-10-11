import { createClient, type Client, type InValue } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';

const globalDb = globalThis as unknown as {eduDb?: Client; eduInit?: Promise<void>};
export function database(): Client {
  if (globalDb.eduDb) return globalDb.eduDb;
  const url = process.env.DATABASE_URL || 'file:data/edutest.db';
  if (process.env.VERCEL && (!url || url.startsWith('file:'))) throw new Error('Persistent DATABASE_URL required on Vercel');
  if (url.startsWith('file:')) mkdirSync(dirname(resolve(url.slice(5))), {recursive: true});
  globalDb.eduDb = createClient({url, authToken: process.env.DATABASE_AUTH_TOKEN});
  return globalDb.eduDb;
}
const schema = [
  `PRAGMA foreign_keys = ON`,
  `CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('teacher','student')), created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, owner_id TEXT REFERENCES users(id), title TEXT NOT NULL, subject TEXT NOT NULL, grade INTEGER NOT NULL CHECK(grade BETWEEN 1 AND 12), source_name TEXT NOT NULL, format TEXT NOT NULL, original BLOB, created_at TEXT NOT NULL, color INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS chapters (id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE, title TEXT NOT NULL, content TEXT NOT NULL, position INTEGER NOT NULL, page_start INTEGER, page_end INTEGER, UNIQUE(book_id, position))`,
  `CREATE TABLE IF NOT EXISTS progress (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE, studied_at TEXT NOT NULL, PRIMARY KEY(user_id,chapter_id))`,
  `CREATE TABLE IF NOT EXISTS tests (id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE, title TEXT NOT NULL, duration INTEGER NOT NULL CHECK(duration BETWEEN 1 AND 120), questions TEXT NOT NULL, created_at TEXT NOT NULL, auto INTEGER NOT NULL DEFAULT 0)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS one_auto_test ON tests(chapter_id) WHERE auto=1`,
  `CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, deadline TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','finished')), questions TEXT NOT NULL, answers TEXT NOT NULL DEFAULT '{}', score INTEGER, max_score INTEGER, completed_at TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS one_active_attempt ON attempts(test_id,user_id) WHERE status='active'`,
  `CREATE TABLE IF NOT EXISTS rate_limits (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS attempts_user ON attempts(user_id,completed_at)`,
  `CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at)`,
];
export async function initDb() {
  globalDb.eduInit ??= (async () => {
    await database().batch(schema, 'write');
    await seed();
  })().catch(error => { globalDb.eduInit = undefined; throw error; });
  return globalDb.eduInit;
}
export async function query(sql: string, args: InValue[] = []) {
  await initDb();
  return database().execute({sql, args});
}
async function seed() {
  const db=database();
  if((await db.execute("SELECT value FROM app_settings WHERE key='sample_book_seeded'")).rows.length)return;
  // Existing libraries must not gain another sample book on every restart.
  if((await db.execute('SELECT id FROM books LIMIT 1')).rows.length){
    await db.execute("INSERT OR IGNORE INTO app_settings(key,value) VALUES('sample_book_seeded','1')");
    return;
  }
  const id = 'a1111111-1111-4111-8111-111111111111';
  const content = [
    ['Натуральные числа', 'Натуральные числа используют для счёта предметов: 1, 2, 3, 4 и так далее. Число 0 показывает отсутствие предметов. В этом учебном материале натуральный ряд начинается с 1.\n\nВ десятичной системе значение цифры зависит от её позиции. В числе 352 цифра 3 обозначает три сотни, 5 — пять десятков, 2 — две единицы. Получаем 352 = 300 + 50 + 2.\n\nЧтобы сравнить числа с разным количеством цифр, достаточно сравнить количество цифр: 1000 больше 999. Если цифр поровну, сравниваем их слева направо: 426 больше 419, потому что после одинаковых сотен 2 десятка больше 1 десятка.\n\nЧисловой луч начинается в точке 0. Равные отрезки соответствуют одинаковой единице. Число справа больше числа слева. Между 6 и 9 находятся 7 и 8.\n\nПопробуй сам: разложи 704 на разрядные слагаемые. Ответ: 700 + 4. Сравни 580 и 508. Ответ: 580 больше 508.'],
    ['Сложение и вычитание', 'Сложение объединяет количества. Если в одной корзине 12 яблок, а в другой 8, вместе получится 12 + 8 = 20 яблок. Числа 12 и 8 называют слагаемыми, а 20 — суммой.\n\nПереместительное свойство: a + b = b + a. Сочетательное свойство: (a + b) + c = a + (b + c). Поэтому 27 + 16 + 3 удобно считать как (27 + 3) + 16 = 46.\n\nВычитание позволяет найти оставшееся количество или разность. В равенстве 20 − 8 = 12 число 20 — уменьшаемое, 8 — вычитаемое, 12 — разность. Проверка: 12 + 8 = 20.\n\nЕсли x + 7 = 19, неизвестное слагаемое равно сумме минус известное слагаемое: x = 12. Если x − 5 = 13, то x = 18.\n\nПри вычислении в столбик единицы записывают под единицами, десятки под десятками. Если разрядных единиц не хватает, берут одну единицу следующего разряда.\n\nПрактика: 48 + 25 = 73; 90 − 37 = 53; неизвестное число в равенстве x + 14 = 30 равно 16.'],
    ['Умножение и деление', 'Умножение заменяет сложение одинаковых слагаемых: 4 + 4 + 4 = 4 × 3 = 12. Множители — 4 и 3, произведение — 12. Переместительное свойство позволяет менять множители местами: 4 × 3 = 3 × 4.\n\nРаспределительное свойство: a × (b + c) = a × b + a × c. Например, 7 × 12 = 7 × 10 + 7 × 2 = 84.\n\nДеление — обратное действие умножению. Если 24 карандаша разложить поровну в 6 коробок, в каждой будет 24 : 6 = 4 карандаша. Число 24 — делимое, 6 — делитель, 4 — частное. Проверка: 4 × 6 = 24.\n\nПри делении с остатком делимое равно делителю, умноженному на неполное частное, плюс остаток: 17 = 5 × 3 + 2. Остаток всегда меньше делителя. Делить на ноль нельзя.\n\nВ выражении без скобок сначала выполняют умножение и деление, затем сложение и вычитание. Действия одной ступени выполняют слева направо: 18 : 3 × 2 = 12. Скобки меняют порядок: (3 + 5) × 2 = 16, а 3 + 5 × 2 = 13.'],
  ];
  await database().batch([
    {sql: 'INSERT OR IGNORE INTO books(id,title,subject,grade,source_name,format,created_at,color) VALUES(?,?,?,?,?,?,?,?)', args: [id,'Математика. Первые шаги','Математика',5,'Оригинальный учебный материал EduTest','text',new Date().toISOString(),0]},
    ...content.map(([title, text], i) => ({sql: 'INSERT OR IGNORE INTO chapters(id,book_id,title,content,position) VALUES(?,?,?,?,?)', args: [`b1111111-1111-4111-8111-11111111111${i}`,id,title,text,i]})),
    {sql:"INSERT OR IGNORE INTO app_settings(key,value) VALUES('sample_book_seeded','1')",args:[]},
  ], 'write');
}
export const newId = randomUUID;
