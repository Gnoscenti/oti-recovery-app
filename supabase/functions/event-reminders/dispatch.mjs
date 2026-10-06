/** Kept runtime-independent so authentication, privacy and retries can be tested without sending push messages. */
export function reminderPayload(startsAt) {
  return JSON.stringify({title:'Event reminder',body:'An event on your calendar starts in one hour. Open the app for details.',url:'/#calendar',expires_at:startsAt});
}
export function createReminderHandler({secret,claim,send,finish,now=()=>Date.now()}) {
  return async function handle(request) {
    if(request.method!=='POST')return new Response('Method not allowed',{status:405});
    if(!secret||request.headers.get('Authorization')!==`Bearer ${secret}`)return new Response('Unauthorized',{status:401});
    let jobs;try {jobs=await claim();}catch{return new Response('Scheduler unavailable',{status:503});}
    let sent=0,failed=0;
    async function deliver(job) {
      const starts=Date.parse(job.starts_at);
      if(!Number.isFinite(starts)||starts<=now()||starts-now()>3600000) {await finish(job,false,false);return;}
      try {
        await send({endpoint:job.endpoint,keys:{p256dh:job.p256dh,auth:job.auth_key}},reminderPayload(job.starts_at),Math.max(1,Math.min(300,Math.floor((starts-now())/1000))));
        await finish(job,true,false);sent++;
      }catch(error) {
        // Never log endpoint capability URLs, keys, participant IDs or provider response bodies.
        const expired=[404,410].includes(error?.statusCode);await finish(job,false,expired);failed++;
      }
    }
    for(let index=0;index<jobs.length;index+=5)await Promise.all(jobs.slice(index,index+5).map(deliver));
    return Response.json({sent,failed});
  };
}
