function largeRoster(count = 140) {
  const lines = ["Athlete,Sex,Event,Team Level,Grade"];
  for (let i = 1; i <= count; i += 1) {
    const gender = i % 2 ? "Boys" : "Girls";
    const level = i % 3 ? "Varsity" : "JV";
    const grade = 9 + (i % 4);
    lines.push(`Player ${String(i).padStart(3, "0")},${gender},Singles,${level},${grade}`);
  }
  return lines.join("\n");
}

module.exports = [
  {
    name: "missing canonical headers but recognizable synonyms",
    text: "Competitor,Against,W/L,Sex,Category\nAiden Brooks,Leo Morris,W,M,Singles\nLeo Morris,Aiden Brooks,L,M,Singles",
    minRankings: 2,
    minMatches: 1,
  },
  {
    name: "extra title notes and blank rows",
    text: "River Islands High School Tennis,,,,\nUpdated by Coach,,,,\n,,,,\n,,,,\nPlayer,Opponent,Result,Gender,Division\nMaya Shah,Zoe Martin,W,Girls,Singles\n,,,,\nZoe Martin,Maya Shah,L,Girls,Singles",
    minRankings: 2,
    minMatches: 1,
  },
  {
    name: "duplicate roster player rows",
    text: "Name,Gender,Division\nAiden Brooks,Boys,Singles\nAiden Brooks,Boys,Singles\nMateo Rivera,Boys,Singles",
    exactNames: ["Aiden Brooks", "Mateo Rivera"],
  },
  {
    name: "mixed JV Varsity metadata",
    text: "Name,Gender,Division,Team Level,Grade\nAiden Brooks,Boys,Singles,Varsity,12\nEthan Cole,Boys,Singles,JV,9\nMaya Shah,Girls,Singles,Varsity,11\nZoe Martin,Girls,Singles,JV,10",
    metadata: {
      "Aiden Brooks": { division: "varsity", gradeLevel: 12 },
      "Ethan Cole": { division: "jv", gradeLevel: 9 },
      "Maya Shah": { division: "varsity", gradeLevel: 11 },
      "Zoe Martin": { division: "jv", gradeLevel: 10 },
    },
  },
  {
    name: "mixed singles doubles in one table",
    text: "Name,Gender,Division,Player 1,Player 2,Winner,Loser,Score,Date\nAiden Brooks,Boys,Singles,,,,,,\nMateo Rivera,Boys,Singles,,,,,,\nLiam Chen & Oliver Davis,Boys,Doubles,,,,,,\nMarcus Lee & James Park,Boys,Doubles,,,,,,\n,Boys,Singles,Aiden Brooks,Mateo Rivera,Aiden Brooks,Mateo Rivera,6-4,8/7/26\n,Boys,Doubles,Liam Chen & Oliver Davis,Marcus Lee & James Park,Liam Chen & Oliver Davis,Marcus Lee & James Park,8-5,8/7/26",
    boards: ["boys|singles", "boys|doubles"],
    minMatches: 2,
  },
  {
    name: "weird date formats",
    text: "Player,Opponent,Result,Gender,Division,Date\nAiden Brooks,Leo Morris,W,Boys,Singles,Aug 7 2026\nMaya Shah,Zoe Martin,W,Girls,Singles,2026/08/08\nZoe Martin,Maya Shah,L,Girls,Singles,08-09-26",
    minMatches: 2,
  },
  {
    name: "copied excel block with repeated headers",
    text: "Player,Opponent,Result,Gender,Division\nAiden Brooks,Leo Morris,W,Boys,Singles\nPlayer,Opponent,Result,Gender,Division\nMaya Shah,Zoe Martin,W,Girls,Singles\nPlayer,Opponent,Result,Gender,Division\nZoe Martin,Maya Shah,L,Girls,Singles",
    minMatches: 2,
  },
  {
    name: "old and new results mixed together",
    text: "Player,Opponent,Result,Gender,Division,Date\nAiden Brooks,Mateo Rivera,L,Boys,Singles,2025-08-01\nAiden Brooks,Mateo Rivera,W,Boys,Singles,2026-08-01\nAiden Brooks,Ethan Cole,W,Boys,Singles,2026-08-12\nMateo Rivera,Ethan Cole,W,Boys,Singles,2026-08-13",
    minMatches: 4,
    exactNames: ["Aiden Brooks", "Mateo Rivera", "Ethan Cole"],
  },
  {
    name: "large 140 player roster",
    text: largeRoster(140),
    minRankings: 140,
    metadataSample: { name: "Player 003", division: "jv", gradeLevel: 12 },
  },
];
