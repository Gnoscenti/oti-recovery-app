// @ts-check
/** Supabase rows remain snake_case here; RLS authorizes every call. @param {any} client */
export function cohortApi(client) {
  const result = (/** @type {any} */ r) => { if (r.error) throw new Error(r.error.message); return r.data; };
  return {
    async listCohorts() { return result(await client.from('cohorts').select('*').order('starts_at')); },
    async createCohort(name, starts, ends) { return result(await client.rpc('create_cohort', { cname: name, begins: starts, finishes: ends })); },
    async cohortMembers(cid) { return result(await client.from('cohort_members').select('user_id').eq('cohort_id', cid)); },
    async cohortRoster() { return result(await client.from('profiles').select('id,display_name,role,status').in('role', ['participant', 'coach']).eq('status', 'active')); },
    async assignCohort(cid, uid, add) {
      return result(await (add ? client.from('cohort_members').upsert({ cohort_id: cid, user_id: uid }) : client.from('cohort_members').delete().eq('cohort_id', cid).eq('user_id', uid)));
    },
    async listCohortEvents(cid) { return result(await client.from('cohort_events').select('*').eq('cohort_id', cid).order('starts_at')); },
    async createCohortEvent(row) { return result(await client.from('cohort_events').insert(row).select().single()); },
    async listActivities(cid) { return result(await client.from('cohort_activities').select('*').eq('cohort_id', cid)); },
    async createActivity(row) { return result(await client.from('cohort_activities').insert(row).select().single()); },
    async listRsvps(eid) { return result(await client.from('event_rsvps').select('*').eq('event_id', eid)); },
    async rsvp(eid, status) {
      const u = result(await client.auth.getUser()).user;
      if (!u) throw new Error('not_allowed');
      return result(await client.from('event_rsvps').upsert({ event_id: eid, user_id: u.id, status }));
    },
    async messageRsvp(eid, status, body) { return result(await client.rpc('message_event_rsvp', { eid, target_status: status, message_body: body })); },
    async eventInbox(eid) { return result(await client.from('event_deliveries').select('*').eq('event_id', eid).order('created_at')); },
  };
}

/** Synthetic data only; never persisted or sent. @param {() => any} viewer @param {() => Date} now */
export function demoCohorts(viewer, now) {
  let serial = 0;
  const cohorts = [
    { id: 'sample-a', name: 'Sample cohort A', starts_at: new Date(now().getTime()-86400000).toISOString(), ends_at: new Date(now().getTime()+180*86400000).toISOString() },
    { id: 'sample-b', name: 'Sample cohort B', starts_at: new Date(now().getTime()-86400000).toISOString(), ends_at: new Date(now().getTime()+180*86400000).toISOString() },
  ];
  const memberships = new Map([['sample-a', new Set(['u-sample-participant','u-maya','u-tess','u-gigi'])], ['sample-b', new Set(['u-gigi'])]]);
  /** @type {any[]} */ const events = [{ id:'sample-event', cohort_id:'sample-a', title:'Sample cohort gathering', starts_at: new Date(now().getTime()+86400000).toISOString(), ends_at: new Date(now().getTime()+90000000).toISOString(), location:'Review only' }];
  /** @type {any[]} */ const activities = [{ id:'sample-activity',cohort_id:'sample-a',title:'Sample group activity',body:'Review fixture: a coach-created activity appears only in its cohort.' }];
  /** @type {any[]} */ const rsvps = [];
  /** @type {any[]} */ const deliveries = [];
  const active = cid => cohorts.some(c=>c.id===cid && c.starts_at<=now().toISOString() && c.ends_at>now().toISOString());
  const staff = () => ['coach','admin'].includes(viewer()?.role);
  const member = cid => active(cid) && ['participant','coach'].includes(viewer()?.role) && memberships.get(cid)?.has(viewer()?.id);
  const access = cid => member(cid) || (staff() && active(cid));
  const requireStaff = () => { if (!staff()) throw new Error('not_allowed'); };
  const event = eid => { const e=events.find(x=>x.id===eid); if(!e || !access(e.cohort_id)) throw new Error('not_allowed'); return e; };
  const check = row => { requireStaff(); if(!active(row.cohort_id) || !row.title?.trim() || row.title.length>120) throw new Error('invalid'); };
  return {
    cohortMember: member,
    async listCohorts() { return structuredClone(cohorts.filter(c=>member(c.id)||staff())); },
    async createCohort(name, starts, ends) { requireStaff(); if(name.trim().length<2 || name.length>80 || !Number.isFinite(Date.parse(starts)) || !Number.isFinite(Date.parse(ends)) || Date.parse(ends)<=Date.parse(starts)) throw new Error('invalid'); const id=`sample-${++serial}`;cohorts.push({id,name,starts_at:starts,ends_at:ends});memberships.set(id,new Set([viewer().id]));return id; },
    async cohortMembers(cid) { if(!staff()&&!member(cid)) throw new Error('not_allowed');return [...(memberships.get(cid)||[])].filter(id=>staff()||id===viewer().id).map(user_id=>({user_id})); },
    async cohortRoster() { requireStaff();return ['u-sample-participant','u-maya','u-tess','u-gigi','u-newmember'].map(id=>({id,display_name:id.replace('u-',''),role:id==='u-gigi'?'coach':'participant',status:'active'})); },
    async assignCohort(cid,uid,add) { requireStaff();const m=memberships.get(cid);if(!m)throw new Error('invalid');if(add)m.add(uid);else m.delete(uid); },
    async listCohortEvents(cid) { return structuredClone(access(cid)?events.filter(x=>x.cohort_id===cid):[]); },
    async createCohortEvent(row) { check(row);if(!Number.isFinite(Date.parse(row.starts_at))||Date.parse(row.ends_at)<=Date.parse(row.starts_at))throw new Error('invalid');const e={...row,id:`sample-event-${++serial}`};events.push(e);return structuredClone(e); },
    async listActivities(cid) { return structuredClone(access(cid)?activities.filter(x=>x.cohort_id===cid):[]); },
    async createActivity(row) { check(row);if(!row.body?.trim()||row.body.length>2000)throw new Error('invalid');const a={...row,id:`sample-activity-${++serial}`};activities.push(a);return structuredClone(a); },
    async listRsvps(eid) { event(eid);return structuredClone(rsvps.filter(x=>x.event_id===eid&&(staff()||x.user_id===viewer().id))); },
    async rsvp(eid,status) { const e=event(eid);if(!member(e.cohort_id)||!['going','maybe','declined'].includes(status))throw new Error('not_allowed');const r=rsvps.find(x=>x.event_id===eid&&x.user_id===viewer().id);if(r)r.status=status;else rsvps.push({event_id:eid,user_id:viewer().id,status}); },
    async messageRsvp(eid,status,body) {
      requireStaff();const e=event(eid);if(!['going','maybe','declined','no-response'].includes(status)||!body.trim()||body.length>2000)throw new Error('invalid');
      const recipients=[...(memberships.get(e.cohort_id)||[])].filter(id=>id!=='u-gigi' && (rsvps.find(r=>r.event_id===eid&&r.user_id===id)?.status||'no-response')===status);
      for(const id of recipients)deliveries.push({id:`sample-delivery-${++serial}`,event_id:eid,recipient_id:id,sender_id:viewer().id,body:body.trim(),created_at:now().toISOString()});return recipients.length;
    },
    async eventInbox(eid) { event(eid);return structuredClone(deliveries.filter(d=>d.event_id===eid&&(d.recipient_id===viewer().id||(staff()&&d.sender_id===viewer().id)))); },
  };
}
