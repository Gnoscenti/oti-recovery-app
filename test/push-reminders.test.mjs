import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createReminderHandler,reminderPayload} from '../supabase/functions/event-reminders/dispatch.mjs';
const now=Date.parse('2026-10-06T19:00:00Z');
const job={job_id:'job',lease:'lease',endpoint:'https://fcm.googleapis.com/fcm/send/secret',p256dh:'secret',auth_key:'secret',starts_at:new Date(now+3600000).toISOString()};
test('scheduler rejects unsigned requests and never trusts client-supplied recipient data',async()=>{
 let calls=0;const handle=createReminderHandler({secret:'cron-secret',claim:async()=>{calls++;return [];},send:()=>{},finish:()=>{}});
 assert.equal((await handle(new Request('https://example.org',{method:'POST'}))).status,401);
 assert.equal((await handle(new Request('https://example.org',{headers:{Authorization:'Bearer cron-secret'}}))).status,405);
 assert.equal(calls,0);
});
test('reminder sender uses generic payload, short TTL and permanently prunes expired endpoints',async()=>{
 const sent=[],finished=[];const handle=createReminderHandler({secret:'cron-secret',now:()=>now,claim:async()=>[job,{...job,job_id:'expired'}],send:async(subscription,payload,ttl)=>{sent.push({payload,ttl});if(sent.length===2)throw Object.assign(new Error('private provider details'),{statusCode:410});},finish:async(...args)=>{finished.push(args);}});
 const response=await handle(new Request('https://example.org',{method:'POST',headers:{Authorization:'Bearer cron-secret'},body:JSON.stringify({recipient:'spoof'})}));assert.deepEqual(await response.json(),{sent:1,failed:1});
 assert.equal(sent[0].ttl,300);assert.deepEqual(JSON.parse(sent[0].payload),JSON.parse(reminderPayload(job.starts_at)));assert.equal(finished[1][2],true);
 assert.doesNotMatch(sent[0].payload,/cohort|participant|secret|recipient|event_id/);
});
test('service worker does not display private payload text and opens only the calendar route',async()=>{
 const handlers={},notifications=[],opened=[];
 const sw=await readFile(new URL('../www/sw.js',import.meta.url),'utf8');
 const self={addEventListener:(type,fn)=>{handlers[type]=fn;},location:{origin:'https://app.example.org'},registration:{showNotification:async(title,options)=>notifications.push({title,...options})},clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)}};
 vm.runInNewContext(sw,{self,Date,URL,Number});
 let task;handlers.push({data:{json:()=>({title:'Private participant name',body:'Private cohort text',url:'https://attacker.example',expires_at:new Date(Date.now()+3600000).toISOString()})},waitUntil:p=>task=p});await task;
 assert.equal(notifications[0].title,'Event reminder');assert.doesNotMatch(JSON.stringify(notifications),/Private|attacker/);
 handlers.notificationclick({notification:{close(){}},waitUntil:p=>task=p});await task;assert.deepEqual(opened,['https://app.example.org/#calendar']);
});
