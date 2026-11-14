// Standard combined sales-tax presets, verified against CRA on 2026-11-14.
// A rate of 14975 means 14.975%; money always stays in integer cents.
export const taxPresets=[
 {id:'AB',name:'Alberta',rate:5000},{id:'BC',name:'British Columbia',rate:12000},
 {id:'MB',name:'Manitoba',rate:12000},{id:'NB',name:'New Brunswick',rate:15000},
 {id:'NL',name:'Newfoundland and Labrador',rate:15000},{id:'NT',name:'Northwest Territories',rate:5000},
 {id:'NS',name:'Nova Scotia',rate:14000},{id:'NU',name:'Nunavut',rate:5000},
 {id:'ON',name:'Ontario',rate:13000},{id:'PE',name:'Prince Edward Island',rate:15000},
 {id:'QC',name:'Quebec',rate:14975},{id:'SK',name:'Saskatchewan',rate:11000},
 {id:'YT',name:'Yukon',rate:5000}
];
export const taxRateLabel=(rate:number)=>String(rate/1000)+'%';
export function parseTaxRate(value:string){
 if(!/^\d{1,3}(\.\d{1,3})?$/.test(value.trim()))throw new Error('税率最多三位小数');
 const [whole,fraction='']=value.trim().split('.');const rate=Number(whole)*1000+Number(fraction.padEnd(3,'0'));
 if(rate>100000)throw new Error('税率须为 0% 至 100%');return rate;
}
