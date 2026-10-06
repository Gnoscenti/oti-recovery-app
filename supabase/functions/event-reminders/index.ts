import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import webpush from 'npm:web-push@3.6.7';
import { createReminderHandler } from './dispatch.mjs';
const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!,Deno.env.get('VAPID_PUBLIC_KEY')!,Deno.env.get('VAPID_PRIVATE_KEY')!);
const handle=createReminderHandler({
  secret:Deno.env.get('REMINDER_CRON_SECRET'),
  async claim(){const {data,error}=await client.rpc('claim_event_reminders');if(error)throw error;return data;},
  async send(subscription:unknown,payload:string,ttl:number){await webpush.sendNotification(subscription,payload,{TTL:ttl,timeout:10000});},
  async finish(job:any,delivered:boolean,expired:boolean){const {error}=await client.rpc('finish_event_reminder',{jid:job.job_id,token:job.lease,delivered,expired});if(error)throw error;},
});
Deno.serve(async request=>{try{return await handle(request);}catch{return new Response('Scheduler unavailable',{status:503});}});
