import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHmac, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { cookies } from 'next/headers';
import { query } from './db';
import { AppError } from './errors';
import type { User } from './types';
const scrypt = promisify(scryptCallback);
export const COOKIE = 'edutest_session';
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt:${salt}:${derived.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [kind, salt, hash] = stored.split(':');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const candidate = await scrypt(password, salt, 64) as Buffer;
  const expected = Buffer.from(hash, 'hex');
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}
export function safeEqual(a: string, b: string) {
  const first = createHash('sha256').update(a).digest();
  const second = createHash('sha256').update(b).digest();
  return timingSafeEqual(first, second);
}
function sessionHash(token: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new AppError('Сервер ещё не настроен: нужен SESSION_SECRET', 503);
  return createHmac('sha256', secret).update(token).digest('hex');
}
export async function sessionUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const result = await query('SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?', [sessionHash(token), new Date().toISOString()]);
  return result.rows[0] ? result.rows[0] as unknown as User : null;
}
export async function requireUser(role?: 'teacher' | 'student') {
  const user = await sessionUser();
  if (!user) throw new AppError('Войдите в аккаунт', 401);
  if (role && user.role !== role) throw new AppError('Нет доступа к этому действию', 403);
  return user;
}
export async function createSession(userId: string) {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 7 * 86400000);
  await query('DELETE FROM sessions WHERE expires_at<?', [new Date().toISOString()]);
  await query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)', [sessionHash(token),userId,expires.toISOString()]);
  (await cookies()).set(COOKIE, token, {httpOnly: true, secure: process.env.NODE_ENV === 'production' && !process.env.APP_URL?.startsWith('http://127.0.0.1'), sameSite: 'lax', path: '/', expires});
}
export async function logout() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (token) await query('DELETE FROM sessions WHERE token_hash=?', [sessionHash(token)]);
  (await cookies()).delete(COOKIE);
}
export function checkOrigin(request: Request) {
  const expected = process.env.APP_URL;
  if (process.env.VERCEL && !expected) throw new AppError('APP_URL сервера не настроен',503);
  const origin = request.headers.get('origin');
  const allowed = expected ? new URL(expected).origin : new URL(request.url).origin;
  if (!origin || origin !== allowed) throw new AppError('Запрос с другого сайта отклонён', 403);
}
export async function rateLimit(bucket: string, limit: number, seconds = 60) {
  const now = Math.floor(Date.now() / 1000);
  const result = await query(`INSERT INTO rate_limits(bucket,count,reset_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN rate_limits.reset_at<=? THEN 1 ELSE rate_limits.count+1 END,reset_at=CASE WHEN rate_limits.reset_at<=? THEN excluded.reset_at ELSE rate_limits.reset_at END RETURNING count`, [bucket, now+seconds,now,now]);
  if (Number(result.rows[0].count) > limit) throw new AppError('Слишком много запросов. Подождите немного.', 429);
  if (randomBytes(1)[0] < 8) await query('DELETE FROM rate_limits WHERE reset_at<?', [now]);
}
