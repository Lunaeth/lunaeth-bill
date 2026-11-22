/** Deterministic, pure money-allocation engine. Amounts are integer Canadian cents. */
export interface Person { id: string; displayName: string; enabled: boolean }
export interface Category { id: string; name: string; sortOrder: number }
export interface Receipt {
  id: string; merchant: string; date: string;
  registerTotalCents: number; excludedCents: number; taxTotalCents: number; excludedTaxCents?: number;
  sourceImages?: string[]; notes?: string;
}
export interface LineItem {
  id: string; receiptId: string; categoryId: string; description: string;
  quantity: number; subtotalCents: number; discountCents: number; taxCents: number;
  excludedPersonIds: string[]; excludedFromPool: boolean;
  soloBuyerId?: string;
  sourceStatus?: string; note?: string;
}
export interface ExtraCharge {
  id: string; description: string;
  kind: 'fixed-per-person' | 'split-total'; personIds: string[];
  perPersonCents?: number; totalCents?: number;
}
export interface AllocationInput {
  currency: 'CAD'; people: Person[]; categories: Category[];
  receipts: Receipt[]; items: LineItem[]; extraCharges: ExtraCharge[];
}
export interface Allocation {
  sourceId: string; sourceType: 'item' | 'extra'; personId: string;
  cents: number;
}
export interface ReceiptReconciliation {
  receiptId: string; registerTotalCents: number; excludedCents: number;
  expectedPoolCents: number; itemPoolCents: number;
  reportedTaxCents: number; itemTaxCents: number; ok: boolean;
}
export interface AllocationResult {
  roundingMethod?: "person-total-half-up";
  sourceExtraCents?: number;
  allocations: Allocation[];
  perPersonWithoutExtrasCents: Record<string,number>;
  perPersonExtraCents: Record<string,number>;
  perPersonCents: Record<string,number>;
  receipts: ReceiptReconciliation[];
  receiptGrossCents: number; excludedReceiptCents: number;
  poolCents: number; roundedAllocationCents: number;
  roundingExcessCents: number; extraChargesCents: number; grandTotalCents: number;
}
function assertCents(value: number, label: string) {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer amount of cents`);
}
function unique(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}
export function calculate(input: AllocationInput): AllocationResult {
  if (input.currency !== 'CAD') throw new Error('Only CAD is supported in this handoff baseline');
  const ids = input.people.map(p=>p.id);
  unique(ids,'person IDs'); unique(input.receipts.map(r=>r.id),'receipt IDs');
  unique(input.items.map(x=>x.id),'item IDs'); unique(input.extraCharges.map(x=>x.id),'extra charge IDs');
  const active = new Set(input.people.filter(p=>p.enabled).map(p=>p.id));
  const known = new Set(ids);
  const receipts = new Map(input.receipts.map(r=>[r.id,r]));
  const categoryIds = new Set(input.categories.map(c=>c.id));
  const allocations: Allocation[] = [];
  const base: Record<string,number> = Object.fromEntries(ids.map(id=>[id,0]));
  const extra: Record<string,number> = Object.fromEntries(ids.map(id=>[id,0]));
  const byReceiptNet: Record<string,number> = Object.fromEntries(input.receipts.map(r=>[r.id,0]));
  const byReceiptTax: Record<string,number> = Object.fromEntries(input.receipts.map(r=>[r.id,0]));
  // With at most 30 members, n! is a small common denominator for every split.
  let unitsPerCent = 1n;
  for (let n = 2; n <= active.size; n++) unitsPerCent *= BigInt(n);
  const balances = new Map(ids.map(id => [id, 0n]));
  const roundedCents = (units: bigint) => Number((2n * units + unitsPerCent) / (2n * unitsPerCent));

  function addShare(sourceId: string, sourceType: 'item'|'extra', personId: string, amount: number, divisor: number) {
    const before = balances.get(personId)!;
    const after = before + BigInt(amount) * unitsPerCent / BigInt(divisor);
    balances.set(personId, after);
    // Display each line as the change in the rounded running balance. Line details
    // add up to the final amount without feeding any rounded value back into it.
    const cents = roundedCents(after) - roundedCents(before);
    allocations.push({sourceId, sourceType, personId, cents});
    const breakdown = sourceType === 'item' ? base : extra;
    breakdown[personId] += cents;
  }
  let poolCents = 0;
  let sourceExtraCents = 0;
  for (const item of input.items) {
    if (!receipts.has(item.receiptId)) throw new Error(`Item ${item.id}: unknown receipt`);
    if (!categoryIds.has(item.categoryId)) throw new Error(`Item ${item.id}: unknown category`);
    assertCents(item.subtotalCents,`${item.id} subtotal`);
    assertCents(item.discountCents,`${item.id} discount`);
    assertCents(item.taxCents,`${item.id} tax`);
    const amount=item.subtotalCents+item.discountCents+item.taxCents;
    if (amount<0) throw new Error(`Item ${item.id} has negative final amount`);
    if (item.quantity<=0 || !Number.isFinite(item.quantity)) throw new Error(`Item ${item.id}: invalid quantity`);
    for (const id of item.excludedPersonIds) if (!known.has(id)) throw new Error(`Item ${item.id}: unknown person ${id}`);
    unique(item.excludedPersonIds,`${item.id} exclusions`);
    // ExcludedFromPool items are already accounted for by receipt.excludedCents.
    if (item.excludedFromPool) continue;
    const eligible=[...active].filter(id=>!item.excludedPersonIds.includes(id));
    if (eligible.length===0) throw new Error(`Item ${item.id}: no eligible people; mark item excluded from the pool explicitly`);
    poolCents+=amount;
    byReceiptNet[item.receiptId]+=amount;
    byReceiptTax[item.receiptId]+=item.taxCents;
    for (const id of eligible) addShare(item.id, 'item', id, amount, eligible.length);
  }
  const checks:ReceiptReconciliation[]=input.receipts.map(r=>{
    for (const field of ['registerTotalCents','excludedCents','taxTotalCents'] as const) assertCents(r[field],`${r.id} ${field}`);
    assertCents(r.excludedTaxCents??0,`${r.id} excluded tax`);
    const expected=r.registerTotalCents-r.excludedCents;
    const poolTax=r.taxTotalCents-(r.excludedTaxCents??0);
    return {receiptId:r.id,registerTotalCents:r.registerTotalCents,excludedCents:r.excludedCents,
      expectedPoolCents:expected,itemPoolCents:byReceiptNet[r.id],reportedTaxCents:poolTax,
      itemTaxCents:byReceiptTax[r.id],ok: expected===byReceiptNet[r.id] && poolTax===byReceiptTax[r.id]};
  });
  if (checks.some(c=>!c.ok)) throw new Error(`Receipt reconciliation failed: ${JSON.stringify(checks.filter(c=>!c.ok))}`);
  for (const charge of input.extraCharges) {
    unique(charge.personIds,`extra charge ${charge.id} people`);
    if (!charge.personIds.length) throw new Error(`Extra charge ${charge.id}: no people`);
    for (const id of charge.personIds) if (!active.has(id)) throw new Error(`Extra charge ${charge.id}: inactive or unknown person ${id}`);
    let amount: number;
    let divisor = 1;
    if (charge.kind==='fixed-per-person') {
      if (charge.perPersonCents===undefined) throw new Error(`Missing per-person cents: ${charge.id}`);
      assertCents(charge.perPersonCents,charge.id);
      amount=charge.perPersonCents;
    } else if (charge.kind==='split-total') {
      if (charge.totalCents===undefined) throw new Error(`Missing total cents: ${charge.id}`);
      assertCents(charge.totalCents,charge.id);
      amount=charge.totalCents;
      divisor=charge.personIds.length;
    } else throw new Error(`Unsupported charge kind: ${String(charge.kind)}`);
    if (amount<0) throw new Error(`Negative extra charge: ${charge.id}`);
    sourceExtraCents += charge.kind === 'split-total' ? amount : amount * charge.personIds.length;
    for (const id of charge.personIds) addShare(charge.id, 'extra', id, amount, divisor);
  }
  const roundedAllocationCents=Object.values(base).reduce((a,b)=>a+b,0);
  const totalExtra=Object.values(extra).reduce((a,b)=>a+b,0);
  const totals=Object.fromEntries(ids.map(id=>[id,base[id]+extra[id]]));
  const gross=input.receipts.reduce((s,r)=>s+r.registerTotalCents,0);
  const excluded=input.receipts.reduce((s,r)=>s+r.excludedCents,0);
  if (gross-excluded!==poolCents) throw new Error('Cross-receipt reconciliation failed');
  return {
    roundingMethod:"person-total-half-up",sourceExtraCents,
    allocations,perPersonWithoutExtrasCents:base,perPersonExtraCents:extra,perPersonCents:totals,receipts:checks,
    receiptGrossCents:gross,excludedReceiptCents:excluded,poolCents,roundedAllocationCents,
    roundingExcessCents:roundedAllocationCents+totalExtra-poolCents-sourceExtraCents,extraChargesCents:totalExtra,
    grandTotalCents:roundedAllocationCents+totalExtra
  };
}
export function cad(cents: number): string {
  assertCents(cents,'amount');
  const sign=cents<0?'-':'';const abs=Math.abs(cents);
  return `${sign}$${Math.floor(abs/100)}.${String(abs%100).padStart(2,'0')}`;
}
