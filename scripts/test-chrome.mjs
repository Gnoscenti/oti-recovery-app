import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const port=4175;
const server=spawn(process.execPath,['scripts/serve.mjs',String(port),'dist/site'],{stdio:['ignore','pipe','inherit']});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',()=>reject(new Error('Server stopped')));});
const browser=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined});
try {
 for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  const page=await browser.newPage({viewport});const errors=[];const privateRequests=[];
  page.on('pageerror',err=>errors.push(err.message));page.on('request',req=>{if(/supabase\.co/.test(req.url()))privateRequests.push(req.url());});
  await page.goto(`http://localhost:${port}/#home`);
  await page.getByText('Count your days',{exact:true}).waitFor();
  await page.getByText('Stories of impact',{exact:true}).waitFor();
  assert.equal(await page.getByText('Donate',{exact:true}).count(),0);
  await page.locator('a[data-tab="phones"]').click();await page.locator('#view-phones .phone.featured').waitFor();
  assert.equal(await page.locator('#view-phones article.phone').count(),2);
  await page.locator('a[data-tab="activity"]').click();await page.getByLabel('Cohort',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Cohort',{exact:true}).locator('option').count(),1);
  assert.equal(await page.getByRole('button',{name:'Post activity',exact:true}).count(),0);
  await page.getByLabel('Review role').selectOption('coach');await page.getByRole('button',{name:'Post activity',exact:true}).waitFor();
  await page.getByLabel('Activity title').fill('Chrome review activity');await page.getByLabel('Activity description').fill('Synthetic browser test activity');await page.getByRole('button',{name:'Post activity',exact:true}).click();await page.getByRole('heading',{name:'Chrome review activity',exact:true}).waitFor();
  await page.locator('a[data-tab="calendar"]').click();await page.getByRole('button',{name:'Create event',exact:true}).waitFor();
  await page.getByLabel('Event title').fill('Chrome test event');await page.getByLabel('Event starts',{exact:true}).fill('2026-10-07T10:00');await page.getByLabel('Event ends',{exact:true}).fill('2026-10-07T11:00');await page.getByRole('button',{name:'Create event',exact:true}).click();await page.getByRole('heading',{name:'Chrome test event',exact:true}).waitFor();
  await page.getByLabel('Review role').selectOption('participant');await page.getByRole('button',{name:'going',exact:true}).first().waitFor();await page.getByRole('button',{name:'going',exact:true}).first().click();await page.getByText('Your RSVP: going',{exact:true}).waitFor();
  await page.getByLabel('Review role').selectOption('coach');await page.getByLabel('Message RSVP status').first().waitFor();await page.getByLabel('Message RSVP status').first().selectOption('going');await page.getByLabel('RSVP message').first().fill('Private browser-test message');
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Message by RSVP status',exact:true}).first().click();await page.getByText('Private browser-test message',{exact:true}).waitFor();
  await page.getByLabel('Review role').selectOption('participant');await page.getByText('Private browser-test message',{exact:true}).waitFor();
  await page.locator('a[data-tab="community"]').click();await page.locator('#review-viewer').waitFor();await page.selectOption('#review-viewer','board');await page.getByText('No topics for your role',{exact:false}).waitFor().catch(async()=>{assert.equal(await page.locator('#view-community .topic').count(),0);});
  assert.deepEqual(errors,[]);assert.deepEqual(privateRequests,[]);await page.close();
 }
 console.log('Chrome/Chromium review flows passed at desktop and mobile sizes.');
} finally {await browser.close();server.kill();}
