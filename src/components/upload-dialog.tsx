'use client';
import {useEffect,useRef,useState} from 'react';
import {Upload,X,Sparkles,Plus,LoaderCircle} from 'lucide-react';
import {MAX_BOOK_BYTES,MAX_BOOK_MB,MAX_BOOK_TEXT} from '@/lib/book-limits';
import type {PdfText} from '@/lib/pdf-ocr';

export function UploadDialog({onClose,onSaved}:{onClose:()=>void;onSaved:(id:string)=>Promise<void>}) {
  const [file,setFile]=useState<File|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[title,setTitle]=useState('');
  const [language,setLanguage]=useState('rus+eng'),[force,setForce]=useState(false);
  const [progress,setProgress]=useState(''),[preview,setPreview]=useState<PdfText|null>(null);
  const processing=useRef<AbortController|null>(null);
  useEffect(()=>()=>processing.current?.abort(),[]);
  const pdf=file?.name.toLowerCase().endsWith('.pdf');
  function select(selected:File|undefined) {
    if(busy||!selected)return;
    setPreview(null);setProgress('');
    if(selected.size>MAX_BOOK_BYTES){setFile(null);setError(`Файл должен быть не больше ${MAX_BOOK_MB} МБ`);return;}
    setError('');setFile(selected);if(!title)setTitle(selected.name.replace(/\.[^.]+$/,''));
  }
  async function submit(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!file){setError('Выберите файл книги');return;}
    const data=new FormData(event.currentTarget);
    setBusy(true);setError('');
    try {
      if(pdf&&!preview) {
        const controller=new AbortController();processing.current=controller;
        setProgress('Открываем PDF…');
        const {recognizePdf}=await import('@/lib/pdf-ocr');
        const result=await recognizePdf(file,language.split('+'),force,setProgress,controller.signal);
        setPreview(result);setProgress('Текст готов. Проверьте его и сохраните книгу.');
        return;
      }
      data.set('file',file);
      if(preview)data.set('recognizedText',preview.text);
      setProgress('Сохраняем книгу в библиотеке…');
      const response=await fetch('/api/books',{method:'POST',body:data});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||'Не удалось сохранить книгу.');
      await onSaved(result.id);
    } catch(error) {
      setError((error as Error).message);setProgress('');
    } finally {processing.current=null;setBusy(false);}
  }
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="upload-title">
    <div className="modal-heading"><div><span className="eyebrow">НОВЫЙ УЧЕБНЫЙ МАТЕРИАЛ</span><h2 id="upload-title">Добавить книгу</h2></div><button className="icon-btn" aria-label="Закрыть" disabled={busy} onClick={onClose}><X/></button></div>
    <form onSubmit={submit}>
      <label className={`dropzone ${file?'has-file':''}`} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();select(event.dataTransfer.files[0]);}}>
        <Upload size={28}/><strong>{file?file.name:'Выбери файл или перетащи сюда'}</strong><span>PDF, включая сканы, EPUB, DOCX, TXT, MD · до {MAX_BOOK_MB} МБ</span>
        <input aria-label="Файл книги" type="file" disabled={busy} accept=".pdf,.epub,.docx,.txt,.md" onChange={event=>select(event.target.files?.[0])}/>
      </label>
      <label>Название книги<input name="title" value={title} disabled={busy} onChange={event=>setTitle(event.target.value)} required minLength={2} maxLength={150} placeholder="Например, Математика. 5 класс"/></label>
      <div className="form-row"><label>Предмет<input name="subject" disabled={busy} required minLength={2} maxLength={80} placeholder="Математика"/></label><label>Класс<select name="grade" disabled={busy} defaultValue="5">{Array.from({length:12},(_,i)=><option value={i+1} key={i}>{i+1} класс</option>)}</select></label></div>
      {pdf&&<div className="ocr-options"><label>Язык книги<select value={language} disabled={busy} onChange={event=>{setLanguage(event.target.value);setPreview(null);}}><option value="rus+eng">Русский и английский</option><option value="kaz+rus+eng">Казахский, русский и английский</option><option value="eng">Английский</option></select></label><label className="ocr-checkbox"><input type="checkbox" checked={force} disabled={busy} onChange={event=>{setForce(event.target.checked);setPreview(null);}}/>Распознать все страницы заново, даже если в PDF уже есть текст</label></div>}
      <div className="upload-info"><Sparkles size={19}/><p>{pdf?'Распознаём фотографии страниц прямо в браузере. Оставьте вкладку открытой: большой учебник может обрабатываться несколько минут.':'Книга разделится на главы. Ученики смогут читать её здесь, задавать вопросы и получать тест после изучения главы.'}</p></div>
      {progress&&<div className="ocr-progress" role="status" aria-live="polite">{busy&&<LoaderCircle size={18} className="spin"/>}{progress}</div>}
      {preview&&<div className="ocr-preview"><p>Обработано страниц: <strong>{preview.pages}</strong>. Распознано сканов: <strong>{preview.ocrPages}</strong>.{preview.unreadablePages>0&&` Без читаемого текста: ${preview.unreadablePages}.`}</p><p className="small muted">Проверьте формулы, дроби и таблицы: распознавание может ошибаться. Можно исправить текст перед сохранением. Страницы станут разделами для чтения и ИИ-обучения.</p><details><summary>Проверить и исправить текст книги</summary><textarea aria-label="Распознанный текст книги" value={preview.text} maxLength={MAX_BOOK_TEXT} rows={10} disabled={busy} onChange={event=>setPreview({...preview,text:event.target.value})}/></details></div>}
      <p className="small muted">Добавляйте материалы, которые вы вправе использовать. Страницы не отправляются стороннему сервису распознавания.</p>
      {error&&<div className="form-error" role="alert">{error}</div>}
      <div className="modal-actions"><button type="button" className="btn secondary" disabled={busy&&!processing.current} onClick={()=>busy?processing.current?.abort():onClose()}>{busy?'Отменить обработку':'Отмена'}</button><button className="btn primary" disabled={busy}>{busy?<LoaderCircle className="spin"/>:<Plus size={18}/>} {busy?'Обрабатываем…':preview?'Сохранить книгу':pdf?'Прочитать и распознать PDF':'Добавить в библиотеку'}</button></div>
    </form>
  </section></div>;
}
