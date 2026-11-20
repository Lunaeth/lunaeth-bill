import test from 'node:test';
import assert from 'node:assert/strict';
import {enrichProductNames} from '../server/product-names.mjs';

test('retailer-independent lookup sends uncertain labels and accepts cited names only', async () => {
 const certain = {description:'牛奶', rawLabel:'MILK', confidence:1, note:''};
 const unknown = {description:'名称待核对', rawLabel:'ABC', confidence:0.4, note:'', subtotalCents:219};
 const receipt = {merchant:'Example Market', warnings:[], lines:[certain, unknown, {...unknown, rawLabel:'XYZ'}]};
 const source = 'https://example.invalid/products/abc';
 const fetcher = async (_, options) => {
  const prompt = JSON.parse(options.body).input;
  assert.match(prompt, /Example Market/);
  assert.match(prompt, /ABC/);
  assert.doesNotMatch(prompt, /MILK|subtotalCents/);
  const matches = [1,2].map(index => ({index, chineseName:'酸奶', confident:true, sourceUrl:index===1?source:'https://example.invalid/uncited'}));
  return {ok:true, json:async()=>({status:'completed', output:[{content:[{type:'output_text',text:JSON.stringify({matches}), annotations:[{type:'url_citation',url:source}]}]}]})};
 };
 const result = await enrichProductNames(receipt, {provider:'openai', fetcher});
 assert.equal(result.lines[0], certain);
 assert.equal(result.lines[1].description, '酸奶');
 assert.equal(result.lines[1].rawLabel, 'ABC');
 assert.equal(result.lines[1].subtotalCents, 219);
 assert.equal(result.lines[2].description, 'XYZ');
 assert.equal(result.warnings.length, 1);
});
