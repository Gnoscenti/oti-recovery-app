import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();const ids={};let cid,eid,sid;
async function service(){await db.exec('reset role');await db.query("select set_config('request.jwt.claims','',false)");}
async function as(name){await service();if(name)await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:ids[name]})]);await db.exec(`set role ${name?'authenticated':'anon'}`);}
const key='A'.repeat(87),auth='B'.repeat(22);
before(async()=>{
 await db.exec(`create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::json->>'sub')::uuid$$;create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;create publication supabase_realtime;`);
 for(const file of ['schema.sql','seed.sql','cohorts.sql','admin-reminders.sql'])await db.exec(await readFile(new URL('../supabase/'+file,import.meta.url),'utf8'));
 for(const [name,role] of [['admin','admin'],['coach','coach'],['participant','participant'],['unassigned','participant'],['board','board']]){ids[name]=(await db.query('insert into auth.users values(gen_random_uuid(),$1) returning id',[name+'@example.org'])).rows[0].id;await db.query('update public.profiles set role=$1,display_name=$2,accepted_guidelines_at=now() where id=$3',[role,name,ids[name]]);}
 await as('admin');cid=(await db.query("select public.create_cohort('Test cohort',now()-interval '1 day',now()+interval '6 months') as id")).rows[0].id;
 await db.query("select public.assign_cohort_by_login($1,' PARTICIPANT@EXAMPLE.ORG ',true)",[cid]);
 eid=(await db.query("insert into public.cohort_events(cohort_id,title,starts_at,ends_at) values($1,'Private event',now()+interval '59 minutes',now()+interval '2 hours') returning id",[cid])).rows[0].id;
});
after(()=>db.close());

test('login-email assignment and pre-sign-in registration are staff authorized; unassigned participants see no cohort calendar',async()=>{
 await as('unassigned');assert.equal((await db.query('select * from public.cohort_events')).rows.length,0);assert.equal((await db.query('select * from public.cohort_members')).rows.length,0);
 await assert.rejects(db.query("select public.assign_cohort_by_login($1,'unassigned@example.org',true)",[cid]),/not_allowed/);
 await assert.rejects(db.query("select public.register_participant('other@example.org',$1)",[cid]),/not_allowed/);
 await as('coach');await db.query("select public.assign_cohort_by_login($1,'unassigned@example.org',true)",[cid]);await assert.rejects(db.query("select public.register_participant('future@example.org',$1)",[cid]),/not_allowed/);
 await as('unassigned');assert.equal((await db.query('select * from public.cohort_events')).rows.length,1);
 await as('admin');await db.query("select public.register_participant('future@example.org',$1)",[cid]);
 await service();const uid=(await db.query("insert into auth.users values(gen_random_uuid(),'future@example.org') returning id")).rows[0].id;
 assert.equal((await db.query('select * from public.cohort_members where user_id=$1',[uid])).rows.length,1);
 assert.equal((await db.query('select * from public.pending_cohort_assignments')).rows.length,0);
 await as('admin');await assert.rejects(db.query("select public.register_participant('coach@example.org',$1)",[cid]),/existing staff/);
});

test('admin portal role changes, immutable audit and participant discussions remain separated',async()=>{
 await as('participant');await assert.rejects(db.query("select public.manage_participant($1,'admin','active')",[ids.participant]),/not_allowed/);assert.equal((await db.query('select * from public.admin_audit')).rows.length,0);
 await as('coach');assert.equal((await db.query('select * from public.admin_audit')).rows.length,0);await assert.rejects(db.query("select public.manage_participant($1,'admin','active')",[ids.participant]),/not_allowed/);
 await as('admin');assert.ok((await db.query('select * from public.admin_audit')).rows.length>0);assert.equal((await db.query('select * from public.channels')).rows.length,0);
 await assert.rejects(db.query("update public.admin_audit set action='spoofed'"),/permission denied/);
 await assert.rejects(db.query("select public.manage_participant($1,'participant','active')",[ids.admin]),/own staff/);
 await assert.rejects(db.query("update public.profiles set status='removed' where id=$1",[ids.admin]),/last active admin/);
 await db.query("select public.manage_participant($1,'participant','removed')",[ids.unassigned]);
 await as('unassigned');assert.equal((await db.query('select * from public.cohort_events')).rows.length,0);
});

test('push device records are private and immutable in owner identity; endpoints cannot target arbitrary servers',async()=>{
 await as('participant');sid=(await db.query('insert into public.push_subscriptions(user_id,endpoint,p256dh,auth_key) values($1,$2,$3,$4) returning id',[ids.participant,'https://fcm.googleapis.com/fcm/send/test',key,auth])).rows[0].id;
 await assert.rejects(db.query('update public.push_subscriptions set user_id=$1',[ids.coach]),/permission denied/);
 await assert.rejects(db.query('insert into public.push_subscriptions(user_id,endpoint,p256dh,auth_key) values($1,$2,$3,$4)',[ids.coach,'https://fcm.googleapis.com/fcm/send/spoof',key,auth]),/row-level security/);
 await assert.rejects(db.query('insert into public.push_subscriptions(user_id,endpoint,p256dh,auth_key) values($1,$2,$3,$4)',[ids.participant,'https://localhost/private',key,auth]),/check constraint/);
 await as('admin');assert.equal((await db.query('select * from public.push_subscriptions')).rows.length,0);
 await as('board');assert.equal((await db.query('select * from public.push_subscriptions')).rows.length,0);
 await as(null);await assert.rejects(db.query('select * from public.push_subscriptions'),/permission denied/);
 for(const who of ['participant','coach','admin','board']){await as(who);await assert.rejects(db.query('select * from public.claim_event_reminders()'),/permission denied/);}
});

test('one-hour scheduler claims once, excludes declined/removal/cancelled events and rejects duplicate acknowledgement',async()=>{
 await service();await db.exec("update public.default_calendar_reminders set enabled=false;set role service_role");
 let jobs=(await db.query('select * from public.claim_event_reminders()')).rows;assert.equal(jobs.length,1);const job=jobs[0];assert.equal(job.endpoint,'https://fcm.googleapis.com/fcm/send/test');assert.equal((await db.query('select * from public.claim_event_reminders()')).rows.length,0);
 await db.query('select public.finish_event_reminder($1,$2,true,false)',[job.job_id,job.lease]);assert.equal((await db.query('select * from public.claim_event_reminders()')).rows.length,0);
 await service();await db.exec('delete from oti_private.push_jobs');
 await as('participant');await db.query("insert into public.event_rsvps values($1,$2,'declined')",[eid,ids.participant]);
 await service();await db.exec('set role service_role');assert.equal((await db.query('select * from public.claim_event_reminders()')).rows.length,0);
 await as('participant');await db.query("update public.event_rsvps set status='going' where event_id=$1",[eid]);
 await as('admin');await db.query('update public.cohort_events set cancelled=true where id=$1',[eid]);
 await as('participant');assert.equal((await db.query('select * from public.cohort_events')).rows.length,0);await db.query("update public.event_rsvps set status='maybe' where event_id=$1",[eid]);await service();assert.equal((await db.query('select status from public.event_rsvps where event_id=$1',[eid])).rows[0].status,'going');
 await as('admin');await assert.rejects(db.query("select public.message_event_rsvp($1,'going','Cancelled')",[eid]),/not_allowed/);
 await service();await db.exec('set role service_role');assert.equal((await db.query('select * from public.claim_event_reminders()')).rows.length,0);
 await as('admin');await db.query('update public.cohort_events set cancelled=false where id=$1',[eid]);await db.query("select public.assign_cohort_by_login($1,'participant@example.org',false)",[cid]);
 await service();await db.exec('set role service_role');assert.equal((await db.query('select * from public.claim_event_reminders()')).rows.length,0);
 await as('admin');await db.query("select public.manage_participant($1,'participant','removed')",[ids.participant]);
 await service();assert.equal((await db.query('select * from public.push_subscriptions')).rows.length,0);
});

test('default calendar reminder converts Pacific wall time across DST',async()=>{
 await service();const r=await db.query("select ('2026-10-26'::date+local_start) at time zone time_zone as summer,('2026-11-02'::date+local_start) at time zone time_zone as winter from public.default_calendar_reminders where id='monday-group'");
 assert.equal(new Date(r.rows[0].summer).toISOString(),'2026-10-27T02:00:00.000Z');assert.equal(new Date(r.rows[0].winter).toISOString(),'2026-11-03T03:00:00.000Z');
});
