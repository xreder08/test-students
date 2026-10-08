import { randomBytes } from 'node:crypto';
import { appendFileSync,writeFileSync } from 'node:fs';
import { hashPassword } from '../src/lib/auth';
import { newId,query } from '../src/lib/db';
if(process.env.VERCEL||!process.env.DATABASE_URL?.startsWith('file:'))throw new Error('Local bootstrap is only available for local SQLite.');
const definitions=[
  {name:'Учитель',email:'teacher@edutest.local',role:'teacher',env:'LOCAL_TEACHER_PASSWORD'},
  {name:'Ученик',email:'student@edutest.local',role:'student',env:'LOCAL_STUDENT_PASSWORD'},
];
const accounts: {email:string;password:string;role:string}[]=[];
for(const definition of definitions){
  const password=process.env[definition.env]||randomBytes(18).toString('base64url');
  if(!process.env[definition.env])appendFileSync('.env.local',`\n${definition.env}=${password}\n`);
  const existing=await query('SELECT id FROM users WHERE email=?',[definition.email]);
  if(!existing.rows[0])await query('INSERT INTO users(id,name,email,password_hash,role,created_at) VALUES(?,?,?,?,?,?)',[newId(),definition.name,definition.email,await hashPassword(password),definition.role,new Date().toISOString()]);
  accounts.push({email:definition.email,password,role:definition.role});
}
writeFileSync('LOCAL_ACCESS.md',`# Локальный доступ к EduTest\n\nПриложение: http://127.0.0.1:3000\n\nЭтот файл содержит локальные данные входа. Он исключён из Git. Не публикуйте его.\n\n${accounts.map(a=>`## ${a.role==='teacher'?'Учитель':'Ученик'}\n\nEmail: ${a.email}\n\nПароль: ${a.password}\n`).join('\n')}\n## Регистрация нового учителя\n\nКод приглашения: ${process.env.TEACHER_INVITE_CODE}\n\nПри публикации используйте новые секреты и код приглашения; локальные аккаунты в облако не переносятся.\n`);
console.log('Локальные аккаунты готовы. Данные входа сохранены в LOCAL_ACCESS.md (исключён из Git).');
