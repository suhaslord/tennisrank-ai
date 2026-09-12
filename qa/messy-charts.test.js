const {test}=require('node:test');
const assert=require('node:assert/strict');
const insights=require('../player-insights');
test('rank chart rejects corrupt rows without NaN, Infinity or markup injection',()=>{
 const html=insights.chartMarkup([null,{rank:0},{rank:-1},{rank:Infinity},{rank:'<script>alert(1)</script>'},{rank:3},{rank:1}]);
 assert.doesNotMatch(html,/NaN|Infinity|<script/);assert.match(html,/#3/);assert.match(html,/#1/);
});
test('shuffled rank history remains chronological',()=>{
 const history=[{old_rank:5,new_rank:3,changed_at:'2026-09-10'},{old_rank:8,new_rank:5,changed_at:'2026-09-01'}];
 assert.deepEqual(insights.deriveRankTrend(history,3).points.map(p=>p.rank),[8,5,3]);
});
test('mixed spreadsheet dates produce the actual recent form',()=>{
 const matches=[{winner:'Test Player',loser:'Other Player',date:'9/2/2026'},{winner:'Other Player',loser:'Test Player',date:'10/1/2026'},{winner:'Test Player',loser:'Other Player',date:'2026-09-15'}];
 assert.deepEqual(insights.deriveRecentForm(matches,'Test Player').last.map(p=>p.result),['L','W','W']);
});
