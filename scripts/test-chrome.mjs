import {chromium,webkit} from 'playwright-core';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const port=4175;
const server=spawn(process.execPath,['scripts/serve.mjs',String(port),'dist/site'],{stdio:['ignore','pipe','inherit']});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',()=>reject(new Error('Server stopped')));});
try {
 for(const [name,engine] of [['Chrome',chromium],['Safari/WebKit',webkit]]) {
  const browser=await engine.launch();
  try {
   for(const viewport of [{width:1280,height:900},{width:390,height:844},{width:375,height:667}]) {
    const context=await browser.newContext({viewport,isMobile:viewport.width<500,hasTouch:viewport.width<500});
    const page=await context.newPage();const errors=[],privateRequests=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('request',req=>{if(/supabase\.co/.test(req.url()))privateRequests.push(req.url());});
    await page.goto(`http://localhost:${port}/#home`);await page.getByText('Count your days',{exact:true}).waitFor();await page.getByText('Stories of impact',{exact:true}).waitFor();
    assert.equal(await page.getByText('Donate',{exact:true}).count(),0);
    await page.locator('a[data-tab="phones"]').click();await page.locator('#view-phones .phone.featured').waitFor();assert.equal(await page.locator('#view-phones article.phone').count(),2);
    await page.locator('a[data-tab="calendar"]').click();await page.getByRole('heading',{name:'Default calendar',exact:true}).waitFor();await page.getByRole('heading',{name:'Sample cohort gathering',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Create event',exact:true}).count(),0);
    await page.getByRole('button',{name:'going',exact:true}).click();await page.getByText('Your RSVP: going',{exact:true}).waitFor();
    await page.getByLabel('Review role').selectOption('newmember');await page.waitForFunction(()=>!document.querySelector('#view-calendar select[aria-label="Cohort"]'));
    await page.getByRole('heading',{name:'Default calendar',exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'Cohort calendar',exact:true}).count(),0);
    await page.getByLabel('Review role').selectOption('signed-out');await page.getByRole('heading',{name:'Default calendar',exact:true}).waitFor();
    await page.getByLabel('Review role').selectOption('participant');await page.getByRole('heading',{name:'Cohort calendar',exact:true}).waitFor();
    assert.equal(await page.getByLabel('Cohort',{exact:true}).locator('option').count(),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'Calendar must fit mobile width');
    await page.locator('a[data-tab="activity"]').click();await page.getByRole('heading',{name:'Sample group activity',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Post activity',exact:true}).count(),0);
    await page.locator('a[data-tab="community"]').click();await page.locator('#review-viewer').waitFor();await page.locator('#view-community .topic').filter({hasText:'Daily Affirmations'}).click();await page.getByText('What happened to me was not my fault. I am reclaiming my sense of safety one day at a time, and my healing journey deserves patience and respect',{exact:true}).first().waitFor();await page.selectOption('#review-viewer','board');await page.getByText('No topics are open to your role yet.',{exact:true}).waitFor();
    await page.goto(`http://localhost:${port}/admin/`);await page.getByRole('button',{name:'Register participant',exact:true}).waitFor();
    await page.getByLabel('Participant login email',{exact:true}).fill('newmember@example.org');await page.getByRole('button',{name:'Assign participant',exact:true}).click();await page.getByRole('heading',{name:'Assigned participants',exact:true}).waitFor();
    await page.getByLabel('Event title',{exact:true}).fill('Browser test event');await page.getByLabel('Event starts',{exact:true}).fill('2026-10-07T10:00');await page.getByLabel('Event ends',{exact:true}).fill('2026-10-07T11:00');await page.getByRole('button',{name:'Create event',exact:true}).click();await page.getByRole('heading',{name:'Browser test event',exact:true}).waitFor();
    const eventCard=page.locator('article.card').filter({has:page.getByRole('heading',{name:'Browser test event',exact:true})});
    await eventCard.getByLabel('Message RSVP status').selectOption('no-response');await eventCard.getByLabel('RSVP message').fill('Private staff browser-test message');page.once('dialog',d=>d.accept());await eventCard.getByRole('button',{name:'Message by RSVP status',exact:true}).click();await page.getByText('Private staff browser-test message',{exact:true}).first().waitFor();
    await page.getByRole('button',{name:'Cohort activities',exact:true}).click();await page.getByLabel('Activity title').fill('Browser review activity');await page.getByLabel('Activity description').fill('Synthetic activity');await page.getByRole('button',{name:'Post activity',exact:true}).click();await page.getByRole('heading',{name:'Browser review activity',exact:true}).waitFor();
    await page.getByLabel('Admin review role').selectOption('participant');await page.getByText('Staff access only. Your account cannot open administration.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Create cohort',exact:true}).count(),0);
    await page.getByLabel('Admin review role').selectOption('coach');await page.getByRole('button',{name:'Create cohort',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Register participant',exact:true}).count(),0);
    await page.getByLabel('Admin review role').selectOption('board');await page.getByText('Staff access only. Your account cannot open administration.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'Admin portal must fit mobile width');
    assert.deepEqual(errors,[]);assert.deepEqual(privateRequests,[]);await context.close();
   }
   console.log(`${name} participant calendars and admin authorization passed at desktop and two mobile sizes.`);
  }finally{await browser.close();}
 }
}finally{server.kill();}
