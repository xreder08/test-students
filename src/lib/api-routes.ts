import {AppError} from './errors';
export function checkRoute(path:string[],method:string) {
  const [resource,id,action]=path;
  let methods:string[]|undefined;
  if(path.length===1)methods=({auth:['GET','POST'],dashboard:['GET'],books:['GET','POST'],tutor:['POST'],tests:['GET']} as Record<string,string[]>)[resource];
  if(path.length===2) {
    if(resource==='books')methods=['GET','DELETE'];
    if(resource==='chapters')methods=['GET'];
    if(resource==='attempts')methods=['GET','PATCH','POST'];
    if(resource==='tests'&&['generate','manual'].includes(id))methods=['POST'];
  }
  if(path.length===3) {
    if(resource==='books'&&action==='file')methods=['GET'];
    if(resource==='chapters'&&action==='study')methods=['POST'];
    if(resource==='tests'&&action==='start')methods=['POST'];
  }
  if(!methods)throw new AppError('Страница не найдена',404);
  if(!methods.includes(method))throw new AppError('Метод не поддерживается',405);
}
