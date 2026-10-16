const compat = require("../match-result-compat");

const FIELDS = {
  name: ["name", "player", "playername", "fullname", "athlete", "student", "teamname"],
  player1: ["player1", "playera", "team1", "teama", "side1", "sidea", "home", "opponent1"],
  player2: ["player2", "playerb", "team2", "teamb", "side2", "sideb", "away", "opponent2"],
  opponent: ["opponent", "opponentname", "opposingplayer", "against", "versus"],
  winner: ["winner", "winningplayer", "wonby", "victor", "winners"], loser: ["loser", "losingplayer", "lostto", "defeated", "losers"],
  result: ["result", "outcome", "winloss", "winneris", "matchresult"], score: ["score", "matchscore", "gamescore", "resultscore"],
  date: ["date", "matchdate", "playedon", "timestamp"],
  gender: ["gender", "sex", "teamgender"], division: ["division", "format", "event", "matchtype", "category", "discipline"],
  rank: ["rank", "ranking", "position"], record: ["record", "winlossrecord"],
  wins: ["wins", "win"], losses: ["losses", "loss"],
};
const aliases = new Map(Object.entries(FIELDS).flatMap(([field, names]) => names.map(name => [name, field])));
const keyFor = value => String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
const scalar = value => typeof value === "string" || typeof value === "number" || typeof value === "boolean";

function playerRecords(rows) {
  return compat.normalizeRows(rows.map(source => {
    const row = {};
    for (const [key, value] of Object.entries(source || {})) {
      if (!scalar(value) || key.startsWith("__")) continue;
      const field = aliases.get(keyFor(key)) || compat.partnerFieldForHeader(key);
      if (field && row[field] === undefined) row[field] = value;
    }
    if (!row.name) {
      const parts = Object.entries(source || {}).filter(([key, value]) => scalar(value) && ["firstname", "lastname"].includes(keyFor(key)));
      row.name = ["firstname", "lastname"].map(key => parts.find(([name]) => keyFor(name) === key)?.[1]).filter(Boolean).join(" ");
      if (!row.name) delete row.name;
    }
    for (const field of ["__aggregateWins", "__aggregateLosses", "__sourceRank"]) {
      if (typeof source?.[field] === "number" && Number.isFinite(source[field]) && source[field] >= 0) row[field] = source[field];
    }
    if (!row.gender && ["boys", "girls", "mixed"].includes(source?.__contextGender)) row.gender = source.__contextGender;
    if (!row.division && ["singles", "doubles"].includes(source?.__contextDivision)) row.division = source.__contextDivision;
    return row;
  })).map(row => {
    const projected = {};
    for (const field of [...Object.keys(FIELDS), "__aggregateWins", "__aggregateLosses", "__sourceRank"]) {
      if (scalar(row[field])) projected[field] = row[field];
    }
    return projected;
  });
}

module.exports = { playerRecords };
