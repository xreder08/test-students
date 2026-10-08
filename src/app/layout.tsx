import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'EduTest — книги, знания и практика',description:'Учебная библиотека, ИИ-репетитор и тесты по главам для учителей и учеников.'};
export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="ru"><body>{children}</body></html>;
}
