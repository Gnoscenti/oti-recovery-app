import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDemoApi } from '../www/js/community/demo.js';
const NOW = new Date('2026-10-06T18:00:00Z');

test('participants cannot self-enroll, create cohorts/events/activities, or send RSVP broadcasts', async()=>{
 const api=createDemoApi({now:()=>NOW});
 assert.deepEqual((await api.listCohorts()).map(c=>c.id),['sample-a']);
 assert.deepEqual(await api.listActivities('sample-b'),[]);
 assert.deepEqual(await api.listCohortEvents('sample-b'),[]);
 await assert.rejects(api.assignCohort('sample-b','u-sample-participant',true),/not_allowed/);
 await assert.rejects(api.createCohort('Unauthorized',NOW.toISOString(),new Date(+NOW+86400000).toISOString()),/not_allowed/);
 await assert.rejects(api.createCohortEvent({cohort_id:'sample-a',title:'Unauthorized'}),/not_allowed/);
 await assert.rejects(api.createActivity({cohort_id:'sample-a',title:'Unauthorized',body:'Unauthorized'}),/not_allowed/);
 await assert.rejects(api.messageRsvp('sample-event','going','Unauthorized'),/not_allowed/);
});

test('coach assignment and removal apply to cohort topics, event reads and RSVP writes', async()=>{
 const api=createDemoApi({now:()=>NOW});
 api.setViewer('coach');await api.assignCohort('sample-a','u-sample-participant',false);
 api.setViewer('participant');assert.deepEqual(await api.listChannels(),[]);
 assert.deepEqual(await api.listMessages('c-affirmations'),[]);
 assert.deepEqual(await api.listCohortEvents('sample-a'),[]);
 await assert.rejects(api.rsvp('sample-event','going'),/not_allowed/);
 api.setViewer('coach');await api.assignCohort('sample-a','u-sample-participant',true);
 api.setViewer('participant');assert.equal((await api.listChannels()).length,2);
 api.setViewer('board');assert.deepEqual(await api.listCohorts(),[]);assert.deepEqual(await api.listChannels(),[]);
 api.setViewer('admin');assert.deepEqual(await api.listMessages('c-affirmations'),[]);
 api.setViewer('signed-out');assert.deepEqual(await api.listCohorts(),[]);
});

test('RSVP status messages use current cohort recipients and remain a private inbox',async()=>{
 const api=createDemoApi({now:()=>NOW});
 await api.rsvp('sample-event','going');
 api.setViewer('coach');
 assert.equal(await api.messageRsvp('sample-event','going','Fixture going message'),1);
 assert.equal(await api.messageRsvp('sample-event','maybe','Fixture maybe message'),0);
 assert.equal(await api.messageRsvp('sample-event','no-response','Fixture no-response message'),2);
 await assert.rejects(api.messageRsvp('sample-event','all','Bad status'),/invalid/);
 api.setViewer('participant');
 assert.deepEqual((await api.eventInbox('sample-event')).map(m=>m.body),['Fixture going message']);
 assert.equal((await api.listRsvps('sample-event')).length,1);
 api.setViewer('coach');await api.assignCohort('sample-a','u-sample-participant',false);
 assert.equal(await api.messageRsvp('sample-event','going','Removed participant'),0);
 api.setViewer('participant');await assert.rejects(api.eventInbox('sample-event'),/not_allowed/);
});

test('public content/navigation retain liked features and remove rejected sections',async()=>{
 const c=JSON.parse(await readFile(new URL('../www/data/content.json',import.meta.url)));
 assert.deepEqual(c.phones.map(p=>p.id),['988','never-use-alone']);
 assert.deepEqual(c.recoveryLinks,[]);assert.equal(c.org.donateUrl,undefined);assert.equal(c.org.sponsorsUrl,undefined);
 const html=await readFile(new URL('../www/index.html',import.meta.url),'utf8');
 assert.match(html,/data-tab="activity"/);assert.doesNotMatch(html,/data-tab="tools"/);
 const app=await readFile(new URL('../www/js/app.js',import.meta.url),'utf8');
 for(const name of ['Count your days','Ride the urge','Stories of impact'])assert.ok(app.includes(name));
 assert.deepEqual(c.events.map(e=>e.id),['monday-group']);
 assert.doesNotMatch(app,/'Donate'|'Business sponsors'|Recovery communities & help/);
});
