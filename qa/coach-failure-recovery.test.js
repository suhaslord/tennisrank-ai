const {test}=require('node:test');
const assert=require('node:assert/strict');
const coach=require('../coach-ops');
test('failed preview restores the saved board and releases the import lock',async()=>{
 let restored=0;
 const win={TennisRankAuth:{fetch:async(path,options)=>({ok:options.method==='GET',status:503,json:async()=>options.method==='GET'?{rows:[]}:{error:'Preview service unavailable'}})},clearBoard:()=>restored++,document:{querySelector:()=>null}};
 for(let i=0;i<2;i++) await assert.rejects(coach.previewAndPublish(win,[{name:'Test Player'}]),/Preview service unavailable/);
 assert.equal(restored,2);
});
test('overlapping publish attempts are rejected while the first request is pending',async()=>{
 let release;const pending=new Promise(resolve=>release=resolve);
 const win={TennisRankAuth:{fetch:async(path,options)=>{if(options.method==='POST') await pending;return {ok:options.method==='GET',status:503,json:async()=>options.method==='GET'?{rows:[]}:{error:'Test interruption'}};}},clearBoard(){},document:{querySelector:()=>null}};
 const first=coach.previewAndPublish(win,[{name:'Test Player'}]);
 await assert.rejects(coach.previewAndPublish(win,[{name:'Other Player'}]),/Finish or cancel/);
 release();await assert.rejects(first,/Test interruption/);
});
test('complete outage clears unsaved preview rather than displaying it as live',async()=>{
 let cleared=0;
 const win={TennisRankAuth:{fetch:async()=>{throw new TypeError('Network unavailable');}},clearBoard:()=>cleared++,document:{querySelector:()=>null}};
 await assert.rejects(coach.previewAndPublish(win,[{name:'Test Player'}]),/Network unavailable/);
 assert.equal(cleared,1);
});
