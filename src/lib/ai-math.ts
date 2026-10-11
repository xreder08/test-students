import type {Question} from './types';

// For a direct comparison of the same two decimal numbers, overlapping
// relations (for example < and ≠) cannot be separate correct answers.
export function normalizeNumericComparison(question:Omit<Question,'id'>,source:string):Omit<Question,'id'> {
  if(!/сравн|знак|неравенств/i.test(question.text)||/неверн|ложн|ошиб|неправильн/i.test(question.text))return question;
  const pairs=question.options.map(option=>option.replace(/\s/gu,'').match(/^(-?\d+(?:[.,]\d+)?)(?:<=|>=|!=|[<>=≠≤≥])(-?\d+(?:[.,]\d+)?)$/));
  if(pairs.some(pair=>!pair))return question;
  const left=pairs[0]![1],right=pairs[0]![2];
  if(!pairs.every(pair=>pair![1]===left&&pair![2]===right))return question;
  const a=Number(left.replace(',','.')),b=Number(right.replace(',','.'));
  if(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a)>Number.MAX_SAFE_INTEGER||Math.abs(b)>Number.MAX_SAFE_INTEGER)return question;
  const relation=a<b?'<':a>b?'>':'=';
  return {...question,options:[`${left} < ${right}`,`${left} > ${right}`,`${left} = ${right}`,'Недостаточно данных для сравнения'],correct:a<b?0:a>b?1:2,explanation:`${source}: сравниваем числа ${left} и ${right}; верная запись — ${left} ${relation} ${right}.`};
}
