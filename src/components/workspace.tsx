'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Library, LayoutDashboard, ClipboardCheck, BarChart3, LogOut, Search, Plus, Sparkles, Check, X, Upload, ChevronRight, ChevronLeft, Send, Clock, Download, Trash2, Menu, GraduationCap, AlertCircle, LoaderCircle, CheckCircle2, Lightbulb, Pencil, ArrowUpRight } from 'lucide-react';
import type { Attempt, Book, Chapter, Question, Test, User } from '@/lib/types';
type Result = {id:string; title:string; score:number;maxScore:number;completedAt:string;bookTitle:string;studentName?:string;studentId?:string};
type Dashboard = {user:User;books:Book[];results:Result[];active:{id:string;title:string;deadline:string}[];aiConfigured:boolean};
type BookDetail = {book:{id:string;title:string;owner_id:string|null;format:string};chapters:{id:string;title:string;position:number;characters:number;studied:number}[]};
type Message = {role:'user'|'assistant';content:string};
type View = 'home'|'library'|'reader'|'tests'|'results'|'attempt';
type Nav = {view:View;book?:string;chapter?:string;attempt?:string};
async function api<T>(path:string, options:RequestInit = {}):Promise<T> {
  const response = await fetch(`/api/${path}`,{...options,headers:{...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),...options.headers},cache:'no-store'});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Не удалось выполнить действие');
  return data as T;
}
const post = (body:unknown):RequestInit => ({method:'POST',body:JSON.stringify(body)});
const percentage = (r:{score:number;maxScore:number}) => r.maxScore?Math.round(r.score/r.maxScore*100):0;
const date = (value:string) => new Date(value).toLocaleDateString('ru-RU',{day:'numeric',month:'short'});
function Logo() {return <div className="logo"><span><BookOpen size={22}/></span>EduTest<span className="logo-dot">.</span></div>;}
function Spinner() {return <LoaderCircle className="spin" size={18}/>;}

export default function Workspace() {
  const [dashboard,setDashboard] = useState<Dashboard|null>(null);
  const [ready,setReady] = useState(false);
  const [nav,setNav] = useState<Nav>({view:'home'});
  const [detail,setDetail] = useState<BookDetail|null>(null);
  const [chapter,setChapter] = useState<(Chapter & {bookTitle:string;grade:number})|null>(null);
  const [tests,setTests] = useState<(Test & {bookTitle:string})[]>([]);
  const [attempt,setAttempt] = useState<Attempt|null>(null);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [busy,setBusy] = useState('');
  const [uploadOpen,setUploadOpen] = useState(false);
  const [manualOpen,setManualOpen] = useState(false);
  const [menuOpen,setMenuOpen] = useState(false);
  const [search,setSearch] = useState('');
  const [grade,setGrade] = useState('all');
  const [readerSize,setReaderSize] = useState(18);
  const [messages,setMessages] = useState<Message[]>([]);
  const [message,setMessage] = useState('');
  const [tutorBusy,setTutorBusy] = useState(false);
  const [current,setCurrent] = useState(0);
  const [answers,setAnswers] = useState<Record<string,number>>({});
  const [now,setNow] = useState(Date.now());
  const [saveError,setSaveError] = useState('');
  const messagesEnd = useRef<HTMLDivElement>(null);
  const lastAutoFinish = useRef(0);
  const chapterRequest = useRef(0);
  const user = dashboard?.user;
  const teacher = user?.role === 'teacher';
  const navigate = useCallback((next:Nav) => {
    const params = new URLSearchParams({view:next.view});
    if(next.book)params.set('book',next.book); if(next.chapter)params.set('chapter',next.chapter); if(next.attempt)params.set('attempt',next.attempt);
    window.history.pushState({},'',`/?${params}`); setNav(next);setMenuOpen(false);setError('');setNotice('');
  },[]);
  const refresh = useCallback(async () => {const data=await api<Dashboard>('dashboard');setDashboard(data);return data;},[]);
  useEffect(() => {
    const readUrl=()=>{const p=new URLSearchParams(window.location.search);const view=p.get('view')||'home';setNav({view:(['home','library','reader','tests','results','attempt'].includes(view)?view:'home') as View,book:p.get('book')||undefined,chapter:p.get('chapter')||undefined,attempt:p.get('attempt')||undefined});};
    readUrl();window.addEventListener('popstate',readUrl);
    api<{user:User|null}>('auth').then(async data=>{if(data.user)await refresh();}).catch(e=>setError(e.message)).finally(()=>setReady(true));
    return ()=>window.removeEventListener('popstate',readUrl);
  },[refresh]);
  useEffect(() => {
    if(!user)return;
    let cancelled=false;
    async function load() {
      setBusy('load');setError('');
      try {
        if(nav.view==='reader'&&nav.book) {
          const d=await api<BookDetail>(`books/${nav.book}`);
          const chapterId=nav.chapter||d.chapters[0]?.id;
          const c=chapterId?await api<{chapter:Chapter & {bookTitle:string;grade:number}}>(`chapters/${chapterId}`):null;
          if(c&&c.chapter.bookId!==nav.book)throw new Error('Глава не принадлежит выбранной книге.');
          if(!cancelled){setDetail(d);setChapter(c?.chapter||null);setMessages([]);setMessage('');}
        }
        if(nav.view==='tests'){const d=await api<{tests:(Test&{bookTitle:string})[]}>('tests');if(!cancelled)setTests(d.tests);}
        if(nav.view==='attempt'&&nav.attempt){const d=await api<{attempt:Attempt}>(`attempts/${nav.attempt}`);if(!cancelled){setAttempt(d.attempt);setAnswers(d.attempt.answers);setCurrent(0);}}
        if(nav.view==='home'||nav.view==='library'||nav.view==='results')await refresh();
      }catch(e){if(!cancelled)setError((e as Error).message);}
      finally{if(!cancelled)setBusy('');}
    }
    load();return()=>{cancelled=true;};
  },[nav,user?.id,refresh]);
  useEffect(()=>{chapterRequest.current++;setTutorBusy(false);},[nav.book,nav.chapter,nav.view]);
  useEffect(()=>{messagesEnd.current?.scrollIntoView({behavior:'smooth',block:'nearest'});},[messages,tutorBusy]);
  useEffect(()=>{if(nav.view!=='attempt'||attempt?.status!=='active')return;const id=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(id);},[nav.view,attempt?.status]);
  const finishAttempt = useCallback(async () => {
    if(!attempt||busy==='finish')return;
    setBusy('finish');setError('');
    try {const d=await api<{attempt:Attempt}>(`attempts/${attempt.id}`,post({answers}));setAttempt(d.attempt);await refresh();}
    catch(e){setError((e as Error).message);}finally{setBusy('');}
  },[attempt,answers,busy,refresh]);
  useEffect(()=>{if(nav.view==='attempt'&&attempt?.status==='active'&&Date.parse(attempt.deadline)<=now&&!busy&&now-lastAutoFinish.current>10000){lastAutoFinish.current=now;void finishAttempt();}},[now,nav.view,attempt,busy,finishAttempt]);
  async function run(key:string, action:()=>Promise<void>) {setBusy(key);setError('');setNotice('');try{await action();}catch(e){setError((e as Error).message);}finally{setBusy('');}}
  function openBook(book:Book){setDetail(null);setChapter(null);navigate({view:'reader',book:book.id});}
  async function learnDone() {
    if(!chapter)return;
    await run('generate',async()=>{
      await api(`chapters/${chapter.id}/study`,post({}));setChapter({...chapter,studied:true});await refresh();
      setDetail(old=>old?{...old,chapters:old.chapters.map(c=>c.id===chapter.id?{...c,studied:1}:c)}:old);
      const d=await api<{id:string}>('tests/generate',post({chapterId:chapter.id,automatic:true}));
      if(teacher){setNotice('Тест готов. Он появится у учеников после изучения главы.');}
      else{const a=await api<{id:string}>(`tests/${d.id}/start`,post({}));setAttempt(null);navigate({view:'attempt',attempt:a.id});}
    });
  }
  async function sendTutor(mode='ask',text=message) {
    if(!chapter||!text.trim()||tutorBusy)return;
    const requestVersion=chapterRequest.current;
    const previous=messages.slice(-8);setMessages([...messages,{role:'user',content:text}]);setMessage('');setTutorBusy(true);
    try{const d=await api<{answer:string}>('tutor',post({chapterId:chapter.id,message:text,mode,history:previous}));if(chapterRequest.current===requestVersion)setMessages(old=>[...old,{role:'assistant',content:d.answer}]);}
    catch(e){if(chapterRequest.current===requestVersion)setMessages(old=>[...old,{role:'assistant',content:(e as Error).message}]);}finally{if(chapterRequest.current===requestVersion)setTutorBusy(false);}
  }
  async function chooseAnswer(questionId:string,value:number) {
    if(!attempt||attempt.status!=='active')return;
    const next={...answers,[questionId]:value};setAnswers(next);setSaveError('');setBusy('answer');
    try{const d=await api<{attempt:Attempt}>(`attempts/${attempt.id}`,{method:'PATCH',body:JSON.stringify({answers:{[questionId]:value}})});setAttempt(d.attempt);}
    catch(e){setSaveError((e as Error).message);}finally{setBusy('');}
  }
  if(!ready)return <div className="initial"><Logo/><Spinner/><p>Открываем учебную библиотеку…</p></div>;
  if(!user)return <AuthScreen error={error} onLogin={async()=>{await refresh();navigate({view:'home'});}}/>;
  const books=dashboard.books;
  const totalChapters=books.reduce((s,b)=>s+Number(b.chapters),0), completed=books.reduce((s,b)=>s+Number(b.completed),0);
  const avg=dashboard.results.length?Math.round(dashboard.results.reduce((s,r)=>s+percentage(r),0)/dashboard.results.length):null;
  const filtered=books.filter(b=>(grade==='all'||b.grade===Number(grade))&&`${b.title} ${b.subject}`.toLowerCase().includes(search.toLowerCase()));
  const pageNames:Record<View,string>={home:teacher?'Панель учителя':'Моё обучение',library:'Библиотека',reader:'Чтение и практика',tests:'Тесты по главам',results:teacher?'Результаты учеников':'Мои результаты',attempt:'Проверка знаний'};
  return <div className="app-shell">
    <aside className={`sidebar ${menuOpen?'is-open':''}`}>
      <Logo/><div className="workspace-label">УЧЕБНОЕ ПРОСТРАНСТВО</div>
      <nav aria-label="Основная навигация">
        {([{view:'home',label:teacher?'Обзор':'Моё обучение',icon:LayoutDashboard},{view:'library',label:'Библиотека',icon:Library},{view:'tests',label:'Тесты',icon:ClipboardCheck},{view:'results',label:teacher?'Результаты':'Мой прогресс',icon:BarChart3}] as const).map(item=><button key={item.view} className={`nav-item ${nav.view===item.view||(item.view==='library'&&nav.view==='reader')?'active':''}`} onClick={()=>navigate({view:item.view})}><item.icon size={20}/>{item.label}{item.view==='library'&&<span>{books.length}</span>}</button>)}
      </nav>
      <div className="sidebar-note"><Sparkles size={22}/><strong>Учись с пониманием</strong><p>Книга, объяснения и практика — в одном месте.</p></div>
      <div className="profile"><div className="avatar">{user.name.slice(0,1).toUpperCase()}</div><div><strong>{user.name}</strong><small>{teacher?'Учитель':'Ученик'}</small></div><button className="icon-btn" aria-label="Выйти" onClick={()=>run('logout',async()=>{await api('auth',post({action:'logout'}));setDashboard(null);})}><LogOut size={18}/></button></div>
    </aside>
    {menuOpen&&<button className="sidebar-backdrop" aria-label="Закрыть меню" onClick={()=>setMenuOpen(false)}/>}
    <div className="main-shell"><header className="topbar"><div className="topbar-title"><button className="icon-btn mobile-menu" aria-label="Открыть меню" onClick={()=>setMenuOpen(true)}><Menu/></button><span>Учебное пространство</span><ChevronRight size={14}/><strong>{pageNames[nav.view]}</strong></div><div className="topbar-right"><span className="role-label"><GraduationCap size={16}/>{teacher?'Для учителя':'Для ученика'}</span><div className="avatar small">{user.name.slice(0,1).toUpperCase()}</div></div></header>
    <main className={`main-content ${nav.view==='reader'?'reader-main':''}`}>
      {error&&<div className="alert error" role="alert"><AlertCircle size={19}/><span>{error}</span><button aria-label="Закрыть ошибку" onClick={()=>setError('')}><X size={17}/></button></div>}
      {notice&&<div className="alert success" role="status"><CheckCircle2 size={19}/>{notice}</div>}
      {busy==='load'&&<div className="loading-bar" role="status"><Spinner/> Загружаем…</div>}
      {(nav.view==='home'||nav.view==='library')&&<>
        <div className="page-heading"><div><div className="eyebrow">{nav.view==='home'?'ЗНАНИЯ НАЧИНАЮТСЯ С ЛЮБОПЫТСТВА':'ТВОЯ УЧЕБНАЯ ПОЛКА'}</div><h1>{nav.view==='home'?`Привет, ${user.name.split(' ')[0]}!`:'Библиотека книг'}</h1><p>{teacher?'Добавляйте книги и помогайте ученикам разбираться в каждой главе.':'Выбери книгу, изучи главу и проверь, что получилось понять.'}</p></div>{teacher&&<button className="btn primary" onClick={()=>setUploadOpen(true)}><Plus size={19}/>Добавить книгу</button>}</div>
        {nav.view==='home'&&<>
          <div className="stats-grid"><Stat label="Книг в библиотеке" value={books.length} icon={<BookOpen/>} detail="Материалы для обучения"/><Stat label="Изучено глав" value={completed} icon={<CheckCircle2/>} detail={`из ${totalChapters} доступных`}/><Stat label={teacher?'Завершено попыток':'Пройдено тестов'} value={dashboard.results.length} icon={<ClipboardCheck/>} detail="Практика по главам"/><Stat label="Средний результат" value={avg===null?'—':`${avg}%`} icon={<BarChart3/>} detail={avg===null?'Появится после первого теста':'По завершённым попыткам'}/></div>
          {dashboard.active.length>0&&<div className="resume-card"><Clock/><div><strong>Есть незавершённый тест</strong><p>{dashboard.active[0].title}</p></div><button className="btn secondary" onClick={()=>navigate({view:'attempt',attempt:dashboard.active[0].id})}>Продолжить</button></div>}
          {books[0]&&<div className="learning-banner"><div className="banner-icon"><BookOpen size={42}/></div><div><span className="pill light">{teacher?'УЧЕБНЫЕ МАТЕРИАЛЫ':'ТВОЙ СЛЕДУЮЩИЙ ШАГ'}</span><h2>{teacher?'Одна книга. Много открытий.':'Не просто прочитать — разобраться.'}</h2><p>{teacher?'Загрузите учебник, и каждая глава станет отдельным уроком с ИИ и проверкой знаний.':'Читай в своём темпе. Если что-то непонятно, репетитор поможет на примере из главы.'}</p><button className="btn white" onClick={()=>teacher?setUploadOpen(true):openBook(books[0])}>{teacher?'Добавить материал':'Открыть книгу'}<BookOpen size={17}/></button></div><div className="banner-orbit" aria-hidden="true"><span>Аа</span><span>× ÷</span><span><Sparkles/></span></div></div>}
        </>}
        <div className="section-heading"><div><h2>{nav.view==='home'?'Начни с книги':'Все учебные материалы'}</h2><p>{books.length} {books.length===1?'книга':'книг'} · PDF, EPUB, DOCX и текст</p></div>{nav.view==='home'&&<button className="text-btn" onClick={()=>navigate({view:'library'})}>Вся библиотека<ChevronRight size={17}/></button>}</div>
        <div className="library-tools"><label className="search-box"><Search size={19}/><input aria-label="Поиск книг" placeholder="Найти книгу или предмет" value={search} onChange={e=>setSearch(e.target.value)}/></label><select aria-label="Фильтр по классу" value={grade} onChange={e=>setGrade(e.target.value)}><option value="all">Все классы</option>{Array.from({length:12},(_,i)=><option key={i} value={i+1}>{i+1} класс</option>)}</select><span className="small muted">{filtered.length} материалов</span></div>
        <div className="books-grid">{filtered.map(book=><BookCard key={book.id} book={book} onOpen={()=>openBook(book)}/>)}</div>
        {!filtered.length&&<Empty icon={<Library size={38}/>} title="Книг пока нет" text={search?'Попробуйте другой запрос.':teacher?'Добавьте первую книгу, чтобы начать обучение.':'Учитель скоро добавит учебные материалы.'}/>} 
        {nav.view==='home'&&<div className="how-it-works"><h3>Три шага к пониманию</h3>{['Прочитай главу','Разбери сложное с ИИ','Закрепи знания тестом'].map((s,i)=><div key={s}><span>{i+1}</span>{s}</div>)}</div>}
      </>}

      {nav.view==='reader'&&detail&&chapter&&<>
        <div className="reader-heading"><button className="text-btn" onClick={()=>navigate({view:'library'})}><ChevronLeft size={16}/>Библиотека</button><span className="muted small">{chapter.bookTitle}</span>{detail.book.owner_id&&<a className="text-btn" href={`/api/books/${detail.book.id}/file`}><Download size={16}/>Файл книги</a>}{teacher&&detail.book.owner_id===user.id&&<button className="icon-btn danger" aria-label="Удалить книгу" onClick={()=>{if(window.confirm('Удалить книгу, главы и связанные результаты?'))run('delete',async()=>{await api(`books/${detail.book.id}`,{method:'DELETE'});await refresh();navigate({view:'library'});});}}><Trash2 size={17}/></button>}</div>
        <div className="reader-grid"><aside className="chapter-panel"><div className="chapter-panel-heading"><BookOpen size={19}/><strong>Содержание</strong></div><p className="small muted">{detail.chapters.filter(c=>c.studied).length} из {detail.chapters.length} глав изучено</p><div className="progress-track"><span style={{width:`${detail.chapters.filter(c=>c.studied).length/detail.chapters.length*100}%`}}/></div><nav aria-label="Главы книги">{detail.chapters.map((c,i)=><button className={`chapter-item ${c.id===chapter.id?'selected':''}`} key={c.id} onClick={()=>{setChapter(null);navigate({view:'reader',book:nav.book,chapter:c.id});}}><span className={`chapter-number ${c.studied?'done':''}`}>{c.studied?<Check size={14}/>:i+1}</span><span>{c.title}<small>{Math.max(1,Math.ceil(c.characters/900))} мин чтения</small></span></button>)}</nav><div className="chapter-tip"><Lightbulb size={19}/><p>Сначала прочитайте материал. Потом обсудите его с репетитором и переходите к практике.</p></div></aside>
          <article className="reading-panel"><div className="reading-toolbar"><span className="pill">Глава {chapter.position+1}</span><div className="reader-font"><button aria-label="Уменьшить шрифт" onClick={()=>setReaderSize(v=>Math.max(16,v-2))}>А−</button><button aria-label="Увеличить шрифт" onClick={()=>setReaderSize(v=>Math.min(26,v+2))}>А+</button></div></div><h1>{chapter.title}</h1><div className="reading-meta"><Clock size={15}/>{Math.max(1,Math.ceil(chapter.content.length/900))} мин чтения<span>·</span>{chapter.grade} класс{chapter.studied&&<span className="studied-label"><CheckCircle2 size={15}/>Изучено</span>}</div><div className="chapter-text" style={{fontSize:readerSize}}>{chapter.content.split(/\n\s*\n/).map((p,i)=><p key={i}>{p}</p>)}</div><div className="study-footer"><div><CheckCircle2 size={23}/><h3>{chapter.studied?'Глава изучена. Пора практиковаться!':'Всё понятно? Закрепим знания.'}</h3><p>После изучения главы ИИ подготовит тест по этому материалу.</p></div><button className="btn primary" disabled={Boolean(busy)} onClick={learnDone}>{busy==='generate'?<Spinner/>:<ClipboardCheck size={18}/>} {busy==='generate'?'Готовим тест…':teacher?'Подготовить тест':chapter.studied?'Пройти тест':'Глава изучена'}</button></div>{teacher&&(!detail.book.owner_id||detail.book.owner_id===user.id)&&<div className="teacher-test-tools"><button className="btn secondary" onClick={()=>setManualOpen(true)}><Pencil size={17}/>Создать тест вручную</button><button className="text-btn" disabled={Boolean(busy)} onClick={()=>run('generate',async()=>{await api('tests/generate',post({chapterId:chapter.id,count:5,duration:10,automatic:false}));setNotice('Новый тест создан.');})}><Sparkles size={17}/>Ещё один тест с ИИ</button></div>}</article>
          <aside className="tutor-panel"><div className="tutor-header"><span className="ai-icon"><Sparkles size={21}/></span><div><h3>Твой ИИ-репетитор</h3><p>Разберём эту главу вместе</p></div></div><div className="tutor-source"><BookOpen size={14}/><span>{chapter.title}</span></div><div className="chat-messages" aria-live="polite">{messages.length===0&&<div className="tutor-welcome"><span className="ai-welcome"><Sparkles size={30}/></span><h3>Что разберём?</h3><p>Я помогу понять материал, покажу пример и дам упражнение по этой главе.</p><div className="quick-prompts"><button disabled={tutorBusy} onClick={()=>sendTutor('explain','Объясни эту главу простыми словами')}><Lightbulb size={17}/>Объясни проще</button><button disabled={tutorBusy} onClick={()=>sendTutor('example','Покажи пример по этой главе')}><Pencil size={17}/>Разбери пример</button><button disabled={tutorBusy} onClick={()=>sendTutor('practice','Дай упражнение для самостоятельного решения')}><ClipboardCheck size={17}/>Дай упражнение</button></div></div>}{messages.map((m,i)=><div className={`chat-message ${m.role}`} key={i}>{m.role==='assistant'&&<span className="message-avatar"><Sparkles size={14}/></span>}<div>{m.content.split('\n').map((p,j)=><p key={j}>{p}</p>)}</div></div>)}{tutorBusy&&<div className="thinking"><Spinner/>Разбираемся…</div>}<div ref={messagesEnd}/></div><form className="chat-form" onSubmit={e=>{e.preventDefault();sendTutor();}}><textarea aria-label="Вопрос репетитору" placeholder="Что осталось непонятным?" value={message} onChange={e=>setMessage(e.target.value)} maxLength={1500} rows={2}/><button className="btn primary" aria-label="Отправить вопрос" disabled={!message.trim()||tutorBusy}><Send size={18}/></button></form><p className="ai-note">ИИ может ошибаться. Сверяйте объяснения с текстом главы. Репетитор получает только выбранную главу и последние сообщения.</p></aside>
        </div>
      </>}

      {nav.view==='tests'&&<><div className="page-heading"><div><div className="eyebrow">ОТ ЧТЕНИЯ К ПРАКТИКЕ</div><h1>Проверь свои знания</h1><p>{teacher?'Тесты доступны ученикам после изучения соответствующей главы.':'Здесь появляются тесты по изученным главам. Можно повторять для закрепления.'}</p></div></div><div className="tests-grid">{tests.map(test=><div className="test-card" key={test.id}><span className="test-icon"><ClipboardCheck size={25}/></span><span className="small muted">{test.bookTitle}</span><h3>{test.title}</h3><div className="test-meta"><span><ClipboardCheck size={15}/>{test.questionCount} вопросов</span><span><Clock size={15}/>{test.duration} мин</span></div>{teacher?<span className="pill">Готов для учеников</span>:<button className="btn primary" disabled={Boolean(busy)} onClick={()=>run('start',async()=>{const d=await api<{id:string}>(`tests/${test.id}/start`,post({}));setAttempt(null);navigate({view:'attempt',attempt:d.id});})}>Пройти тест<ChevronRight size={17}/></button>}</div>)}</div>{!tests.length&&<Empty icon={<ClipboardCheck size={38}/>} title="Практика впереди" text="Откройте книгу и изучите главу. После этого появится тест." action={<button className="btn primary" onClick={()=>navigate({view:'library'})}>Открыть библиотеку</button>}/>}</>}

      {nav.view==='results'&&<><div className="page-heading"><div><div className="eyebrow">КАЖДАЯ ПОПЫТКА — ШАГ ВПЕРЁД</div><h1>{teacher?'Результаты учеников':'Мой прогресс'}</h1><p>{teacher?'Завершённые попытки по вашим книгам и общей учебной книге.':'История практики. Открой результат, чтобы разобрать ответы.'}</p></div></div><div className="results-summary"><Stat label="Завершено попыток" value={dashboard.results.length} icon={<ClipboardCheck/>} detail="Все сохранённые результаты"/><Stat label="Средний балл" value={avg===null?'—':`${avg}%`} icon={<BarChart3/>} detail="По показанным попыткам"/>{teacher&&<Stat label="Уникальных учеников" value={new Set(dashboard.results.map(r=>r.studentId)).size} icon={<GraduationCap/>} detail="С завершёнными попытками"/>}</div>{dashboard.results.length?<div className="results-table"><table><thead><tr><th>{teacher?'Ученик / тест':'Тест'}</th><th>Книга</th><th>Результат</th><th>Дата</th></tr></thead><tbody>{dashboard.results.map(r=><tr key={r.id}><td>{teacher&&<strong>{r.studentName}<br/></strong>}{teacher?r.title:<button className="table-link" onClick={()=>navigate({view:'attempt',attempt:r.id})}>{r.title}</button>}</td><td>{r.bookTitle}</td><td><span className={`score-badge ${percentage(r)>=70?'good':'neutral'}`}>{r.score}/{r.maxScore} · {percentage(r)}%</span></td><td>{date(r.completedAt)}</td></tr>)}</tbody></table></div>:<Empty icon={<BarChart3 size={38}/>} title="Начало новой истории" text="После первого теста здесь появятся результаты."/>}</>}

      {nav.view==='attempt'&&attempt&&<>
        {attempt.status==='finished'?<div className="result-page"><div className="result-hero"><div className="result-medal"><GraduationCap size={46}/></div><span className="eyebrow">ТЕСТ ЗАВЕРШЁН</span><h1>{percentage({score:attempt.score||0,maxScore:attempt.maxScore||0})>=70?'Отличная работа!':'Продолжай практиковаться!'}</h1><p>{attempt.title}</p><div className="result-score">{attempt.score}<span> / {attempt.maxScore}</span></div><span className="pill">{percentage({score:attempt.score||0,maxScore:attempt.maxScore||0})}% правильных ответов</span><button className="btn primary" onClick={()=>navigate({view:'results'})}>Мой прогресс</button></div><div className="feedback-list"><h2>Разберём ответы</h2>{attempt.feedback?.map((q,i)=><div className="feedback-card" key={q.id}><div className="feedback-title">{q.selected===q.correct?<CheckCircle2 className="green"/>:<AlertCircle className="orange"/>}<h3>{i+1}. {q.text}</h3></div><p><strong>Твой ответ:</strong> {q.selected===undefined?'Нет ответа':q.options[q.selected]}</p><p><strong>Правильный ответ:</strong> {q.options[q.correct]}</p><div className="explanation"><Lightbulb size={17}/>{q.explanation}</div></div>)}</div></div>:
          <div className="attempt-page"><div className="attempt-heading"><div><div className="eyebrow">ПРОВЕРКА ЗНАНИЙ</div><h1>{attempt.title}</h1></div><div className={`timer ${Date.parse(attempt.deadline)-now<60000?'low':''}`}><Clock size={20}/>{Math.max(0,Math.floor((Date.parse(attempt.deadline)-now)/60000)).toString().padStart(2,'0')}:{Math.max(0,Math.floor((Date.parse(attempt.deadline)-now)/1000)%60).toString().padStart(2,'0')}</div></div><div className="attempt-info"><span>Вопрос {current+1} из {attempt.questions.length}</span><span>{Object.keys(answers).length} отвечено</span></div><div className="progress-track"><span style={{width:`${(current+1)/attempt.questions.length*100}%`}}/></div><div className="question-card"><span className="pill">Вопрос {current+1}</span><h2>{attempt.questions[current].text}</h2><div className="answer-options">{attempt.questions[current].options.map((option,i)=><button disabled={Boolean(busy)} className={`answer-option ${answers[attempt.questions[current].id]===i?'chosen':''}`} key={i} onClick={()=>chooseAnswer(attempt.questions[current].id,i)}><span>{['А','Б','В','Г'][i]}</span><strong>{option}</strong>{answers[attempt.questions[current].id]===i&&<CheckCircle2 size={20}/>}</button>)}</div><div className="answer-save" aria-live="polite">{busy==='answer'?<><Spinner/>Сохраняем ответ…</>:saveError?<span className="orange">{saveError} Повторите выбор или завершите тест для сохранения.</span>:<><Check size={15}/>Ответы сохраняются. При возвращении таймер продолжится.</>}</div><div className="attempt-buttons"><button className="btn secondary" disabled={current===0||Boolean(busy)} onClick={()=>setCurrent(c=>c-1)}><ChevronLeft size={18}/>Назад</button>{current<attempt.questions.length-1?<button className="btn primary" disabled={Boolean(busy)} onClick={()=>setCurrent(c=>c+1)}>Далее<ChevronRight size={18}/></button>:<button className="btn primary" disabled={Boolean(busy)} onClick={()=>{if(Object.keys(answers).length<attempt.questions.length&&!window.confirm('Есть вопросы без ответа. Всё равно завершить?'))return;finishAttempt();}}>{busy==='finish'?<Spinner/>:<Check size={18}/>}Завершить тест</button>}</div></div><div className="question-dots">{attempt.questions.map((q,i)=><button aria-label={`Перейти к вопросу ${i+1}`} className={`${current===i?'current':''} ${answers[q.id]!==undefined?'answered':''}`} key={q.id} onClick={()=>setCurrent(i)}>{i+1}</button>)}</div></div>}
      </>}
    </main><footer className="app-footer"><span>EduTest · учимся с пониманием</span><span>Книги. Диалог. Практика.</span></footer></div>
    {uploadOpen&&<UploadDialog onClose={()=>setUploadOpen(false)} onSaved={async id=>{setUploadOpen(false);await refresh();navigate({view:'reader',book:id});}}/>}
    {manualOpen&&chapter&&<ManualDialog chapterId={chapter.id} onClose={()=>setManualOpen(false)} onSaved={()=>{setManualOpen(false);setNotice('Тест сохранён. Ученики увидят его после изучения главы.');}}/>}
  </div>;
}

function Stat({label,value,icon,detail}:{label:string;value:string|number;icon:React.ReactNode;detail:string}) {return <div className="stat-card"><div className="stat-top"><span>{label}</span><div>{icon}</div></div><strong>{value}</strong><small>{detail}</small></div>;}
function BookCard({book,onOpen}:{book:Book;onOpen:()=>void}) {
  const pct=book.chapters?Math.round(book.completed/book.chapters*100):0;
  return <button className="book-card" onClick={onOpen}><div className={`book-cover cover-${book.color%5}`}><span className="cover-class">{book.grade} КЛАСС</span><div className="cover-symbol">{book.subject.toLowerCase().includes('матем')?'× ÷':book.subject.toLowerCase().includes('истор')?'§':'Аа'}</div><strong>{book.title}</strong><span className="cover-subject">{book.subject}</span><BookOpen className="cover-book" size={74} strokeWidth={1}/></div><div className="book-info"><div className="book-tags"><span>{book.subject}</span><span>{book.grade} класс</span></div><h3>{book.title}</h3><div className="book-meta"><span>{book.chapters} глав</span><span>{book.completed?`${book.completed} изучено`:'Начни знакомство'}</span></div><div className="progress-track"><span style={{width:`${pct}%`}}/></div><div className="book-open"><span>{pct?'Продолжить чтение':'Открыть книгу'}</span><ChevronRight size={17}/></div></div></button>;
}
function Empty({icon,title,text,action}:{icon:React.ReactNode;title:string;text:string;action?:React.ReactNode}) {return <div className="empty-state"><div>{icon}</div><h2>{title}</h2><p>{text}</p>{action}</div>;}

function AuthScreen({error:initialError,onLogin}:{error:string;onLogin:()=>Promise<void>}) {
  const [register,setRegister]=useState(false),[role,setRole]=useState<'student'|'teacher'>('student'),[busy,setBusy]=useState(false),[error,setError]=useState(initialError);
  async function submit(e:React.FormEvent<HTMLFormElement>) {
    e.preventDefault();const data=new FormData(e.currentTarget);setBusy(true);setError('');
    try{await api('auth',post({action:register?'register':'login',name:register?data.get('name'):undefined,email:data.get('email'),password:data.get('password'),role,inviteCode:data.get('inviteCode')||undefined}));await onLogin();}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <div className="auth-page"><section className="auth-story"><Logo/><div className="auth-story-content"><div className="pill light">КНИГА — ТОЛЬКО НАЧАЛО</div><h1>Понимать.<br/>Пробовать.<br/><span>Открывать новое.</span></h1><p>Твоя учебная библиотека, репетитор и практика. Учись в своём темпе — глава за главой.</p><div className="auth-books" aria-hidden="true"><div>5<span>МАТЕМАТИКА</span><BookOpen size={45}/></div><div>Аа<span>ЛИТЕРАТУРА</span><Pencil size={40}/></div><div>§<span>ИСТОРИЯ</span><GraduationCap size={43}/></div></div><div className="auth-features"><span><CheckCircle2 size={17}/>Книги внутри платформы</span><span><CheckCircle2 size={17}/>Тесты по изученным главам</span></div></div><p className="auth-copyright">EduTest · учебное пространство</p></section><section className="auth-form-panel"><div className="auth-mobile-logo"><Logo/></div><div className="auth-form-wrap"><span className="auth-greeting"><GraduationCap size={26}/></span><h2>{register?'Начнём учиться':'Рады видеть тебя'}</h2><p>{register?'Создай аккаунт для доступа к библиотеке.':'Войди, чтобы продолжить с того места, где остановился.'}</p><div className="auth-tabs"><button className={!register?'active':''} onClick={()=>{setRegister(false);setError('');}}>Вход</button><button className={register?'active':''} onClick={()=>{setRegister(true);setError('');}}>Регистрация</button></div><form onSubmit={submit}>{register&&<><label>Имя<input name="name" required minLength={2} maxLength={80} autoComplete="name" placeholder="Как тебя зовут?"/></label><fieldset className="role-picker"><legend>Я на платформе</legend><button type="button" className={role==='student'?'selected':''} onClick={()=>setRole('student')}><GraduationCap size={20}/>Ученик</button><button type="button" className={role==='teacher'?'selected':''} onClick={()=>setRole('teacher')}><BookOpen size={20}/>Учитель</button></fieldset></>}<label>Email<input name="email" required type="email" maxLength={254} autoComplete="email" placeholder="name@example.com"/></label><label>Пароль<input name="password" required type="password" minLength={10} maxLength={128} autoComplete={register?'new-password':'current-password'} placeholder={register?'Минимум 10 символов':'Твой пароль'}/></label>{register&&role==='teacher'&&<label>Код приглашения учителя<input name="inviteCode" required autoComplete="off" placeholder="Код от администратора"/><small>Код защищает доступ к добавлению книг.</small></label>}{error&&<div className="form-error" role="alert"><AlertCircle size={17}/>{error}</div>}<button className="btn primary full" disabled={busy}>{busy?<Spinner/>:<BookOpen size={18}/>} {register?'Создать аккаунт':'Войти в EduTest'}</button></form><p className="auth-privacy">Пароли защищены хешированием. Книги доступны участникам этой учебной платформы.</p></div></section></div>;
}

function UploadDialog({onClose,onSaved}:{onClose:()=>void;onSaved:(id:string)=>Promise<void>}) {
  const [file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [title,setTitle]=useState('');
  async function submit(e:React.FormEvent<HTMLFormElement>) {
    e.preventDefault();if(!file){setError('Выберите файл книги');return;}setBusy(true);setError('');
    const data=new FormData(e.currentTarget);data.set('file',file);
    try{const result=await api<{id:string}>('books',{method:'POST',body:data});await onSaved(result.id);}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  function select(file:File|undefined){if(!file)return;if(file.size>4*1024*1024){setError('Файл должен быть не больше 4 МБ');return;}setError('');setFile(file);if(!title)setTitle(file.name.replace(/\.[^.]+$/,''));}
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="upload-title"><div className="modal-heading"><div><span className="eyebrow">НОВЫЙ УЧЕБНЫЙ МАТЕРИАЛ</span><h2 id="upload-title">Добавить книгу</h2></div><button className="icon-btn" aria-label="Закрыть" disabled={busy} onClick={onClose}><X/></button></div><form onSubmit={submit}><label className={`dropzone ${file?'has-file':''}`} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();select(e.dataTransfer.files[0]);}}><Upload size={28}/><strong>{file?file.name:'Выбери файл или перетащи сюда'}</strong><span>PDF с текстом, EPUB, DOCX, TXT, MD · до 4 МБ</span><input aria-label="Файл книги" type="file" accept=".pdf,.epub,.docx,.txt,.md" onChange={e=>select(e.target.files?.[0])}/></label><label>Название книги<input name="title" value={title} onChange={e=>setTitle(e.target.value)} required minLength={2} maxLength={150} placeholder="Например, Математика. 5 класс"/></label><div className="form-row"><label>Предмет<input name="subject" required minLength={2} maxLength={80} placeholder="Математика"/></label><label>Класс<select name="grade" defaultValue="5">{Array.from({length:12},(_,i)=><option value={i+1} key={i}>{i+1} класс</option>)}</select></label></div><div className="upload-info"><Sparkles size={19}/><p>Книга разделится на главы. Ученики смогут читать её здесь, задавать вопросы и получать тест после изучения главы.</p></div><p className="small muted">Добавляйте материалы, которые вы вправе использовать. Скан без распознанного текста сначала нужно обработать OCR.</p>{error&&<div className="form-error" role="alert">{error}</div>}<div className="modal-actions"><button type="button" className="btn secondary" disabled={busy} onClick={onClose}>Отмена</button><button className="btn primary" disabled={busy}>{busy?<Spinner/>:<Plus size={18}/>} {busy?'Читаем книгу…':'Добавить в библиотеку'}</button></div></form></section></div>;
}
function ManualDialog({chapterId,onClose,onSaved}:{chapterId:string;onClose:()=>void;onSaved:()=>void}) {
  const blank=()=>({text:'',options:['','','',''],correct:0,explanation:''});
  const [questions,setQuestions]=useState<Omit<Question,'id'>[]>([blank()]),[title,setTitle]=useState('Проверка знаний'),[duration,setDuration]=useState(10),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const update=(i:number,patch:Partial<Omit<Question,'id'>>)=>setQuestions(old=>old.map((q,index)=>index===i?{...q,...patch}:q));
  async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{await api('tests/manual',post({chapterId,title,duration,questions}));onSaved();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <div className="modal-backdrop"><section className="modal manual-modal" role="dialog" aria-modal="true" aria-labelledby="manual-title"><div className="modal-heading"><h2 id="manual-title">Создать тест вручную</h2><button className="icon-btn" aria-label="Закрыть" onClick={onClose} disabled={busy}><X/></button></div><form onSubmit={submit}><div className="form-row"><label>Название<input value={title} onChange={e=>setTitle(e.target.value)} minLength={2} maxLength={150} required/></label><label>Время, минут<input type="number" min={1} max={120} value={duration} onChange={e=>setDuration(Number(e.target.value))} required/></label></div>{questions.map((q,i)=><fieldset className="manual-question" key={i}><legend>Вопрос {i+1}</legend><label>Текст вопроса<textarea value={q.text} onChange={e=>update(i,{text:e.target.value})} required minLength={5} maxLength={1000}/></label>{q.options.map((option,j)=><label className="manual-option" key={j}><input aria-label={`Правильный вариант ${j+1} вопроса ${i+1}`} type="radio" name={`correct-${i}`} checked={q.correct===j} onChange={()=>update(i,{correct:j})}/><span>{['А','Б','В','Г'][j]}</span><input aria-label={`Вариант ${j+1} вопроса ${i+1}`} value={option} onChange={e=>update(i,{options:q.options.map((v,k)=>k===j?e.target.value:v)})} required maxLength={600}/></label>)}<label>Пояснение ответа<textarea value={q.explanation} onChange={e=>update(i,{explanation:e.target.value})} required minLength={5} maxLength={1500}/></label>{questions.length>1&&<button type="button" className="text-btn danger" onClick={()=>setQuestions(old=>old.filter((_,index)=>index!==i))}>Удалить вопрос</button>}</fieldset>)}{questions.length<10&&<button type="button" className="btn secondary" onClick={()=>setQuestions(old=>[...old,blank()])}><Plus size={17}/>Ещё вопрос</button>}{error&&<div className="form-error" role="alert">{error}</div>}<div className="modal-actions"><button type="button" className="btn secondary" onClick={onClose} disabled={busy}>Отмена</button><button className="btn primary" disabled={busy}>{busy?<Spinner/>:<Check size={18}/>}Сохранить тест</button></div></form></section></div>;
}

