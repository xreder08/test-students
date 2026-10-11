import { ZodError } from 'zod';
export class AppError extends Error {
  constructor(message: string, public status = 400, public retryAfterSeconds?:number) { super(message); }
}
export function errorResponse(error: unknown) {
  const headers={'Cache-Control':'private, no-store'};
  if (error instanceof AppError) return Response.json({error: error.message}, {status: error.status,headers});
  if (error instanceof ZodError) return Response.json({error: error.issues[0]?.message || 'Проверьте данные'}, {status: 400,headers});
  // Never log raw provider responses, document content, passwords or credentials.
  console.error('Request failed:', error instanceof Error ? error.name : 'UnknownError');
  return Response.json({error: 'Не удалось выполнить действие. Попробуйте ещё раз.'}, {status: 500,headers});
}
