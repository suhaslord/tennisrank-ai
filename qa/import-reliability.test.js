const assert = require('node:assert/strict');
const { test } = require('node:test');
const { currentRows, validateRows } = require('../api/records');
const coach = require('../coach-ops');

test('reject malformed rows and oversized payloads without rejecting zero records', () => {
  for (const rows of [[], [null], ['name'], [[]], [{}], [{__sourceRow: 1}], [{Name:'   '}]]) assert.ok(validateRows(rows));
  assert.equal(validateRows([{Name:'Ava',Wins:0,Losses:0}]), '');
  assert.ok(validateRows([{Name:'x'.repeat(4 * 1024 * 1024)}]));
});

test('load an entire 2501-row season and surface failure on a later page', async () => {
  const nativeFetch=global.fetch;
  let fail=false;const offsets=[];
  global.fetch=async url => {
    const u=new URL(url);
    if(u.searchParams.get('limit')==='1') return {ok:true,json:async()=>[{source_key:'season'}]};
    const offset=Number(u.searchParams.get('offset'));offsets.push(offset);
    if(fail && offset===1000) return {ok:false,status:503,json:async()=>({message:'Read interrupted'})};
    return {ok:true,json:async()=>Array.from({length:Math.min(1000,2501-offset)},(_,i)=>({row_index:offset+i,raw_data:{Name:`Player ${offset+i}`}}))};
  };
  try {
    const result=await currentRows({url:'https://db.example.test',key:'test'});
    assert.equal(result.count,2501);assert.equal(result.rows[2500].Name,'Player 2500');assert.deepEqual(offsets,[0,1000,2000]);
    fail=true;await assert.rejects(currentRows({url:'https://db.example.test',key:'test'}),/Read interrupted/);
  } finally {global.fetch=nativeFetch;}
});

test('preview counts include all changes even when detail lists are capped', async () => {
  const win={calculateRankings:rows=>({rankings:rows}),document:{querySelector:()=>null},TennisRankAuth:{fetch:async()=>({ok:true,json:async()=>({rows:[]})})}};
  const preview=await coach.buildPreview(win,Array.from({length:80},(_,i)=>({name:`Player ${i}`,gender:'boys',division:'singles'})),{});
  assert.equal(preview.newPlayerCount,80);assert.equal(preview.newPlayers.length,50);
});
