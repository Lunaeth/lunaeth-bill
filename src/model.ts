import { z } from 'zod';
import { calculate, type AllocationInput } from './engine.js';
const id=z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/);
const text=z.string().min(1).max(200);
const cents=z.number().int().min(0).max(100000000);
const signed=z.number().int().min(-100000000).max(0);
const note=z.string().max(4000).optional();
export const inputSchema=z.object({currency:z.literal('CAD'),
 people:z.array(z.object({id,displayName:text,enabled:z.boolean()})).min(1).max(30),
 categories:z.array(z.object({id,name:text,sortOrder:z.number().int()})).min(1).max(30),
 receipts:z.array(z.object({id,merchant:text,date:z.string().max(30),entryMode:z.literal('manual').optional(),registerTotalCents:cents,excludedCents:cents,taxTotalCents:cents,excludedTaxCents:cents.optional(),sourceImages:z.array(z.string().min(1).max(200)).max(20).optional(),notes:note,reviewed:z.boolean().optional()})).max(50),
 items:z.array(z.object({id,receiptId:id,categoryId:id,description:text,sourceLabel:z.string().max(400).optional(),nameSourceUrl:z.string().url().max(3000).regex(/^https:\/\//).optional(),quantity:z.number().positive().max(100000),subtotalCents:cents,discountCents:signed,taxCents:cents,taxable:z.boolean().optional(),excludedPersonIds:z.array(id).max(30),excludedFromPool:z.boolean(),soloBuyerId:id.optional(),sourceStatus:z.string().max(80).optional(),note})).max(1500),
 extraCharges:z.array(z.object({id,description:text,kind:z.enum(['fixed-per-person','split-total']),personIds:z.array(id).max(30),perPersonCents:cents.optional(),totalCents:cents.optional()})).max(50)
});
export type BillInput=z.infer<typeof inputSchema>;
export const manualReceiptChoice='__manual__';
export function saveItemDraft(input:BillInput,item:BillInput['items'][number],newReceiptId:string,date:string):BillInput{
 let receipts=[...input.receipts];
 if(item.excludedFromPool&&item.soloBuyerId!==undefined){const {soloBuyerId:_removed,...rest}=item;item=rest;}
 if(item.receiptId===manualReceiptChoice){
  let receipt=receipts.find(r=>r.entryMode==='manual');
  if(!receipt){
   receipt={id:newReceiptId,merchant:'手动录入',date,entryMode:'manual',registerTotalCents:0,taxTotalCents:0,excludedCents:0,excludedTaxCents:0,reviewed:true,sourceImages:[]};
   receipts.push(receipt);
  }
  item={...item,receiptId:receipt.id};
 }
 const previous=input.items.find(x=>x.id===item.id);
 const items=previous?input.items.map(x=>x.id===item.id?item:x):[...input.items,item];
 receipts=receipts.map(r=>{
  if(r.id!==item.receiptId&&r.id!==previous?.receiptId)return r;
  if(r.entryMode!=='manual')return {...r,reviewed:false};
  const lines=items.filter(i=>i.receiptId===r.id);
  const sum=(onlyExcluded:boolean,taxOnly:boolean)=>lines.filter(i=>!onlyExcluded||i.excludedFromPool).reduce((n,i)=>n+i.taxCents+(taxOnly?0:i.subtotalCents+i.discountCents),0);
  return {...r,registerTotalCents:sum(false,false),taxTotalCents:sum(false,true),excludedCents:sum(true,false),excludedTaxCents:sum(true,true),reviewed:true};
 });
 return validateDraft({...input,items,receipts});
}
export const defaultNames=['Member1','Member2','Member3','Member4','Member5','Member6'];
export const categoryNames=['奶制品','熟食、包子、饺子','丸子、鱼豆腐','肉类、海鲜','蔬菜','调味料、酱料','饮料、雪糕','其他','Costco'];
export function blankInput(people=defaultNames.map(displayName=>({id:displayName,displayName,enabled:true}))):BillInput{return {currency:'CAD',people:structuredClone(people),categories:categoryNames.map((name,i)=>({id:String(i+1),name,sortOrder:i})),receipts:[],items:[],extraCharges:[]};}
export function parseMoney(value:string){if(!/^-?\d{1,6}(\.\d{1,2})?$/.test(value.trim()))throw new Error('金额请填写数字，最多两位小数');const negative=value.startsWith('-');const [whole,fraction='']=value.replace('-','').split('.');return (Number(whole)*100+Number(fraction.padEnd(2,'0')))*(negative?-1:1);}
export function moneyInput(cents:number){return `${cents<0?'-':''}${Math.floor(Math.abs(cents)/100)}.${String(Math.abs(cents)%100).padStart(2,'0')}`;}
type RecognizedAmounts = {
  registerTotalCents: number | null;
  taxTotalCents: number | null;
  lines: {subtotalCents:number|null; discountCents:number|null; taxCents:number|null}[];
};

export function receiptAmountsMatch(receipt: RecognizedAmounts): boolean {
  if (!receipt.lines.length || !Number.isSafeInteger(receipt.registerTotalCents) ||
      !Number.isSafeInteger(receipt.taxTotalCents)) return false;
  let gross = 0, tax = 0;
  // Compare the entire printed receipt, including items excluded from sharing.
  for (const {subtotalCents, discountCents, taxCents} of receipt.lines) {
    if (subtotalCents == null || discountCents == null || taxCents == null ||
        ![subtotalCents, discountCents, taxCents].every(Number.isSafeInteger)) return false;
    const net = subtotalCents + discountCents;
    if (net < 0) return false;
    gross += net + taxCents;
    tax += taxCents;
  }
  return gross === receipt.registerTotalCents && tax === receipt.taxTotalCents;
}
export function defaultTaxCents(netCents:number,rate=13000){if(!Number.isSafeInteger(netCents)||netCents<0||!Number.isSafeInteger(rate)||rate<0||rate>100000)throw new Error('计税金额或税率无效');return Number((BigInt(netCents)*BigInt(rate)+50000n)/100000n);}
export function reconcile(input:BillInput){return input.receipts.map(r=>{const lines=input.items.filter(x=>x.receiptId===r.id&&!x.excludedFromPool);const total=lines.reduce((n,x)=>n+x.subtotalCents+x.discountCents+x.taxCents,0);const tax=lines.reduce((n,x)=>n+x.taxCents,0);return {id:r.id,total,tax,difference:r.registerTotalCents-r.excludedCents-total,taxDifference:r.taxTotalCents-(r.excludedTaxCents||0)-tax};});}
export function validateDraft(raw:unknown):BillInput{const f=inputSchema.parse(raw);for(const arr of [f.people,f.categories,f.receipts,f.items,f.extraCharges])if(new Set(arr.map(x=>x.id)).size!==arr.length)throw new Error('编号重复');const people=new Set(f.people.map(x=>x.id));const receipts=new Set(f.receipts.map(x=>x.id));const cats=new Set(f.categories.map(x=>x.id));for(const x of f.items){if(!receipts.has(x.receiptId)||!cats.has(x.categoryId))throw new Error('商品引用了不存在的小票或类别');if(x.excludedPersonIds.some(p=>!people.has(p)))throw new Error('商品引用了不存在的成员');if(x.soloBuyerId!==undefined){if(!people.has(x.soloBuyerId))throw new Error('商品引用了不存在的成员');if(x.excludedFromPool)throw new Error('移出分账池的商品不能设为独购');}if(x.subtotalCents+x.discountCents+x.taxCents<0)throw new Error('商品实付不能为负数');}for(const x of f.extraCharges)if(!x.personIds.length||x.personIds.some(p=>!people.has(p)))throw new Error('额外费用的成员不正确');return f;}
export function ready(input:BillInput){if(!input.items.length||!input.receipts.length)throw new Error('请先添加小票和商品');if(input.receipts.some(r=>!r.reviewed))throw new Error('请先核对并确认每张小票');const enabled=new Set(input.people.filter(p=>p.enabled).map(p=>p.id));for(const x of input.items){if(!x.excludedFromPool&&x.soloBuyerId!==undefined){const eligible=[...enabled].filter(p=>!x.excludedPersonIds.includes(p));if(eligible.length!==1||eligible[0]!==x.soloBuyerId)throw new Error('独购商品的独购人设置不一致，请重新选择');}}return calculate(input);}
export function toggleExclusion(input:BillInput,itemId:string,personId:string){const enabled=input.people.filter(p=>p.enabled).map(p=>p.id);return {...input,items:input.items.map(x=>{if(x.id!==itemId)return x;const excludedPersonIds=x.excludedPersonIds.includes(personId)?x.excludedPersonIds.filter(p=>p!==personId):[...x.excludedPersonIds,personId];if(!x.soloBuyerId)return {...x,excludedPersonIds};const eligible=enabled.filter(p=>!excludedPersonIds.includes(p));if(eligible.length===1&&eligible[0]===x.soloBuyerId)return {...x,excludedPersonIds};const {soloBuyerId:_removed,...rest}=x;return {...rest,excludedPersonIds};})};}
// Mark an item as a solo purchase for one enabled participant and exclude everyone else.
export function setSoloBuyer(input:BillInput,itemId:string,personId:string):BillInput{if(!input.people.some(p=>p.id===personId&&p.enabled))throw new Error('独购人必须是本次参与成员');const otherIds=input.people.filter(p=>p.enabled&&p.id!==personId).map(p=>p.id);return {...input,items:input.items.map(x=>x.id!==itemId?x:{...x,soloBuyerId:personId,excludedPersonIds:otherIds})};}
// Remove solo purchase status and restore default shared participation for the item.
export function clearSoloBuyer(input:BillInput,itemId:string):BillInput{return {...input,items:input.items.map(x=>{if(x.id!==itemId)return x;const {soloBuyerId:_removed,...rest}=x;return {...rest,excludedPersonIds:[]};})};}
// Keep solo purchase exclusions aligned when the bill's enabled participants change.
export function syncBillParticipants(input:BillInput,people:BillInput['people']):BillInput{const enabled=new Set(people.filter(p=>p.enabled).map(p=>p.id));const items=input.items.map(x=>{if(!x.soloBuyerId)return x;if(!enabled.has(x.soloBuyerId)){const {soloBuyerId:_removed,...rest}=x;return {...rest,excludedPersonIds:[]};}return {...x,excludedPersonIds:[...enabled].filter(p=>p!==x.soloBuyerId)};});return {...input,people,items};}
export function csv(input:AllocationInput,out=calculate(input)){const rows:unknown[][]=[['记录','小票','商品编号','说明','成员','不参与','原价分','优惠分','税分','实付分','分摊分']];for(const item of input.items){for(const p of input.people){const a=out.allocations.find(a=>a.sourceType==='item'&&a.sourceId===item.id&&a.personId===p.id);rows.push(['商品',input.receipts.find(r=>r.id===item.receiptId)?.merchant,item.id,item.description,p.displayName,!a,item.subtotalCents,item.discountCents,item.taxCents,item.subtotalCents+item.discountCents+item.taxCents,a?.cents||0]);}}for(const c of input.extraCharges)for(const p of input.people){const a=out.allocations.find(a=>a.sourceType==='extra'&&a.sourceId===c.id&&a.personId===p.id);if(a)rows.push(['费用','',c.id,c.description,p.displayName,false,'','','','',a.cents]);}for(const p of input.people)rows.push(['合计','','','',p.displayName,'','','','','',out.perPersonCents[p.id]]);return '\ufeff'+rows.map(row=>row.map(v=>{let s=String(v??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}).join(',')).join('\r\n');}

export function applyDefaultTaxRate(input:BillInput,rate:number):BillInput{
 const changed=new Set<string>();
 const items=input.items.map(item=>{if(!(item.taxable??item.taxCents>0))return item;const taxCents=defaultTaxCents(item.subtotalCents+item.discountCents,rate);if(taxCents===item.taxCents)return item;changed.add(item.receiptId);return {...item,taxCents,taxable:true};});
 if(!changed.size)return input;
 const receipts=input.receipts.map(r=>{if(!changed.has(r.id))return r;if(r.entryMode!=='manual')return {...r,reviewed:false};
 const lines=items.filter(i=>i.receiptId===r.id);const total=(excluded:boolean,tax:boolean)=>lines.filter(i=>!excluded||i.excludedFromPool).reduce((n,i)=>n+i.taxCents+(tax?0:i.subtotalCents+i.discountCents),0);
 return {...r,registerTotalCents:total(false,false),taxTotalCents:total(false,true),excludedCents:total(true,false),excludedTaxCents:total(true,true),reviewed:true};});
 return validateDraft({...input,items,receipts});
}
