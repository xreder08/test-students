export type User = {id: string; name: string; email: string; role: 'teacher' | 'student'};
export type Chapter = {id: string; bookId: string; title: string; content: string; position: number; pageStart?: number; pageEnd?: number; studied?: boolean};
export type Book = {id: string; title: string; subject: string; grade: number; ownerId: string; sourceName: string; format: string; createdAt: string; chapters: number; completed: number; color: number};
export type Question = {id: string; text: string; options: string[]; correct: number; explanation: string};
export type PublicQuestion = Omit<Question, 'correct' | 'explanation'>;
export type Test = {id: string; chapterId: string; title: string; duration: number; questionCount: number; createdAt: string};
export type Attempt = {id: string; testId: string; title: string; deadline: string; status: string; questions: PublicQuestion[]; answers: Record<string, number>; score?: number; maxScore?: number; feedback?: {id: string; text: string; options: string[]; selected?: number; correct: number; explanation: string}[]};
