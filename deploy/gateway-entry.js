const auth = require('../api/auth-api');
const records = require('../api/records');
const sheetProxy = require('../api/sheet-proxy');
const users = require('../api/users');
const ladder = require('../api/ladder');
const challenges = require('../api/challenges');
const matchScore = require('../api/match-score');
const adminLadder = require('../api/admin/ladder');
const seedLadder = require('../api/admin/seed-ladder');
const verifyMatch = require('../api/admin/verify-match');

const handlers = Object.freeze({
  auth,
  records,
  'sheet-proxy': sheetProxy,
  users,
  ladder,
  challenges,
  'match-score': matchScore,
  'admin-ladder': adminLadder,
  'seed-ladder': seedLadder,
  'verify-match': verifyMatch,
});

module.exports = async function gateway(req, res) {
  const key = String(req.query?._tr_route || '').trim().toLowerCase();
  const handler = handlers[key];
  if (!handler) {
    res.status(404).setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.send(JSON.stringify({ error: 'Unknown TennisRank API route.' }));
  }
  return handler(req, res);
};
