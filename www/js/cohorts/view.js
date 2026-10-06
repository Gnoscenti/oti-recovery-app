// @ts-check
import { el, clear } from '../dom.js';
import { friendlyError } from '../community/helpers.js';

/** Cohort data is never embedded in public content.json. @param {HTMLElement} root @param {any} api @param {'activity'|'calendar'} section */
export function mountCohorts(root, api, section) {
  let selected = '';
  let generation = 0;
  const heading = section === 'calendar' ? 'Cohort calendar' : 'Activity';
  const button = (label, action) => el('button', { class:'btn small',type:'button',onClick:()=>run(action) },label);
  async function run(action) { try { await action(); await render(); } catch(err) { const notice=el('p',{role:'alert',class:'notice danger'},friendlyError(err));root.append(notice); } }
  /** @returns {HTMLInputElement} */
  const input = (label, type='text') => el('input',{type,'aria-label':label,placeholder:label,required:true});
  function form(title, fields, save) {
    const box=el('form',{class:'card stack'},el('h3',{},title));
    for(const [label,node] of fields) box.append(el('label',{},label,node));
    const submit=el('button',{type:'submit',class:'btn primary small'},title);box.append(submit);
    box.addEventListener('submit',e=>{e.preventDefault();submit.disabled=true;run(async()=>{await save();}).finally(()=>{submit.disabled=false;});});return box;
  }
  async function render() {
    const ticket=++generation;
    clear(root);root.append(el('h2',{},heading));
    if(!api) {root.append(el('p',{},'Private cohort access is not switched on yet.'));return;}
    const me=await api.getMe();
    if(ticket!==generation || !root.isConnected)return;
    if(!me||me.status!=='active'||!['participant','coach','admin'].includes(me.role)) {
      root.append(el('p',{},'Sign in through Community. An admin or coach must assign your cohort.'),el('a',{href:'#community',class:'btn'},'Community sign-in'));return;
    }
    const staff=['admin','coach'].includes(me.role);
    const cohorts=await api.listCohorts();
    if(ticket!==generation || !root.isConnected)return;
    clear(root);root.append(el('h2',{},heading));
    if(api.mode==='demo') {
      const role=el('select',{'aria-label':'Review role'},['participant','coach','admin','board','signed-out'].map(r=>el('option',{value:r,selected:api.viewer()===r},r)));
      role.addEventListener('change',()=>run(async()=>{api.setViewer(role.value);}));
      root.append(el('div',{class:'notice'},'Review only · synthetic data · messages stay in this browser session.',role));
    }
    if(!cohorts.some(c=>c.id===selected))selected=cohorts[0]?.id||'';
    const select=el('select',{'aria-label':'Cohort'},cohorts.map(c=>el('option',{value:c.id,selected:c.id===selected},`${c.name} · ${new Date(c.ends_at).toLocaleDateString()}`)));
    select.addEventListener('change',()=>{selected=select.value;run(async()=>{});});root.append(select);
    if(staff) {
      const name=input('Cohort name');const starts=input('Cohort begins','date');const ends=input('Cohort ends','date');
      const today=new Date();starts.value=today.toISOString().slice(0,10);const later=new Date(today);later.setMonth(later.getMonth()+6);ends.value=later.toISOString().slice(0,10);
      root.append(form('Create cohort',[['Name',name],['Begins',starts],['Ends (suggested six months)',ends]],async()=>{selected=await api.createCohort(name.value,new Date(starts.value).toISOString(),new Date(ends.value).toISOString());}));
    }
    if(!selected) {root.append(el('p',{},'No cohort assigned yet. Ask your coach.'));return;}
    const cohort=cohorts.find(c=>c.id===selected);
    if(new Date(cohort.ends_at)<=new Date()||new Date(cohort.starts_at)>new Date()) {root.append(el('p',{},'This cohort is outside its active dates. Private activity and events are unavailable.'));return;}
    if(section==='activity') {
      root.append(el('p',{class:'muted'},'Visible only in this cohort. Daily Affirmations are coach posts in Community; a new affirmation every day awaits approval of the content source and cadence.'));
      const rows=await api.listActivities(selected);
      if(ticket!==generation||!root.isConnected)return;
      for(const a of rows)root.append(el('article',{class:'card'},el('h3',{},a.title),el('p',{},a.body)));
      if(!rows.length)root.append(el('p',{},'No cohort activities posted yet.'));
      if(staff) {
        const title=input('Activity title');const body=el('textarea',{'aria-label':'Activity description',required:true,maxlength:2000});
        root.append(form('Post activity',[['Title',title],['Description',body]],()=>api.createActivity({cohort_id:selected,title:title.value,body:body.value})));
        const [roster,members]=await Promise.all([api.cohortRoster(),api.cohortMembers(selected)]);
        if(ticket!==generation||!root.isConnected)return;
        const memberIds=new Set(members.map(m=>m.user_id));
        root.append(el('h3',{},'Cohort membership'),el('p',{},'Only admins and coaches can assign or remove existing members. Global account roles are managed separately by admins.'));
        for(const p of roster)root.append(el('div',{class:'row'},el('span',{},p.display_name||'Unnamed member'),button(memberIds.has(p.id)?'Remove from cohort':'Add to cohort',()=>api.assignCohort(selected,p.id,!memberIds.has(p.id)))));
      }
      return;
    }
    if(staff) {
      const title=input('Event title');const starts=input('Event starts','datetime-local');const ends=input('Event ends','datetime-local');const location=input('Location');location.required=false;
      root.append(form('Create event',[['Title',title],['Starts (your local time)',starts],['Ends (your local time)',ends],['Location',location]],()=>api.createCohortEvent({cohort_id:selected,title:title.value,starts_at:new Date(starts.value).toISOString(),ends_at:new Date(ends.value).toISOString(),location:location.value})));
    }
    const events=await api.listCohortEvents(selected);
    if(ticket!==generation||!root.isConnected)return;
    if(!events.length)root.append(el('p',{},'No events posted for this cohort yet.'));
    for(const e of events) {
      const card=el('article',{class:'card stack'},el('h3',{},e.title),el('p',{},`${new Date(e.starts_at).toLocaleString()} · ${e.location}`));
      const rsvps=await api.listRsvps(e.id);
      const own=rsvps.find(r=>r.user_id===me.id);
      card.append(el('p',{},`Your RSVP: ${own?.status||'No response'}`));
      if(me.role!=='admin')card.append(el('div',{class:'row'},['going','maybe','declined'].map(s=>button(s,()=>api.rsvp(e.id,s)))));
      if(staff) {
        const status=el('select',{'aria-label':'Message RSVP status'},['going','maybe','declined','no-response'].map(s=>el('option',{value:s},s)));
        const body=el('textarea',{'aria-label':'RSVP message',required:true,maxlength:2000});
        card.append(form('Message by RSVP status',[['Recipients',status],['Message',body]],async()=>{const count=await api.messageRsvp(e.id,status.value,body.value);window.alert(`${count} private in-app messages created${api.mode==='demo'?' (sample only)':''}.`);}));
      }
      const inbox=await api.eventInbox(e.id);
      if(ticket!==generation||!root.isConnected)return;
      for(const m of inbox)card.append(el('div',{class:'notice'},el('strong',{},m.sender_id===me.id?'Sent message':'Event message'),el('p',{},m.body)));
      root.append(card);
    }
  }
  render().catch(err=>{clear(root);root.append(el('p',{role:'alert'},friendlyError(err)));});
}
