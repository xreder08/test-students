import { z } from 'zod';
export const authSchema = z.object({
  name: z.string().trim().min(2, 'Введите имя, минимум 2 символа').max(80).optional(),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email('Проверьте email')),
  password: z.string().min(10, 'Пароль должен содержать минимум 10 символов').max(128),
  role: z.enum(['teacher', 'student']).default('student'),
  inviteCode: z.string().max(100).optional(),
});
export const questionSchema = z.object({
  text: z.string().trim().min(5).max(1000),
  options: z.array(z.string().trim().min(1).max(600)).length(4).refine(a => new Set(a).size === 4),
  correct: z.number().int().min(0).max(3),
  explanation: z.string().trim().min(5).max(1500),
});
export const generatedTestSchema = z.object({questions: z.array(questionSchema).min(3).max(10)});
export const tutorSchema = z.object({
  chapterId: z.string().uuid(),
  message: z.string().trim().min(1).max(1500),
  mode: z.enum(['explain', 'example', 'practice', 'ask']).default('ask'),
  history: z.array(z.object({role: z.enum(['user', 'assistant']), content: z.string().max(4000)})).max(8).default([]),
});
