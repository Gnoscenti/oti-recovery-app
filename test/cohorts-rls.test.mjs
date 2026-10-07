import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const db=new PGlite();
const users={}, cohorts={}, channels={};let eventId,postId;
async function service(){await db.exec('reset role');await db.query("select set_config('request.jwt.claims','',false)");}
async function as(who){await service();if(who)await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:users[who]})]);await db.exec(`set role ${who?'authenticated':'anon'}`);}
async function count(table){return Number((await db.query(`select count(*) as n from public.${table}`)).rows[0].n);}
before(async()=>{
 await db.exec(`create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::json->>'sub')::uuid$$;create role anon nologin;create role authenticated nologin;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;create publication supabase_realtime;`);
 for(const file of ['schema.sql','seed.sql','cohorts.sql'])await db.exec(await readFile(new URL('../supabase/'+file,import.meta.url),'utf8'));
 for(const [name,role] of [['admin','admin'],['coach','coach'],['a','participant'],['b','participant'],['board','board'],['none','none']]){
  users[name]=(await db.query("insert into auth.users(id,email) values(gen_random_uuid(),$1) returning id",[name+'@example.org'])).rows[0].id;
  await db.query('update public.profiles set role=$1,display_name=$2,accepted_guidelines_at=now() where id=$3',[role,name,users[name]]);
 }
 await as('admin');
 for(const key of ['a','b'])cohorts[key]=(await db.query("select public.create_cohort($1,now()-interval '1 day',now()+interval '6 months') as id",['Cohort '+key])).rows[0].id;
 await service();
 for(const key of ['a','b']){
  await db.query('insert into public.cohort_members values($1,$2),($1,$3)',[cohorts[key],users[key],users.coach]);
  channels[key]=(await db.query("select id from public.channels where cohort_id=$1 and slug='affirmations'",[cohorts[key]])).rows[0].id;
  await db.query('insert into public.cohort_activities(cohort_id,title,body) values($1,$2,$3)',[cohorts[key],'Private activity '+key,'Private body '+key]);
 }
 eventId=(await db.query("insert into public.cohort_events(cohort_id,title,starts_at,ends_at) values($1,'Private event A',now()+interval '1 day',now()+interval '2 days') returning id",[cohorts.a])).rows[0].id;
 await as('a');postId=(await db.query("insert into public.messages(channel_id,author_id,body) values($1,$2,'Private affirmation A') returning id",[channels.a,users.a])).rows[0].id;
});
after(async()=>{await db.close();});

test('database reads isolate cohorts, legacy unscoped channels, board/none/anonymous and admin affirmation access',async()=>{
 await as('a');assert.equal(await count('cohorts'),1);assert.equal(await count('cohort_activities'),1);assert.equal(await count('cohort_events'),1);assert.equal(await count('channels'),2);assert.equal(await count('messages'),1);
 assert.equal((await db.query('select * from public.channels where cohort_id is null')).rows.length,0);
 await as('b');assert.equal(await count('cohort_events'),0);assert.equal(await count('messages'),0);
 await as('admin');assert.equal(await count('messages'),0);assert.equal(await count('channels'),0);assert.equal(await count('cohort_events'),1);
 for(const who of ['board','none']){await as(who);for(const t of ['cohorts','channels','messages','cohort_events','cohort_activities'])assert.equal(await count(t),0,`${who}:${t}`);}
 await as(null);await assert.rejects(count('cohort_events'),/permission denied/);await assert.rejects(db.query("select public.create_cohort('Bad',now(),now()+interval '1 day')"),/permission denied/);
});

test('only active admins/coaches can manage membership or create cohort events and activities; no role escalation',async()=>{
 await as('a');await assert.rejects(db.query('insert into public.cohort_members values($1,$2)',[cohorts.b,users.a]),/row-level security/);
 await assert.rejects(db.query("select public.create_cohort('Bad',now(),now()+interval '1 day')"),/not_allowed/);
 await assert.rejects(db.query("insert into public.cohort_events(cohort_id,title,starts_at,ends_at) values($1,'Bad',now(),now()+interval '1 day')",[cohorts.a]),/row-level security/);
 await assert.rejects(db.query("insert into public.cohort_activities(cohort_id,title,body) values($1,'Bad','Bad')",[cohorts.a]),/row-level security/);
 await as('coach');await assert.rejects(db.query("update public.profiles set role='admin' where id=$1",[users.coach]),/not_allowed/);
 await db.query('insert into public.cohort_members values($1,$2)',[cohorts.b,users.a]);
 await as('a');assert.equal(await count('cohorts'),2);
 await as('coach');await db.query('delete from public.cohort_members where cohort_id=$1 and user_id=$2',[cohorts.b,users.a]);
 await db.query("insert into public.cohort_events(cohort_id,title,starts_at,ends_at) values($1,'Coach event B',now()+interval '1 day',now()+interval '2 days')",[cohorts.b]);
});

test('RSVP ownership, cross-cohort writes and broadcasts reject spoofing; private inbox only reaches selected current participants',async()=>{
 await as('a');await db.query("insert into public.event_rsvps values($1,$2,'going')",[eventId,users.a]);
 await assert.rejects(db.query("insert into public.event_rsvps values($1,$2,'going')",[eventId,users.b]),/row-level security/);
 await assert.rejects(db.query("update public.event_rsvps set user_id=$1 where event_id=$2",[users.b,eventId]),/permission denied/);
 await assert.rejects(db.query("select public.message_event_rsvp($1,'going','Unauthorized')",[eventId]),/not_allowed/);
 await as('b');await assert.rejects(db.query("insert into public.event_rsvps values($1,$2,'going')",[eventId,users.b]),/row-level security/);assert.equal(await count('event_rsvps'),0);
 await as('coach');assert.equal((await db.query("select public.message_event_rsvp($1,'going','Going only') as n",[eventId])).rows[0].n,1);
 assert.equal((await db.query("select public.message_event_rsvp($1,'no-response','No response only') as n",[eventId])).rows[0].n,0);
 await assert.rejects(db.query("select public.message_event_rsvp($1,'all','Bad')",[eventId]),/invalid/);
 await assert.rejects(db.query("select public.message_event_rsvp($1,'going','')",[eventId]),/invalid/);
 await as('a');assert.equal(await count('event_deliveries'),1);
 await assert.rejects(db.query("insert into public.event_deliveries(event_id,recipient_id,sender_id,body) values($1,$2,$3,'Spoofed')",[eventId,users.a,users.coach]),/permission denied/);
 await as('b');assert.equal(await count('event_deliveries'),0);
 await as('board');assert.equal(await count('event_deliveries'),0);
 await as('a');await db.query("update public.event_rsvps set status='maybe' where event_id=$1",[eventId]);
 await as('coach');assert.equal((await db.query("select public.message_event_rsvp($1,'going','Old status') as n",[eventId])).rows[0].n,0);assert.equal((await db.query("select public.message_event_rsvp($1,'maybe','New status') as n",[eventId])).rows[0].n,1);
});

test('cohort removal revokes reads, posting, RSVP and inbox access; expired/future cohorts and removed profiles fail closed',async()=>{
 await as('coach');await db.query('delete from public.cohort_members where cohort_id=$1 and user_id=$2',[cohorts.a,users.a]);
 assert.equal((await db.query("select public.message_event_rsvp($1,'maybe','Former member') as n",[eventId])).rows[0].n,0);
 await as('a');for(const t of ['cohorts','channels','messages','cohort_events','cohort_activities','event_rsvps','event_deliveries'])assert.equal(await count(t),0,t);
 await assert.rejects(db.query("insert into public.messages(channel_id,author_id,body) values($1,$2,'Former member')",[channels.a,users.a]),/row-level security|slow_down/);
 await assert.rejects(db.query('select public.delete_message($1)',[postId]),/not_allowed/);
 await service();await db.query("update public.cohorts set starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' where id=$1",[cohorts.b]);
 await as('b');assert.equal(await count('cohorts'),0);assert.equal(await count('channels'),0);assert.equal(await count('cohort_events'),0);
 await service();await db.query("update public.cohorts set starts_at=now()+interval '1 day',ends_at=now()+interval '2 days' where id=$1",[cohorts.b]);
 await as('b');assert.equal(await count('channels'),0);assert.equal(await count('cohort_activities'),0);
 await service();await db.query("update public.profiles set status='removed' where id=$1",[users.coach]);
 await as('coach');assert.equal(await count('cohorts'),0);await assert.rejects(db.query("select public.create_cohort('Bad',now(),now()+interval '1 day')"),/not_allowed/);
});
