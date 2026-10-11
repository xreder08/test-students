import test, {after, afterEach, mock} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {askAi} from '../src/lib/ai';
import {database, query} from '../src/lib/db';

// These requests use a fake provider and a separate disposable database.
process.env.DATABASE_URL=`file:test-results/ai-unit-${randomUUID()}.db`;
process.env.GROQ_API_KEY='fake-provider-key-for-tests';
afterEach(()=>mock.restoreAll());
after(()=>database().close());
const messages=[{role:'user' as const,content:'Create a JSON test with five questions.'}];
const success=()=>Response.json({choices:[{finish_reason:'stop',message:{content:'{"questions":[]}'}}]});

test('schema failure is retried once with the same schema and time budget',async()=>{
  const calls:RequestInit[]=[];
  mock.method(globalThis,'fetch',async(_url:unknown,options:RequestInit)=>{
    calls.push(options);
    return calls.length===1?Response.json({error:{code:'json_validate_failed'}},{status:400}):success();
  });
  const before=Number((await query('SELECT count FROM rate_limits WHERE bucket=?',['ai-global-day'])).rows[0]?.count??0);
  assert.equal(await askAi(messages,{count:5}),' {"questions":[]}'.trim());
  assert.equal(calls.length,2);
  assert.equal(calls[0].signal,calls[1].signal);
  assert.deepEqual(JSON.parse(calls[0].body as string),JSON.parse(calls[1].body as string));
  assert.equal(JSON.parse(calls[0].body as string).response_format.json_schema.strict,true);
  assert.equal(Number((await query('SELECT count FROM rate_limits WHERE bucket=?',['ai-global-day'])).rows[0].count),before+2);
});

test('temporary provider failure recovers with one retry',async()=>{
  let calls=0;
  mock.method(globalThis,'fetch',async()=>++calls===1?Response.json({}, {status:503}):success());
  await askAi(messages);assert.equal(calls,2);
});

test('quota and authentication errors are never retried',async()=>{
  for(const [providerStatus,appStatus]of [[429,429],[401,503],[403,503]]){
    let calls=0;
    mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({}, {status:providerStatus});});
    await assert.rejects(askAi(messages,{count:5}),(error:unknown)=>!!error&&typeof error==='object'&&'status'in error&&error.status===appStatus);
    assert.equal(calls,1);mock.restoreAll();
  }
});

test('repeated schema failure stops after two requests',async()=>{
  let calls=0;
  mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:{code:'json_validate_failed'}},{status:400});});
  await assert.rejects(askAi(messages,{count:5}),(error:unknown)=>!!error&&typeof error==='object'&&'status'in error&&error.status===502);
  assert.equal(calls,2);
});

test('malformed successful provider response is a controlled error',async()=>{
  mock.method(globalThis,'fetch',async()=>new Response('not JSON',{status:200}));
  await assert.rejects(askAi(messages),(error:unknown)=>!!error&&typeof error==='object'&&'status'in error&&error.status===502);
});
