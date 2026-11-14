import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,chmodSync} from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {providers,providerDefinition} from './providers.mjs';
import {taxPresets} from '../dist/tax.js';
const configSchema=z.object({siteName:z.string().trim().min(1).max(60),taxRegion:z.enum([...taxPresets.map(p=>p.id),'custom']),taxRateMilliPercent:z.number().int().min(0).max(100000),provider:z.enum(Object.keys(providers)),model:z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._:/-]+$/),region:z.enum(['international','china','us']).default('international'),apiKey:z.string().trim().max(2000).regex(/^[^\r\n]*$/).optional(),clearKey:z.boolean().optional(),version:z.number().int().min(0)});
export function createSettings(db,data){
 const keyPath=path.join(data,'settings.key');
 if(!existsSync(keyPath)){const previous=JSON.parse(db.prepare("SELECT value FROM settings WHERE key='site_config'").get()?.value||'{}');if(Object.values(previous.providers||{}).some(p=>p.key))throw new Error('Restore settings.key from the private backup before starting');writeFileSync(keyPath,randomBytes(32),{mode:0o600,flag:'wx'});}
 if(process.platform!=='win32')chmodSync(keyPath,0o600);
 const master=readFileSync(keyPath);if(master.length!==32)throw new Error('Invalid settings encryption key');
 const read=()=>JSON.parse(db.prepare("SELECT value FROM settings WHERE key='site_config'").get()?.value||'{}');
 const encrypt=value=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',master,iv);return {iv:iv.toString('base64'),body:Buffer.concat([cipher.update(value,'utf8'),cipher.final()]).toString('base64'),tag:cipher.getAuthTag().toString('base64')};};
 const decrypt=value=>{const decipher=createDecipheriv('aes-256-gcm',master,Buffer.from(value.iv,'base64'));decipher.setAuthTag(Buffer.from(value.tag,'base64'));return Buffer.concat([decipher.update(Buffer.from(value.body,'base64')),decipher.final()]).toString('utf8');};
 function runtime(provider){const s=read(),id=provider||s.provider||process.env.OCR_PROVIDER||'openai',p=providerDefinition(id),saved=s.providers?.[id]||{};return {provider:id,model:saved.model||process.env[p.env+'_MODEL']||p.model,key:saved.key?decrypt(saved.key):saved.clearKey?'':process.env[p.env+'_API_KEY']||'',region:saved.region||'international',taxRateMilliPercent:s.taxRateMilliPercent??13000};}
 function publicConfig(){const s=read();return {siteName:s.siteName||'Lunaeth Bill',taxRegion:s.taxRegion||'ON',taxRateMilliPercent:s.taxRateMilliPercent??13000};}
 function admin(){const s=read();return {...publicConfig(),version:s.version||0,provider:runtime().provider,providers:Object.entries(providers).map(([id,p])=>{const r=runtime(id);return {id,name:p.name,model:r.model,region:r.region,configured:!!r.key};})};}
 function candidate(body){const b=configSchema.parse(body),s=read();if(b.version!==(s.version||0))throw Object.assign(new Error('设置已被更新，请刷新后重试'),{status:409});const preset=taxPresets.find(p=>p.id===b.taxRegion);if(preset&&preset.rate!==b.taxRateMilliPercent)throw new Error('税率与地区不匹配');return {b,s};}
 function save(body){const {b,s}=candidate(body),old=s.providers?.[b.provider]||{};const entry={...old,model:b.model,region:b.region};if(b.apiKey){entry.key=encrypt(b.apiKey);entry.clearKey=false;}else if(b.clearKey){delete entry.key;entry.clearKey=true;}const next={siteName:b.siteName,taxRegion:b.taxRegion,taxRateMilliPercent:b.taxRateMilliPercent,provider:b.provider,version:(s.version||0)+1,providers:{...s.providers,[b.provider]:entry}};db.prepare("INSERT OR REPLACE INTO settings VALUES('site_config',?)").run(JSON.stringify(next));return admin();}
 function testConfig(body){const {b}=candidate(body);const old=runtime(b.provider);return {...old,model:b.model,region:b.region,key:b.apiKey||(b.clearKey?'':old.key)};}
 return {runtime,publicConfig,admin,save,testConfig};
}
