import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';
import {requestInProcess} from './http-in-process.mjs';import {blankInput,saveItemDraft,manualReceiptChoice,defaultNames} from '../dist/model.js';
test('admin settings, privacy, tax repricing, final immutability, member reset and share permissions',async()=>{
 const data=mkdtempSync(path.join(tmpdir(),'bill-admin-api-'));Object.assign(process.env,{DATA_DIR:data,NODE_ENV:'test',APP_ORIGIN:'http://test.local',OPENAI_API_KEY:'',GEMINI_API_KEY:''});
 const {app,db}=await import('../server/index.mjs?admin-test');let ownerCookie='',memberCookie='';
 const req=(url,body,method,cookie=ownerCookie,headers)=>requestInProcess(app,url,body,method,cookie,headers);
 try{
 const setup=await req('/setup',{username:'test_owner',password:'1357',personId:defaultNames[0],displayName:'Test Owner',token:readFileSync(path.join(data,'setup-token'),'utf8')});assert.equal(setup.status,200);ownerCookie=setup.cookie;
 const people=[{id:defaultNames[0],displayName:'Test Owner',enabled:true},{id:'test_member',displayName:'Test Member',enabled:true}];assert.equal((await req('/roster',{people},'PUT')).status,200);
 const invite=(await req('/invites',{personId:'test_member'})).data;assert.match(invite.token,/^[A-Za-z0-9_-]{6}$/);
 const member=await req('/register',{username:'test_member',password:'2468',token:invite.token});memberCookie=member.cookie;assert.equal(member.status,200);
 assert.equal((await req('/admin/settings',undefined,'GET','')).status,401);assert.equal((await req('/admin/settings',undefined,'GET',memberCookie)).status,403);
 const before=(await req('/admin/settings')).data;let payload={siteName:'Test Bill Book',taxRegion:'ON',taxRateMilliPercent:13000,version:before.version,provider:'gemini',model:'gemini-3.8-flash',region:'international',apiKey:'synthetic-test-only-key'};
 assert.equal((await req('/admin/settings',payload,'PUT',memberCookie)).status,403);assert.equal((await req('/admin/settings',payload,'PUT',ownerCookie,{'x-bill-request':''})).status,403);
 let config=(await req('/admin/settings',payload,'PUT')).data;assert.equal(config.siteName,payload.siteName);assert.ok(!JSON.stringify(config).includes(payload.apiKey));assert.ok(!JSON.stringify((await req('/me')).data).includes(payload.apiKey));assert.ok(!JSON.stringify((await req('/bootstrap',undefined,'GET','')).data).includes('configured'));
 assert.equal((await req('/admin/settings',payload,'PUT')).status,409);
 let draft=(await req('/bills',{title:'Synthetic unfinished bill',participantIds:people.map(p=>p.id)})).data;
 const item={id:'synthetic-item',receiptId:manualReceiptChoice,categoryId:'8',description:'Synthetic paper',quantity:1,subtotalCents:1000,discountCents:0,taxCents:130,taxable:true,excludedPersonIds:[],excludedFromPool:false};
 let input=saveItemDraft(draft.input,item,'synthetic-receipt','2026-01-01');draft=(await req('/bills/'+draft.id,{version:draft.version,input},'PUT')).data;
 let final=(await req('/bills',{title:'Synthetic final bill',participantIds:people.map(p=>p.id)})).data;final=(await req('/bills/'+final.id,{version:final.version,input},'PUT')).data;final=(await req('/bills/'+final.id+'/publish',{version:final.version})).data;
 final=(await req('/bills/'+final.id+'/confirm',{version:final.version})).data;final=(await req('/bills/'+final.id+'/confirm',{version:final.version},'POST',memberCookie)).data;assert.equal(final.status,'final');const frozen=structuredClone(final);
 draft=(await req('/bills/'+draft.id+'/publish',{version:draft.version})).data;draft=(await req('/bills/'+draft.id+'/confirm',{version:draft.version})).data;assert.ok(Object.keys(draft.confirmations).length);
 payload={...payload,version:config.version,apiKey:'',taxRegion:'QC',taxRateMilliPercent:14975};config=(await req('/admin/settings',payload,'PUT')).data;
 draft=(await req('/bills/'+draft.id)).data;assert.equal(draft.status,'draft');assert.deepEqual(draft.confirmations,{});assert.equal(draft.input.items[0].taxCents,150);assert.equal(draft.input.receipts[0].registerTotalCents,1150);assert.equal(draft.input.receipts[0].reviewed,true);assert.equal(draft.input.taxRateMilliPercent,undefined);
 final=(await req('/bills/'+final.id)).data;assert.deepEqual(final.input,frozen.input);assert.deepEqual(final.snapshot,frozen.snapshot);assert.deepEqual(final.confirmations,frozen.confirmations);assert.equal(final.version,frozen.version);
 const renamed=(await req('/bills/'+final.shareCode+'/rename',{version:final.version,title:'Renamed synthetic bill'})).data;assert.equal(renamed.title,'Renamed synthetic bill');assert.deepEqual(renamed.snapshot,final.snapshot);
 assert.equal((await req('/bills/'+final.id+'/rename',{version:renamed.version,title:'denied'},'POST',memberCookie)).status,403);
 assert.equal((await req('/members/test_member',{displayName:'Test Member Updated',emtAddress:'member@example.invalid'},'PUT')).status,200);assert.equal((await req('/me')).data.emtAddresses.test_member,'member@example.invalid');assert.equal((await req('/me',undefined,'GET',memberCookie)).data.emtAddresses,undefined);
 const reset=await req('/members/reset-pin',{personId:'test_member'});assert.equal(reset.status,200);assert.equal((await req('/me',undefined,'GET',memberCookie)).status,401);assert.equal((await req('/login',{username:'test_member',password:'2468'})).status,401);
 const resetResult=await req('/reset',{token:reset.data.token,password:'5678'});assert.equal(resetResult.status,200);assert.equal((await req('/reset',{token:reset.data.token,password:'9876'})).status,403);
 const own=(await req('/bills',{title:'Member-created synthetic bill'},'POST',resetResult.cookie)).data;assert.equal(own.canManage,true);assert.equal((await req('/bills/'+own.id,{version:own.version},'DELETE',resetResult.cookie)).status,200);assert.equal((await req('/bills/'+own.shareCode)).status,404);
 }finally{db.close();}
});
