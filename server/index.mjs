import {createSettings} from './settings.mjs';
import express from 'express';
import helmet from 'helmet';
import {rateLimit} from 'express-rate-limit';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,randomInt,createHash,scrypt as scryptCb,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdirSync,existsSync,readFileSync,writeFileSync,chmodSync,unlinkSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {blankInput,applyDefaultTaxRate,validateDraft,ready,toggleExclusion,csv} from '../dist/model.js';
import {calculate} from '../dist/engine.js';
import {extractReceipt,ocrConfig,configureOCR} from './ocr.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const data=process.env.DATA_DIR||path.join(root,'data');mkdirSync(data,{recursive:true,mode:0o700});
const db=new DatabaseSync(path.join(data,'bill.sqlite'));db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,password TEXT NOT NULL,person TEXT UNIQUE NOT NULL,role TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS invites(token TEXT PRIMARY KEY,person TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bills(id TEXT PRIMARY KEY,title TEXT NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL,input TEXT NOT NULL,confirmations TEXT NOT NULL,snapshot TEXT,created TEXT NOT NULL,updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY,bill TEXT NOT NULL REFERENCES bills(id),mime TEXT NOT NULL,bytes BLOB NOT NULL,sha TEXT NOT NULL,UNIQUE(bill,sha));
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,time TEXT NOT NULL,user_id TEXT,action TEXT NOT NULL,bill TEXT,version INTEGER);
CREATE TABLE IF NOT EXISTS reset_tokens(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,bill TEXT NOT NULL,state TEXT NOT NULL,error TEXT,created TEXT NOT NULL);
`);
db.exec("UPDATE jobs SET state='failed',error='服务重启，请重新识别' WHERE state='running'");
if(!db.prepare('PRAGMA table_info(jobs)').all().some(x=>x.name==='result'))db.exec('ALTER TABLE jobs ADD COLUMN result TEXT');
for(const [name,type] of [['auth_kind',"TEXT NOT NULL DEFAULT 'password'"],['failed_logins','INTEGER NOT NULL DEFAULT 0'],['locked_until','INTEGER NOT NULL DEFAULT 0']])if(!db.prepare('PRAGMA table_info(users)').all().some(x=>x.name===name))db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
if(!db.prepare('PRAGMA table_info(bills)').all().some(x=>x.name==='deleted_at'))db.exec('ALTER TABLE bills ADD COLUMN deleted_at TEXT');
if(!db.prepare('PRAGMA table_info(bills)').all().some(x=>x.name==='created_by')){
 db.exec('ALTER TABLE bills ADD COLUMN created_by TEXT REFERENCES users(id)');
 db.exec("UPDATE bills SET created_by=(SELECT user_id FROM audit WHERE audit.bill=bills.id AND action='create' ORDER BY id LIMIT 1)");
}
if(!db.prepare('PRAGMA table_info(bills)').all().some(x=>x.name==='payee_person'))db.exec('ALTER TABLE bills ADD COLUMN payee_person TEXT');
const get=(q,...p)=>db.prepare(q).get(...p),all=(q,...p)=>db.prepare(q).all(...p),run=(q,...p)=>db.prepare(q).run(...p);
const siteSettings=createSettings(db,data);configureOCR(()=>siteSettings.runtime());
const now=()=>new Date().toISOString(),hash=s=>createHash('sha256').update(s).digest('hex'),token=()=>randomBytes(32).toString('base64url');
if(!db.prepare('PRAGMA table_info(bills)').all().some(x=>x.name==='share_code'))db.exec('ALTER TABLE bills ADD COLUMN share_code TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS bills_share_code ON bills(share_code)');
function newShareCode(){
 const alphabet='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
 for(let attempt=0;attempt<100;attempt++){
  const code=Array.from({length:6},()=>alphabet[randomInt(alphabet.length)]).join('');
  if(!get('SELECT id FROM bills WHERE share_code=?',code))return code;
 }
 throw new Error('无法生成账单链接，请重试');
}
tx(()=>{for(const b of all('SELECT id FROM bills WHERE share_code IS NULL'))run('UPDATE bills SET share_code=? WHERE id=?',newShareCode(),b.id);});
const scrypt=promisify(scryptCb);const setupPath=path.join(data,'setup-token');if(!get('SELECT id FROM users LIMIT 1')&&!existsSync(setupPath))writeFileSync(setupPath,token(),{mode:0o600});
const app=express();app.disable('x-powered-by');if(process.env.TRUST_PROXY==='1')app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'","data:","blob:"],fontSrc:["'self'"],connectSrc:["'self'"],objectSrc:["'none'"],frameAncestors:["'none'"],upgradeInsecureRequests:process.env.NODE_ENV==='production'?[]:null}},crossOriginEmbedderPolicy:false}));
app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');if(!['GET','HEAD'].includes(req.method)){if(req.get('X-Bill-Request')!=='1')return res.status(403).json({error:'请求来源校验失败'});const origin=req.get('Origin');const allowed=process.env.APP_ORIGIN||'http://localhost:5178';if(origin&&!allowed.split(',').includes(origin))return res.status(403).json({error:'请求来源不允许'});}next();});
app.use(express.json({limit:'24mb'}));
app.use('/api',rateLimit({windowMs:60000,limit:300,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'请求过于频繁，请稍后再试'}}));
const authLimit=rateLimit({windowMs:15*60000,limit:25,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'登录尝试过多，请 15 分钟后再试'}});
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function tx(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
function audit(user,action,bill,version){run('INSERT INTO audit(time,user_id,action,bill,version) VALUES(?,?,?,?,?)',now(),user?.id||null,action,bill||null,version||null);}
function publicUser(u){return {id:u.id,username:u.username,personId:u.person,role:u.role};}
function auth(req,res,next){const cookie=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('bill_session='))?.slice(13);const user=cookie&&get('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?',hash(cookie),Date.now());if(!user||user.auth_kind==='reset')return res.status(401).json({error:'请先登录'});req.user=user;if(user.auth_kind!=='pin'&&!['/api/me','/api/account/pin','/api/logout'].includes(req.path))return res.status(428).json({error:'请先设置四位 PIN'});next();}
function owner(req,res,next){if(req.user.role!=='owner')return res.status(403).json({error:'仅账单管理员可执行此操作'});next();}
function canManage(b,user){return user.role==='owner'||b.created_by===user.id;}
function manager(req,res,next){const b=bill(req.params.id,req.user);if(!canManage(b,req.user))return res.status(403).json({error:'仅创建者或管理员可管理此账单'});next();}
function roster(){return JSON.parse(get("SELECT value FROM settings WHERE key='roster'")?.value||JSON.stringify(blankInput().people));}
function billContacts(b){
 const people=roster();const creator=b.created_by&&get('SELECT person,username FROM users WHERE id=?',b.created_by);
 const creatorInfo=creator?{personId:creator.person,displayName:people.find(p=>p.id===creator.person)?.displayName||creator.username}:null;
 const payeeId=b.payee_person||creatorInfo?.personId;
 const payee=payeeId?{personId:payeeId,displayName:people.find(p=>p.id===payeeId)?.displayName||creatorInfo?.displayName||payeeId}:null;
 const emtAddresses=JSON.parse(get("SELECT value FROM settings WHERE key='emt_addresses'")?.value||'{}');
 if(payee&&typeof emtAddresses[payee.personId]==='string')payee.emtAddress=emtAddresses[payee.personId];
 return {creator:creatorInfo,payee};
}
function bill(id,user){const r=get('SELECT * FROM bills WHERE (id=? OR share_code=?) AND deleted_at IS NULL',id,id);if(!r)fail('账单不存在',404);r.input=JSON.parse(r.input);r.confirmations=JSON.parse(r.confirmations);r.snapshot=r.snapshot?JSON.parse(r.snapshot):null;r.canManage=canManage(r,user);if(!r.canManage&&!r.input.people.some(p=>p.id===user.person&&p.enabled))fail('你不在此账单的参与名单中',403);return Object.assign(r,billContacts(r),{canSetPayee:r.created_by===user.id,shareCode:r.share_code});}
function version(b,v){if(b.version!==v)fail('账单已被其他成员更新，已保留服务器版本。请刷新后重试。',409);}
function persist(b,user,action){b.version++;b.updated=now();run('UPDATE bills SET title=?,status=?,version=?,input=?,confirmations=?,snapshot=?,updated=? WHERE id=?',b.title,b.status,b.version,JSON.stringify(b.input),JSON.stringify(b.confirmations),b.snapshot?JSON.stringify(b.snapshot):null,b.updated,b.id);audit(user,action,b.id,b.version);return b;}
function credentials(body,kind='password'){const {username,password}=body;if(typeof username!=='string'||!/^[A-Za-z0-9_]{3,32}$/.test(username))fail('用户名需为 3–32 位字母、数字或下划线');if(typeof password!=='string'||password.length<(kind==='password'?12:4)||password.length>128)fail(kind==='pin'?'PIN 必须为四位数字':'请检查密码或 PIN');if(kind==='pin'&&!/^[0-9]{4}$/.test(password))fail('PIN 必须为四位数字');return {username:username.toLowerCase(),password};}
async function pwHash(password){const salt=randomBytes(16).toString('hex');return salt+':'+Buffer.from(await scrypt(password,salt,64)).toString('hex');}
async function session(res,u){const t=token();run('DELETE FROM sessions WHERE expires<?',Date.now());run('INSERT INTO sessions VALUES(?,?,?)',hash(t),u.id,Date.now()+7*86400000);res.cookie('bill_session',t,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:7*86400000});}
app.get('/api/health',(req,res)=>res.json({ok:true}));
app.get('/api/bootstrap',(req,res)=>res.json({needsSetup:!get('SELECT id FROM users LIMIT 1'),...siteSettings.publicConfig()}));
const resetResolveLimit=rateLimit({windowMs:60000,limit:30,standardHeaders:'draft-8',legacyHeaders:false});
app.post('/api/reset/resolve',resetResolveLimit,(req,res)=>{
 if(typeof req.body.token!=='string'||req.body.token.length>200)fail('重置链接无效或已过期，请联系管理员重新生成',403);
 const reset=get('SELECT u.username,u.person,r.expires FROM reset_tokens r JOIN users u ON u.id=r.user_id WHERE r.token=? AND r.expires>?',hash(req.body.token),Date.now());
 if(!reset)fail('重置链接无效或已过期，请联系管理员重新生成',403);
 res.json({username:reset.username,person:roster().find(p=>p.id===reset.person)?.displayName||reset.person,expiresAt:new Date(reset.expires).toISOString()});
});
const memberResetLimit=rateLimit({windowMs:15*60000,limit:20,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'生成重置链接过于频繁，请稍后再试'}});
app.post('/api/members/reset-pin',auth,owner,memberResetLimit,(req,res)=>{
 if(typeof req.body.personId!=='string')fail('请选择已注册的成员');
 const result=tx(()=>{
  const member=get('SELECT id,username,person,role FROM users WHERE person=?',req.body.personId);
  if(!member)fail('该成员尚未注册',404);
  if(member.role!=='member'||member.id===req.user.id)fail('此功能只能重置普通成员的 PIN',403);
  const t=token(),expires=Date.now()+3600000;
  run('DELETE FROM reset_tokens WHERE user_id=?',member.id);
  run('INSERT INTO reset_tokens(token,user_id,expires) VALUES(?,?,?)',hash(t),member.id,expires);
  run('DELETE FROM sessions WHERE user_id=?',member.id);
  run("UPDATE users SET auth_kind='reset',failed_logins=0,locked_until=0 WHERE id=?",member.id);
  audit(req.user,'issue_member_pin_reset:'+member.id);
  return {token:t,person:roster().find(p=>p.id===member.person)?.displayName||member.person,username:member.username,expiresAt:new Date(expires).toISOString()};
 });
 res.json(result);
});
app.post('/api/setup',authLimit,async(req,res)=>{if(get('SELECT id FROM users LIMIT 1'))fail('初始化已完成',409);if(typeof req.body.token!=='string'||hash(req.body.token)!==hash(readFileSync(setupPath,'utf8').trim()))fail('初始化口令不正确',403);const c=credentials(req.body,'pin');const displayName=req.body.displayName;if(displayName!==undefined&&(typeof displayName!=='string'||!displayName.trim()||displayName.trim().length>80))fail('请检查成员姓名');const person=req.body.personId;if(!roster().some(p=>p.id===person))fail('请选择你的成员身份');const password=await pwHash(c.password);const u={id:randomUUID(),username:c.username,password,person,role:'owner'};tx(()=>{if(get('SELECT id FROM users LIMIT 1'))fail('初始化已完成',409);run('INSERT INTO users(id,username,password,person,role) VALUES(?,?,?,?,?)',u.id,u.username,u.password,u.person,u.role);run("UPDATE users SET auth_kind='pin' WHERE id=?",u.id);if(displayName)run("INSERT OR REPLACE INTO settings VALUES('roster',?)",JSON.stringify(roster().map(p=>p.id===person?{...p,displayName:displayName.trim()}:p)));audit(u,'setup');});await session(res,u);res.json(publicUser(u));});
app.post('/api/login',authLimit,async(req,res)=>{const c=credentials(req.body,'login');const u=get('SELECT * FROM users WHERE username=?',c.username);if(u?.locked_until>Date.now())fail('此账号尝试次数过多，请 15 分钟后再试',429);const [salt,saved]=(u?.password||'missing:'+ '00'.repeat(64)).split(':');const attempt=await scrypt(c.password,salt,64);const valid=!!u&&u.auth_kind!=='reset'&&timingSafeEqual(Buffer.from(saved,'hex'),attempt)&&(u.auth_kind!=='pin'||/^[0-9]{4}$/.test(c.password));if(!valid){if(u){const tries=(u.locked_until?0:u.failed_logins)+1;run('UPDATE users SET failed_logins=?,locked_until=? WHERE id=?',tries,tries>=5?Date.now()+15*60000:0,u.id);}fail('用户名、密码或 PIN 不正确',401);}run('UPDATE users SET failed_logins=0,locked_until=0 WHERE id=?',u.id);await session(res,u);res.json(publicUser(u));});
app.post('/api/reset',authLimit,async(req,res)=>{if(typeof req.body.token!=='string'||typeof req.body.password!=='string'||!/^\d{4}$/.test(req.body.password))fail('请输入重置口令和四位数字 PIN');const key=hash(req.body.token);const reset=get('SELECT * FROM reset_tokens WHERE token=? AND expires>?',key,Date.now());if(!reset)fail('重置口令无效或已过期',403);const password=await pwHash(req.body.password);const u=tx(()=>{if(!get('SELECT token FROM reset_tokens WHERE token=? AND expires>?',key,Date.now()))fail('重置口令已失效',403);run("UPDATE users SET password=?,auth_kind='pin',failed_logins=0,locked_until=0 WHERE id=?",password,reset.user_id);run('DELETE FROM sessions WHERE user_id=?',reset.user_id);run('DELETE FROM reset_tokens WHERE user_id=?',reset.user_id);const u=get('SELECT * FROM users WHERE id=?',reset.user_id);audit(u,'reset_pin');return u;});await session(res,u);res.json(publicUser(u));});
app.post('/api/invites/resolve',rateLimit({windowMs:60000,limit:30,standardHeaders:'draft-8',legacyHeaders:false}),(req,res)=>{if(typeof req.body.token!=='string'||req.body.token.length>200)fail('邀请链接无效',403);const invite=get('SELECT * FROM invites WHERE token=? AND expires>?',hash(req.body.token),Date.now());const person=invite&&roster().find(p=>p.id===invite.person&&p.enabled);if(!person||get('SELECT id FROM users WHERE person=?',person.id))fail('邀请链接已失效，请向管理员获取新的链接',403);res.json({person:person.displayName});});
app.post('/api/register',authLimit,async(req,res)=>{const c=credentials(req.body,'pin');if(typeof req.body.token!=='string')fail('需要邀请口令');const password=await pwHash(c.password);const u=tx(()=>{const invite=get('SELECT * FROM invites WHERE token=? AND expires>?',hash(req.body.token),Date.now());if(!invite||!roster().some(p=>p.id===invite.person&&p.enabled))fail('邀请链接已失效，请向管理员获取新的链接',403);if(get('SELECT id FROM users WHERE username=? OR person=?',c.username,invite.person))fail('用户名或成员已注册',409);const u={id:randomUUID(),username:c.username,password,person:invite.person,role:'member'};run('INSERT INTO users(id,username,password,person,role) VALUES(?,?,?,?,?)',u.id,u.username,u.password,u.person,u.role);run('DELETE FROM invites WHERE person=?',invite.person);run("UPDATE users SET auth_kind='pin' WHERE id=?",u.id);audit(u,'join');return u;});await session(res,u);res.json(publicUser(u));});
app.post('/api/logout',auth,(req,res)=>{run('DELETE FROM sessions WHERE user_id=?',req.user.id);res.clearCookie('bill_session',{path:'/'});res.json({ok:true});});
app.get('/api/me',auth,(req,res)=>res.json({user:publicUser(req.user),needsPin:req.user.auth_kind!=='pin',roster:roster(),members:all('SELECT person,username,role FROM users'),ocrConfigured:!!ocrConfig().key,ocrModel:ocrConfig().model,ocrProvider:ocrConfig().provider,...siteSettings.publicConfig(),...(req.user.role==='owner'?{emtAddresses:JSON.parse(get("SELECT value FROM settings WHERE key='emt_addresses'")?.value||'{}')}:{})}));
app.get('/api/admin/settings',auth,owner,(req,res)=>res.json(siteSettings.admin()));
app.put('/api/admin/settings',auth,owner,(req,res)=>res.json(tx(()=>{const oldRate=siteSettings.publicConfig().taxRateMilliPercent;const result=siteSettings.save(req.body);if(oldRate!==result.taxRateMilliPercent){for(const row of all("SELECT id FROM bills WHERE status!='final' AND deleted_at IS NULL")){const b=bill(row.id,req.user),input=applyDefaultTaxRate(b.input,result.taxRateMilliPercent);if(input!==b.input){b.input=input;b.status='draft';b.confirmations={};b.snapshot=null;persist(b,req.user,'default_tax_changed');}}}audit(req.user,'update_site_settings');return result;})));
const settingsTestLimit=rateLimit({windowMs:60000,limit:5,standardHeaders:'draft-8',legacyHeaders:false});
app.post('/api/admin/settings/test',auth,owner,settingsTestLimit,async(req,res)=>{
 const config=siteSettings.testConfig(req.body);if(!config.key)fail('请填写 API 密钥');
 // A synthetic receipt proves vision and structured output without sending household data.
 const {createCanvas}=await import('@napi-rs/canvas');const canvas=createCanvas(600,300),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,600,300);ctx.fillStyle='black';ctx.font='28px sans-serif';['TEST STORE','2026-01-01','PAPER 10.00','SUBTOTAL 10.00','TAX 0.00','TOTAL CAD 10.00'].forEach((x,i)=>ctx.fillText(x,30,40+i*40));
 const receipt=await extractReceipt([{mime:'image/png',bytes:canvas.toBuffer('image/png')}],config);
 if(receipt.registerTotalCents!==1000||receipt.taxTotalCents!==0||receipt.lines.length!==1||receipt.lines[0].subtotalCents!==1000)fail('接口已响应，但测试小票识别结果未通过，请检查模型',502);
 res.json({ok:true});
});
app.post('/api/account/pin',auth,authLimit,async(req,res)=>{if(typeof req.body.pin!=='string'||!/^\d{4}$/.test(req.body.pin))fail('PIN 必须为四位数字');if(req.user.locked_until>Date.now())fail('此账号尝试次数过多，请稍后再试',429);const [salt,saved]=req.user.password.split(':');const candidate=String(req.body.currentPassword||'').slice(0,128);const attempt=await scrypt(candidate,salt,64);if(!timingSafeEqual(Buffer.from(saved,'hex'),attempt)){const tries=(req.user.locked_until?0:req.user.failed_logins)+1;run('UPDATE users SET failed_logins=?,locked_until=? WHERE id=?',tries,tries>=5?Date.now()+15*60000:0,req.user.id);fail('原密码不正确',401);}const password=await pwHash(req.body.pin);tx(()=>{const current=get('SELECT password,auth_kind FROM users WHERE id=?',req.user.id);if(!current||current.auth_kind==='reset'||current.password!==req.user.password)fail('账号凭据已变更，请重新登录或使用最新重置链接',401);run('DELETE FROM reset_tokens WHERE user_id=?',req.user.id);run("UPDATE users SET password=?,auth_kind='pin',failed_logins=0,locked_until=0 WHERE id=?",password,req.user.id);run('DELETE FROM sessions WHERE user_id=?',req.user.id);audit(req.user,'set_pin');});await session(res,req.user);res.json({ok:true});});
app.put('/api/members/:id',auth,owner,(req,res)=>res.json(tx(()=>{
 const people=roster(),member=people.find(p=>p.id===req.params.id);if(!member)fail('成员不存在',404);
 const name=req.body.displayName,address=req.body.emtAddress;
 if(typeof name!=='string'||!name.trim()||name.trim().length>80||typeof address!=='string'||address.length>254||/[\r\n]/.test(address))fail('请检查成员姓名和 E-Transfer 地址');
 member.displayName=name.trim();const addresses=JSON.parse(get("SELECT value FROM settings WHERE key='emt_addresses'")?.value||'{}');
 if(address.trim())addresses[member.id]=address.trim();else delete addresses[member.id];
 run("INSERT OR REPLACE INTO settings VALUES('roster',?)",JSON.stringify(people));run("INSERT OR REPLACE INTO settings VALUES('emt_addresses',?)",JSON.stringify(addresses));audit(req.user,'edit_member:'+member.id);return {ok:true};
})));
app.put('/api/roster',auth,owner,(req,res)=>{const people=validateDraft({...blankInput(),people:req.body.people}).people;for(const u of all('SELECT person FROM users'))if(!people.some(p=>p.id===u.person))fail('已注册成员不能删除，可设为停用');run("INSERT OR REPLACE INTO settings VALUES('roster',?)",JSON.stringify(people));res.json(people);});
app.post('/api/invites',auth,owner,(req,res)=>{const p=roster().find(p=>p.id===req.body.personId&&p.enabled);if(!p||get('SELECT id FROM users WHERE person=?',p.id))fail('成员不存在或已注册');let t;do{t=randomBytes(5).toString('base64url').slice(0,6);}while(get('SELECT token FROM invites WHERE token=?',hash(t)));tx(()=>{run('DELETE FROM invites WHERE person=?',p.id);run('INSERT INTO invites VALUES(?,?,?)',hash(t),p.id,Date.now()+72*3600000);audit(req.user,'invite');});res.json({token:t,person:p.displayName,expiresHours:72});});
app.get('/api/bills',auth,(req,res)=>{const deleted=req.query.deleted==='1';const rows=all('SELECT * FROM bills WHERE deleted_at IS '+(deleted?'NOT NULL':'NULL')+' ORDER BY created DESC');res.json(rows.filter(b=>canManage(b,req.user)||(!deleted&&JSON.parse(b.input).people.some(p=>p.id===req.user.person&&p.enabled))).map(b=>({id:b.id,shareCode:b.share_code,title:b.title,status:b.status,version:b.version,updated:b.updated,deletedAt:b.deleted_at,items:JSON.parse(b.input).items.length,creator:billContacts(b).creator})));});
app.post('/api/bills',auth,(req,res)=>{const title=String(req.body.title||'新的购物账单').trim().slice(0,120);let input=req.body.input?validateDraft(req.body.input):blankInput(roster());if(input.people.some(p=>!roster().some(r=>r.id===p.id)))fail('导入文件包含未登记成员，请先在成员设置中添加');if(!req.body.input&&req.body.participantIds!==undefined){const ids=req.body.participantIds;if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!roster().some(p=>p.id===id&&p.enabled)))fail('请选择至少一位有效参与人');input.people=input.people.map(p=>({...p,enabled:ids.includes(p.id)}));}if(!input.people.some(p=>p.enabled))fail('至少需要一位参与人');input.receipts=input.receipts.map(r=>({...r,reviewed:false,sourceImages:[]}));const id=randomUUID();run('INSERT INTO bills(id,title,status,version,input,confirmations,snapshot,created,updated,created_by,share_code) VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,title,'draft',1,JSON.stringify(input),'{}',null,now(),now(),req.user.id,newShareCode());audit(req.user,'create',id,1);res.status(201).json(bill(id,req.user));});
app.get('/api/bills/:id',auth,(req,res)=>res.json(bill(req.params.id,req.user)));
app.post('/api/bills/:id/rename',auth,manager,(req,res)=>res.json(tx(()=>{
 const b=bill(req.params.id,req.user);version(b,req.body.version);
 const title=typeof req.body.title==='string'?req.body.title.trim():'';
 if(!title||title.length>120)fail('账单名称须为 1 至 120 个字符');
 if(title===b.title)return b;
 // Rename metadata only; keep selections, confirmations and final amounts intact.
 run('UPDATE bills SET title=?,version=version+1,updated=? WHERE id=?',title,now(),b.id);
 audit(req.user,'rename',b.id,b.version+1);
 return bill(b.id,req.user);
})));
app.post('/api/bills/:id/payee',auth,manager,(req,res)=>res.json(tx(()=>{
 const b=bill(req.params.id,req.user);if(!b.canSetPayee)fail('仅账单发起人可选择收款人',403);version(b,req.body.version);
 const person=roster().find(p=>p.id===req.body.personId&&(p.enabled||p.id===b.creator?.personId));
 if(!person)fail('请选择有效的收款人');
 if(b.payee?.personId===person.id)return b;
 // Only contact metadata changes; preserve finalized amounts and confirmations byte for byte.
 run('UPDATE bills SET payee_person=?,version=version+1,updated=? WHERE id=?',person.id,now(),b.id);
 audit(req.user,'payee:'+person.id,b.id,b.version+1);
 return bill(b.id,req.user);
})));
app.delete('/api/bills/:id',auth,manager,(req,res)=>{tx(()=>{const b=bill(req.params.id,req.user);version(b,req.body.version);run('UPDATE bills SET deleted_at=?,updated=?,version=version+1 WHERE id=?',now(),now(),b.id);audit(req.user,'delete',b.id,b.version+1);});res.json({ok:true});});
app.post('/api/bills/:id/restore',auth,(req,res)=>{tx(()=>{const b=get('SELECT * FROM bills WHERE id=? AND deleted_at IS NOT NULL',req.params.id);if(!b)fail('回收站中没有此账单',404);if(!canManage(b,req.user))fail('仅创建者或管理员可恢复此账单',403);version(b,req.body.version);run('UPDATE bills SET deleted_at=NULL,updated=?,version=version+1 WHERE id=?',now(),b.id);audit(req.user,'restore',b.id,b.version+1);});res.json({ok:true});});
app.put('/api/bills/:id',auth,manager,(req,res)=>res.json(tx(()=>{const b=bill(req.params.id,req.user);version(b,req.body.version);if(b.status!=='draft')fail('请先重新打开账单，修改后所有成员需要重新确认',409);const input=validateDraft(req.body.input);if(!input.people.some(p=>p.enabled))fail('至少需要一位参与人');if(input.extraCharges.some(c=>c.personIds.some(id=>!input.people.some(p=>p.id===id&&p.enabled))))fail('请先修改涉及未参与成员的额外费用');if(input.people.some(p=>!roster().some(r=>r.id===p.id)))fail('请先在成员设置中登记新成员');for(const r of input.receipts)for(const f of r.sourceImages||[])if(!get('SELECT id FROM files WHERE id=? AND bill=?',f,b.id))fail('小票附件引用无效');b.input=input;b.title=String(req.body.title||b.title).slice(0,120);b.confirmations={};b.snapshot=null;return persist(b,req.user,'edit');})));
app.post('/api/bills/:id/publish',auth,manager,(req,res)=>res.json(tx(()=>{const b=bill(req.params.id,req.user);version(b,req.body.version);if(b.status!=='draft')fail('账单已发布',409);ready(b.input);b.status='selecting';b.confirmations={};return persist(b,req.user,'publish');})));
app.post('/api/bills/:id/reopen',auth,manager,(req,res)=>res.json(tx(()=>{const b=bill(req.params.id,req.user);version(b,req.body.version);b.status='draft';b.confirmations={};b.snapshot=null;return persist(b,req.user,'reopen');})));
function selectionTarget(b,user,requested){
 const target=requested===undefined?user.person:requested;
 if(target!==user.person&&user.role!=='owner')fail('仅管理员可代其他成员操作',403);
 if(!b.input.people.some(p=>p.enabled&&p.id===target))fail('该成员未参与此账单',403);
 return target;
}
app.post('/api/bills/:id/selection',auth,(req,res)=>res.json(tx(()=>{
 const b=bill(req.params.id,req.user);version(b,req.body.version);if(b.status!=='selecting')fail('当前账单未开放选择',409);
 const target=selectionTarget(b,req.user,req.body.personId);
 if(!b.input.items.some(i=>i.id===req.body.itemId&&!i.excludedFromPool))fail('商品不存在或不在分账池');
 b.input=toggleExclusion(b.input,req.body.itemId,target);delete b.confirmations[target];b.snapshot=null;
 return persist(b,req.user,target===req.user.person?'selection':'proxy_selection:'+target);
})));
app.post('/api/bills/:id/confirm',auth,(req,res)=>res.json(tx(()=>{
 const b=bill(req.params.id,req.user);version(b,req.body.version);if(b.status!=='selecting')fail('账单不在确认阶段',409);
 const target=selectionTarget(b,req.user,req.body.personId);if(b.confirmations[target])return b;
 b.confirmations[target]=now();
 if(b.input.people.filter(p=>p.enabled).every(p=>b.confirmations[p.id])){const result=ready(b.input);b.status='final';b.snapshot={result,input:structuredClone(b.input),finalizedAt:now()};}
 return persist(b,req.user,target===req.user.person?'confirm':'proxy_confirm:'+target);
})));
app.get('/api/bills/:id/export',auth,(req,res)=>{const b=bill(req.params.id,req.user);if(req.query.format==='csv'){if(b.status!=='final')fail('全员确认后可导出分摊金额',409);res.type('text/csv').attachment('bill.csv').send(csv(b.input,b.snapshot.result));}else res.type('application/json').attachment('bill.json').send(JSON.stringify({schemaVersion:1,title:b.title,status:b.status,creator:b.creator,payee:b.payee,input:b.input,confirmations:b.confirmations,snapshot:b.snapshot},null,2));});
app.get('/api/files/:id',auth,(req,res)=>{const f=get('SELECT * FROM files WHERE id=?',req.params.id);if(!f)fail('附件不存在',404);bill(f.bill,req.user);res.type(f.mime).set('Content-Disposition','inline').send(Buffer.from(f.bytes));});
app.post('/api/bills/:id/files',auth,manager,(req,res)=>{const b=bill(req.params.id,req.user);if(b.status!=='draft')fail('请先重新打开账单',409);const {mime,base64}=req.body;if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(mime)||typeof base64!=='string')fail('支持 JPEG、PNG、WebP 或 PDF');const bytes=Buffer.from(base64,'base64');if(!bytes.length||bytes.length>10*1024*1024)fail('每个附件最大 10 MB');const hex=bytes.subarray(0,12).toString('hex');if(!(mime==='image/jpeg'&&hex.startsWith('ffd8ff')||mime==='image/png'&&hex.startsWith('89504e470d0a1a0a')||mime==='application/pdf'&&bytes.subarray(0,5).toString()==='%PDF-'||mime==='image/webp'&&bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'))fail('文件内容与类型不符');const sha=hash(bytes);const old=get('SELECT id FROM files WHERE bill=? AND sha=?',b.id,sha);if(old)return res.json({id:old.id,duplicate:true});if(get('SELECT count(*) n FROM files WHERE bill=?',b.id).n>=40)fail('每份账单最多 40 个附件');const id=randomUUID();run('INSERT INTO files VALUES(?,?,?,?,?)',id,b.id,mime,bytes,sha);res.status(201).json({id});});
const ocrLimit=rateLimit({windowMs:3600000,limit:20,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'每小时最多识别 20 次，请稍后再试'}});
app.get('/api/bills/:id/extraction',auth,manager,(req,res)=>{const b=bill(req.params.id,req.user);const job=get("SELECT * FROM jobs WHERE bill=? AND state IN ('running','completed','failed') ORDER BY created DESC LIMIT 1",b.id);res.json(job?{id:job.id,state:job.state,created:job.created,error:job.error,result:job.result?JSON.parse(job.result):null}:null);});
app.post('/api/bills/:id/extraction-dismiss',auth,manager,(req,res)=>{bill(req.params.id,req.user);run("UPDATE jobs SET state='dismissed' WHERE id=? AND bill=? AND state!='running'",req.body.jobId,req.params.id);res.json({ok:true});});
app.post('/api/bills/:id/extract',auth,manager,ocrLimit,(req,res)=>{const b=bill(req.params.id,req.user);version(b,req.body.version);if(b.status!=='draft')fail('请先重新打开账单',409);if(!ocrConfig().key)fail('识别 API 尚未配置，可以先手动录入',503);if(get("SELECT id FROM jobs WHERE state='running'"))fail('已有小票正在识别，请等待完成',409);const ids=req.body.fileIds;if(!Array.isArray(ids)||!ids.length||ids.length>5)fail('同一张小票可上传 1–5 页');const files=ids.map(id=>{const f=get('SELECT * FROM files WHERE id=? AND bill=?',id,b.id);if(!f)fail('附件不属于此账单');return f;});const job=randomUUID();run('INSERT INTO jobs(id,bill,state,error,created,result) VALUES(?,?,?,?,?,?)',job,b.id,'running',null,now(),null);res.status(202).json({id:job,state:'running'});void extractReceipt(files,ocrConfig()).then(extracted=>run("UPDATE jobs SET state='completed',result=? WHERE id=?",JSON.stringify({extracted,fileIds:ids,version:b.version,jobId:job}),job)).catch(e=>run("UPDATE jobs SET state='failed',error=? WHERE id=?",String(e.message).slice(0,300),job));});
app.use('/api',(req,res)=>res.status(404).json({error:'接口不存在'}));
app.use(express.static(path.join(root,'web-dist'),{index:false,maxAge:'1h'}));
app.get('/{*path}',(req,res)=>res.set('Cache-Control','no-cache').sendFile(path.join(root,'web-dist/index.html')));
app.use((err,req,res,next)=>{const status=err.status||400;res.status(status).json({error:err.name==='ZodError'?'数据格式不正确，请检查金额、名称和必填字段':status===413?'上传内容过大':String(err.message||'请求失败').slice(0,900)});});
export {app,db};
// Importing the app permits socket-free integration tests; direct execution starts production normally.
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href){
const socket=process.env.SOCKET_PATH;
if(socket&&existsSync(socket))unlinkSync(socket);
const server=socket?app.listen(socket,()=>{chmodSync(socket,0o660);console.log('Luna Bill listening on local Unix socket');}):app.listen(Number(process.env.PORT||3088),'127.0.0.1',()=>console.log(`Luna Bill listening at http://127.0.0.1:${process.env.PORT||3088}`));server.requestTimeout=180000;
process.on('SIGTERM',()=>server.close(()=>{db.close();process.exit(0);}));
}
