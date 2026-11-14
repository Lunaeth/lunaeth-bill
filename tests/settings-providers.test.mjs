import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createSettings} from '../server/settings.mjs';
import {providers} from '../server/providers.mjs';
import {extractReceipt,applyReceiptTaxRules} from '../server/ocr.mjs';
import {defaultTaxCents,applyDefaultTaxRate,blankInput} from '../dist/model.js';
import {taxPresets,parseTaxRate} from '../dist/tax.js';
import {prepareImages} from '../server/media.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA1sAAAAASUVORK5CYII=','base64');
const receipt={merchant:'Synthetic Test Store',date:'2026-01-01',registerTotalCents:1130,taxTotalCents:130,warnings:[],lines:[{rawLabel:'PAPER H',description:'纸',category:'其他',quantity:1,subtotalCents:1000,discountCents:0,taxMarker:'H',taxCents:null,excludedFromPool:false,confidence:1,note:''}]};
test('all thirteen tax presets and fractional custom rates use integer arithmetic',()=>{
 assert.equal(taxPresets.length,13);assert.equal(new Set(taxPresets.map(p=>p.id)).size,13);
 assert.equal(parseTaxRate('14.975'),14975);assert.equal(defaultTaxCents(10000,14975),1498);assert.equal(defaultTaxCents(999,0),0);assert.throws(()=>parseTaxRate('100.001'));
 const result=applyReceiptTaxRules({...receipt,registerTotalCents:1140,taxTotalCents:140},14000);assert.equal(result.lines[0].taxCents,140);
});
test('tax updates recalculate manual records and flag printed receipts without rewriting printed totals',()=>{
 const input=blankInput();input.receipts=[{id:'manual',merchant:'Manual',entryMode:'manual',date:'2026-01-01',registerTotalCents:1130,taxTotalCents:130,excludedCents:0,reviewed:true},{id:'paper',merchant:'Printed',date:'2026-01-01',registerTotalCents:1130,taxTotalCents:130,excludedCents:0,reviewed:true}];
 input.items=input.receipts.map(r=>({id:r.id,receiptId:r.id,categoryId:'8',description:'Synthetic item',quantity:1,subtotalCents:1000,discountCents:0,taxCents:130,taxable:true,excludedPersonIds:[],excludedFromPool:false}));
 const out=applyDefaultTaxRate(input,5000);assert.deepEqual(out.items.map(i=>i.taxCents),[50,50]);assert.equal(out.receipts[0].registerTotalCents,1050);assert.equal(out.receipts[0].reviewed,true);assert.equal(out.receipts[1].registerTotalCents,1130);assert.equal(out.receipts[1].taxTotalCents,130);assert.equal(out.receipts[1].reviewed,false);assert.equal(input.items[0].taxCents,130);
});
test('write-only API keys are encrypted, retained per provider and survive restart',()=>{
 const data=mkdtempSync(path.join(tmpdir(),'bill-settings-')),db=new DatabaseSync(path.join(data,'test.sqlite'));db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)');let store=createSettings(db,data);
 const body={...store.publicConfig(),version:0,provider:'muse',model:providers.muse.model,region:'international',apiKey:'synthetic-private-key'};
 const saved=store.save(body);assert.equal(saved.version,1);assert.equal(saved.providers.find(p=>p.id==='muse').configured,true);assert.ok(!JSON.stringify(saved).includes(body.apiKey));assert.ok(!db.prepare('SELECT value FROM settings').get().value.includes(body.apiKey));assert.ok(!JSON.stringify(store.publicConfig()).includes('provider'));
 store=createSettings(db,data);assert.equal(store.runtime().key,body.apiKey);assert.equal(readFileSync(path.join(data,'settings.key')).length,32);
 store.save({...body,version:1,provider:'qwen',model:providers.qwen.model,apiKey:'other-synthetic-key'});assert.equal(store.runtime('muse').key,body.apiKey);
 store.save({...body,version:2,apiKey:''});assert.equal(store.runtime().key,body.apiKey);assert.throws(()=>store.save(body),e=>e.status===409);
 assert.throws(()=>store.save({...body,version:3,taxRegion:'QC',taxRateMilliPercent:13000}));
 store.save({...body,version:3,apiKey:'',clearKey:true});assert.equal(store.runtime().key,'');db.close();
});
for(const provider of Object.keys(providers))test(`${provider} vision adapter sends only to its provider and validates structured receipts`,async()=>{
 let calls=0;const fetcher=async(url,options)=>{calls++;assert.ok(url.startsWith(providers[provider].base));assert.equal(options.redirect,'error');const body=JSON.parse(options.body);if(provider==='gemini')assert.ok(url.includes(providers[provider].model));else assert.equal(body.model,providers[provider].model);assert.ok(JSON.stringify(body).includes(png.toString('base64')));let result;
 if(provider==='gemini'){assert.equal(options.headers['x-goog-api-key'],'synthetic-key');result={candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(receipt)}]}}]};}
 else if(provider==='anthropic'){assert.equal(options.headers['x-api-key'],'synthetic-key');result={stop_reason:'tool_use',content:[{type:'tool_use',name:'receipt_extraction',input:receipt}]};}
 else if(providers[provider].kind==='chat'){assert.equal(options.headers.Authorization,'Bearer synthetic-key');result={choices:[{finish_reason:'stop',message:{content:JSON.stringify(receipt)}}]};}
 else result={status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(receipt)}]}]};
 return {ok:true,json:async()=>result};};
 const out=await extractReceipt([{mime:'image/png',bytes:png}],{provider,model:providers[provider].model,key:'synthetic-key',fetcher});assert.equal(calls,1);assert.equal(out.lines[0].taxCents,130);
 await assert.rejects(()=>extractReceipt([{mime:'image/png',bytes:png}],{provider,key:'synthetic-key',fetcher:async()=>({ok:false,status:401})}),/401/);
});
test('PDFs render locally to images for image-only providers',async()=>{
 const parts=['%PDF-1.4\n'];let offsets=[0];const add=(id,s)=>{offsets[id]=Buffer.byteLength(parts.join(''));parts.push(`${id} 0 obj\n${s}\nendobj\n`);};
 add(1,'<< /Type /Catalog /Pages 2 0 R >>');add(2,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>');add(3,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>');add(4,'<< /Length 0 >>\nstream\n\nendstream');const xref=Buffer.byteLength(parts.join(''));parts.push('xref\n0 5\n0000000000 65535 f \n'+offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Root 1 0 R /Size 5 >>\nstartxref\n${xref}\n%%EOF`);
 const result=await prepareImages([{mime:'application/pdf',bytes:Buffer.from(parts.join(''))}],{pdf:false});assert.equal(result.length,1);assert.equal(result[0].mime,'image/png');assert.equal(result[0].bytes.subarray(1,4).toString(),'PNG');
});
