const assert = require('node:assert/strict');
const link = require('../lib/player-link.js');

assert.equal(link.identityKey(' Álex  Rivera '), 'alexrivera');
assert.equal(link.identityKey('ALEX-RIVERA'), 'alexrivera');

const players = [
  { id: '1', display_name: 'Alex Rivera', profile_id: null },
  { id: '2', display_name: 'Morgan Lee', profile_id: 'profile-2' },
];
assert.deepEqual(link.matchingPlayers(players, ' alex rivera '), [players[0]]);
assert.deepEqual(link.matchingPlayers(players, 'MORGAN-LEE'), [players[1]]);
assert.deepEqual(link.matchingPlayers(players, 'Not Here'), []);

console.log('player link tests passed');
