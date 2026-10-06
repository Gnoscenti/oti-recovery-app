// @ts-check
import { el, clear } from '../dom.js';
import { friendlyError } from '../community/helpers.js';
import { mountPushSettings } from '../push/client.js';

/** @param {HTMLElement} root @param {any} api @param {'activity'|'calendar'} section @param {{management?:boolean}} [options] */
export function mountCohorts(root, api, section, options={}) {
  let selected = '';
  let generation = 0;
  const management=!!options.management;
  const button = (label, action) => el('button', { class:'btn small',type:'button',onClick:()=>run(action) },label);
  async function run(action) { try { await action(); await render(); } catch(err) { root.append(el('p',{role:'alert',class:'notice danger'},friendlyError(err))); } }
  const input = (label, type='text') => el('input',{type,'aria-label':label,placeholder:label,required:true});
  function form(title, fields, save) {
    const box=el('form',{class:'card stack'},el('h3',{},title));
    for(const [label,node] of fields) box.append(el('label',{},label,node));
    const submit=el('button',{type:'submit',class:'btn primary small'},title);box.append(submit);
    box.addEventListener('submit',e=>{e.preventDefault();submit.disabled=true;run(save).finally(()=>{submit.disabled=false;});});return box;
  }
  function reviewSelector() {
    if(api?.mode!=='demo')return;
    const role=el('select',{'aria-label':'Review role'},['participant','newmember','coach','admin','gigi','board','signed-out'].map(r=>el('option',{value:r,selected:api.viewer()===r},r==='gigi'?'Admin (Gigi)':r==='admin'?'Admin (Julie)':r)));
    role.addEventListener('change',()=>run(async()=>{api.setViewer(role.value);}));
    root.append(el('div',{class:'notice'},'Review only · synthetic participants · no notifications are sent.',role));
  }
  async function render() {
    const ticket=++generation;clear(root);reviewSelector();
    if(!api)return;
    const me=await api.getMe();
    if(ticket!==generation||!root.isConnected)return;
    if(!me||me.status!=='active'||!['participant','coach','admin'].includes(me.role))return;
    const staff=management&&['admin','coach'].includes(me.role);
    if(management&&!staff)return;
    const cohorts=staff?await api.listCohorts():await api.listAssignedCohorts();
    if(ticket!==generation||!root.isConnected)return;
    if(section==='calendar'&&!management&&me.role!=='admin') {
      const settings=el('div',{});root.append(settings);mountPushSettings(settings,api);
    }
    if(!cohorts.length&&!management) {
      if(section==='activity')root.append(el('h2',{},'Activity'),el('p',{},'Your coach will assign your cohort. Activities will appear here once you are assigned.'));
      return;
    }
    root.append(el('h2',{},section==='calendar'?'Cohort calendar':'Cohort activity'));
    if(!cohorts.some(c=>c.id===selected))selected=cohorts[0]?.id||'';
    if(cohorts.length) {
      const select=el('select',{'aria-label':'Cohort'},cohorts.map(c=>el('option',{value:c.id,selected:c.id===selected},`${c.name} · ${new Date(c.ends_at).toLocaleDateString()}`)));
      select.addEventListener('change',()=>{selected=select.value;run(async()=>{});});root.append(select);
    }
    if(staff) {
      const name=input('Cohort name');const starts=input('Cohort begins','date');const ends=input('Cohort ends','date');
      const today=new Date();starts.value=today.toISOString().slice(0,10);const later=new Date(today);later.setMonth(later.getMonth()+6);ends.value=later.toISOString().slice(0,10);
      root.append(form('Create cohort',[['Name',name],['Begins',starts],['Ends (suggested six months)',ends]],async()=>{selected=await api.createCohort(name.value,new Date(starts.value).toISOString(),new Date(ends.value).toISOString());}));
      if(selected) {
        const current=cohorts.find(c=>c.id===selected);
        const editName=input('Edit cohort name');editName.value=current.name;const editStart=input('Edit cohort begins','date');editStart.value=current.starts_at.slice(0,10);const editEnd=input('Edit cohort ends','date');editEnd.value=current.ends_at.slice(0,10);
        root.append(el('details',{class:'card'},el('summary',{},'Edit cohort dates'),form('Save cohort',[['Name',editName],['Begins',editStart],['Ends',editEnd]],()=>api.updateCohort(selected,editName.value,new Date(editStart.value).toISOString(),new Date(editEnd.value).toISOString()))));
        const email=input('Participant login email','email');
        root.append(form('Assign participant',[['Login email',email]],()=>api.assignCohortByLogin(selected,email.value,true)));
        const roster=await api.cohortRoster();const members=await api.cohortMembers(selected);
        if(ticket!==generation||!root.isConnected)return;
        root.append(el('h3',{},'Assigned participants'));
        for(const m of members) {const p=roster.find(p=>p.id===m.user_id);if(p)root.append(el('div',{class:'row'},el('span',{},p.display_name||'Participant'),button('Remove from cohort',()=>api.assignCohort(selected,p.id,false))));}
      }
    }
    if(!selected)return;
    const cohort=cohorts.find(c=>c.id===selected);
    if(new Date(cohort.ends_at)<=new Date()||new Date(cohort.starts_at)>new Date()) {root.append(el('p',{},'This cohort is outside its active dates.'));return;}
    if(section==='activity') {
      const rows=await api.listActivities(selected);
      if(ticket!==generation||!root.isConnected)return;
      for(const a of rows)root.append(el('article',{class:'card'},el('h3',{},a.title),el('p',{},a.body)));
      if(!rows.length)root.append(el('p',{},'No cohort activities posted yet.'));
      if(staff) {
        const title=input('Activity title');const body=el('textarea',{'aria-label':'Activity description',required:true,maxlength:2000});
        root.append(form('Post activity',[['Title',title],['Description',body]],()=>api.createActivity({cohort_id:selected,title:title.value,body:body.value})));
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
      const rsvps=await api.listRsvps(e.id);const inbox=await api.eventInbox(e.id);
      if(ticket!==generation||!root.isConnected)return;
      const card=el('article',{class:'card stack'},el('h3',{},e.title),el('p',{},`${new Date(e.starts_at).toLocaleString()} · ${e.location}`));
      const own=rsvps.find(r=>r.user_id===me.id);
      if(!management) {
        card.append(el('p',{},`Your RSVP: ${own?.status||'No response'}`));
        if(me.role!=='admin')card.append(el('div',{class:'row'},['going','maybe','declined'].map(s=>button(s,()=>api.rsvp(e.id,s)))));
      }
      if(staff) {
        const status=el('select',{'aria-label':'Message RSVP status'},['going','maybe','declined','no-response'].map(s=>el('option',{value:s},s)));
        const body=el('textarea',{'aria-label':'RSVP message',required:true,maxlength:2000});
        card.append(form('Message by RSVP status',[['Recipients',status],['Message',body]],async()=>{const count=await api.messageRsvp(e.id,status.value,body.value);window.alert(`${count} private in-app messages created${api.mode==='demo'?' (sample only)':''}.`);}));
        const editTitle=input('Edit event title');editTitle.value=e.title;
        const localValue=value=>{const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
        const editStart=input('Edit event starts','datetime-local');editStart.value=localValue(e.starts_at);const editEnd=input('Edit event ends','datetime-local');editEnd.value=localValue(e.ends_at);const editLocation=input('Edit event location');editLocation.required=false;editLocation.value=e.location;
        card.append(el('details',{},el('summary',{},'Edit event'),form('Save event',[['Title',editTitle],['Starts',editStart],['Ends',editEnd],['Location',editLocation]],()=>api.updateCohortEvent(e.id,{title:editTitle.value,starts_at:new Date(editStart.value).toISOString(),ends_at:new Date(editEnd.value).toISOString(),location:editLocation.value}))));
        card.append(button('Cancel event',()=>api.cancelCohortEvent(e.id)));
      }
      for(const m of inbox)card.append(el('div',{class:'notice'},el('strong',{},m.sender_id===me.id?'Sent message':'Event message'),el('p',{},m.body)));
      root.append(card);
    }
  }
  render().catch(err=>{clear(root);root.append(el('p',{role:'alert'},friendlyError(err)));});
}
