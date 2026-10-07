// @ts-check
import { CONFIG } from '../config.js';
import { el, clear } from '../dom.js';
import { createSupabaseApi } from '../community/supabase.js';
import { createDemoApi } from '../community/demo.js';
import { mountCohorts } from '../cohorts/view.js';
import { friendlyError } from '../community/helpers.js';
import { disablePush } from '../push/client.js';

const root=/** @type {HTMLElement} */(document.getElementById('admin-root'));
const review=!!(/** @type {any} */(window).__OTI_REVIEW__);
const cfg=CONFIG.community;
const api=review?createDemoApi({viewerRole:'admin'}):cfg.supabaseUrl&&cfg.supabaseAnonKey?createSupabaseApi({url:cfg.supabaseUrl,anonKey:cfg.supabaseAnonKey}):null;
let section='calendar';let generation=0;
function field(label,type='text') {return el('input',{'aria-label':label,type,required:true});}
function form(title,fields,action) {
  const box=el('form',{class:'card stack'},el('h2',{},title));for(const [label,node] of fields)box.append(el('label',{},label,node));
  const submit=el('button',{type:'submit',class:'btn primary'},title);const feedback=el('p',{role:'status'});box.append(submit,feedback);
  box.addEventListener('submit',async e=>{e.preventDefault();submit.disabled=true;try{await action();}catch(err){feedback.textContent=friendlyError(err);}finally{submit.disabled=false;}});return box;
}
async function render() {
  const ticket=++generation;clear(root);root.append(el('h1',{},'OTI administration'));
  if(!api){root.append(el('p',{},'Administration is awaiting private server configuration.'));return;}
  if(review) {
    const role=el('select',{'aria-label':'Admin review role'},['admin','gigi','coach','participant','board','signed-out'].map(r=>el('option',{value:r,selected:/** @type {any} */(api).viewer()===r},r==='gigi'?'Admin (Gigi)':r==='admin'?'Admin (Julie)':r)));
    role.addEventListener('change',()=>{/** @type {any} */(api).setViewer(role.value);});
    root.append(el('div',{class:'notice'},'Review only · fictional participants · no email or push messages sent.',role));
  }
  const me=await api.getMe();if(ticket!==generation)return;
  if(!me) {
    const email=field('Staff login email','email');const code=field('Sign-in code');code.inputMode='numeric';
    root.append(form('Send sign-in code',[['Email',email]],async()=>{await api.requestCode(email.value.trim().toLowerCase());root.append(form('Verify code',[['Code',code]],async()=>{await api.verifyCode(email.value.trim().toLowerCase(),code.value);await render();}));}));return;
  }
  const signout=el('button',{type:'button',class:'btn small'},'Sign out');signout.addEventListener('click',async()=>{try{await disablePush(api);await api.signOut();await render();}catch{root.append(el('p',{role:'alert'},'Could not finish sign-out. Please try again.'));}});
  root.append(signout);
  if(me.status!=='active'||!['admin','coach'].includes(me.role)){root.append(el('p',{role:'alert'},'Staff access only. Your account cannot open administration.'));return;}
  root.append(el('p',{},`Signed in as ${me.displayName||'staff'} · ${me.role}`));
  if(me.role==='admin') {
    const email=field('New participant login email','email');
    const cohorts=await api.listCohorts();if(ticket!==generation)return;
    const cohort=el('select',{'aria-label':'Registration cohort'},el('option',{value:''},'No cohort yet'),cohorts.map(c=>el('option',{value:c.id},c.name)));
    const box=form('Register participant',[['Login email',email],['Optional cohort',cohort]],async()=>{await api.registerParticipant(email.value,cohort.value||null);await render();root.prepend(el('p',{role:'status'},'Participant registered. They can sign in using this email; no invitation email was sent.'));});root.append(box);
    const {allowlist,profiles}=await api.listMembers();if(ticket!==generation)return;
    const people=el('details',{class:'card'},el('summary',{},'Participant accounts and staff roles'));
    for(const p of profiles) {
      const login=allowlist.find(a=>a.redeemedBy===p.id)?.email||'Login not linked';
      const role=el('select',{'aria-label':`Role for ${p.displayName||login}`},['participant','coach','board','admin','none'].map(r=>el('option',{value:r,selected:r===p.role},r==='none'?'No private access':r)));
      const save=el('button',{type:'button',class:'btn small'},'Save role');save.addEventListener('click',async()=>{try{await api.manageParticipant(p.id,role.value,p.status);await render();}catch(e){root.append(el('p',{role:'alert'},friendlyError(e)));}});
      const revoke=el('button',{type:'button',class:'btn danger small'},p.status==='removed'?'Restore access':'Suspend access');revoke.addEventListener('click',async()=>{try{await api.manageParticipant(p.id,p.role,p.status==='removed'?'active':'removed');await render();}catch(e){root.append(el('p',{role:'alert'},friendlyError(e)));}});
      people.append(el('div',{class:'stack'},el('strong',{},p.displayName||'Participant'),el('span',{},login),el('div',{class:'row'},role,save,revoke)));
    }
    root.append(people);
    const audit=await api.adminAudit();if(ticket!==generation)return;
    root.append(el('details',{class:'card'},el('summary',{},'Administrative audit history'),audit.map(a=>el('p',{},`${new Date(a.created_at).toLocaleString()} · ${a.action} · ${a.entity_type}`))));
  }
  const tabs=el('div',{class:'row'});for(const [value,label] of [['calendar','Cohorts and events'],['activity','Cohort activities']]) {
    const tab=el('button',{class:'btn small',type:'button','aria-pressed':String(section===value)},label);tab.addEventListener('click',()=>{section=value;render();});tabs.append(tab);
  }root.append(tabs);
  const panel=el('section',{'aria-label':'Cohort management'});root.append(panel);mountCohorts(panel,api,/** @type {'calendar'|'activity'} */(section),{management:true});
}
api?.onAuthChange(()=>{clear(root);render();});
// No participant message content, secret keys, exports or push endpoints are loaded by this portal.
render().catch(()=>{clear(root);root.append(el('p',{role:'alert'},'Administration could not load. Please sign in again.'));});
