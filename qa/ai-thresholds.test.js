const { test } = require('node:test');
const assert = require('node:assert/strict');
function fresh() { delete require.cache[require.resolve('../spreadsheet-ai')]; return require('../spreadsheet-ai'); }
const schema = (confidence = .9, mappings = []) => ({ supported: true, sheetKind: 'roster', confidence, mappings, globalGender: 'unknown', globalDivision: 'unknown', warnings: [] });
const auth = ai => ({ fetch: async () => ({ ok: true, json: async () => ({ ai, model: 'test' }) }) });
test('column mapping threshold: below, equal, above', () => {
 for (const confidence of [.619999, .62, .620001]) {
  const rows = fresh().applyAiMapping([{ athlete: 'Test Player' }], schema(.9,[{inputKey:'athlete',target:'name',confidence}]));
  assert.equal(rows[0].name, confidence < .62 ? undefined : 'Test Player');
 }
});
test('swapped keys preserve both identities', () => {
 const rows = fresh().applyAiMapping([{name:'Test Alpha',opponent:'Test Beta'}],schema(.9,[{inputKey:'name',target:'opponent',confidence:.99},{inputKey:'opponent',target:'name',confidence:.98}]));
 assert.equal(rows[0].name,'Test Beta'); assert.equal(rows[0].opponent,'Test Alpha');
});
test('one source cannot invent both sides of a match', () => {
 const plan = fresh().mappingPlan([{athlete:'Test Alpha'}],schema(.9,[{inputKey:'athlete',target:'name',confidence:.99},{inputKey:'athlete',target:'opponent',confidence:.98}]));
 assert.equal(plan.length,1);
});
test('nonfinite confidence fails closed', () => {
 assert.equal(fresh().normalizeAi(schema(Infinity)).confidence,0);
});
test('overall confidence threshold: below, equal, above', async () => {
 for (const confidence of [.549999,.55,.550001]) {
  const result = await fresh().enhanceRows([{athlete:'Test Player'}], {source:'file', auth:auth(schema(confidence,[{inputKey:'athlete',target:'name',confidence:.99}])), importer:{validateInterpretation:()=>({valid:true,confidence:1})}});
  assert.equal(result.__analysis.ai.status, confidence < .55 ? 'verified-low-confidence' : 'applied-and-validated');
 }
});
test('unsupported cutoff: below, equal, above', async () => {
 for (const confidence of [.859999,.86,.860001]) {
  const run = fresh().enhanceRows([{name:'Test Player'}],{source:'file',auth:auth({...schema(confidence),supported:false})});
  if (confidence >= .86) await assert.rejects(run,/Nothing was published/); else await run;
 }
});
test('cached schema cannot bypass confidence regression check', async () => {
 const client=fresh(); const rows=[{athlete:'Test Player'}];
 client.cacheSchema(rows,schema(.99,[{inputKey:'athlete',target:'name',confidence:.99}]),'test');
 const result=await client.enhanceRows(rows,{source:'file',auth:auth(schema(.1)),importer:{validateInterpretation:r=>({valid:true,confidence:r[0].name?.length ? .6 : .99})}});
 assert.equal(result[0].athlete,'Test Player'); assert.equal(result[0].name,undefined);
});
test('provider failures safely return local rows',async()=>{
 for(const status of [429,500,502,503,504]) {
  const rows=[{name:'Test Player'}]; const result=await fresh().enhanceRows(rows,{source:'file',auth:{fetch:async()=>({ok:false,status,json:async()=>({error:'test outage'})})}});
  assert.equal(result,rows); assert.equal(result.__analysis.ai.status,'unavailable');
 }
});
