# TennisRank AI

A Vercel-ready, mobile-first tennis ranking dashboard. It reads a public Google Sheet CSV feed or a CSV file, calculates separate boys' singles, boys' doubles, girls' singles, and girls' doubles rankings, and can persist imported rows in Supabase Postgres through a secure Vercel API.

## Ranking rules

- Every roster-only player starts at 0 wins and 0 losses.
- A win adds 1 to the winner; a loss adds 1 to the loser.
- Ranking order is wins minus losses, then win rate, then total wins.
- Doubles are ranked as teams/pairs. Pair order is normalized so `A & B` and `B & A` are treated as the same team.

## Recommended sheet format

Use one header row. Common header variations are supported, including `Name`, `Player`, `Gender`, `Division`, `Player 1`, `Player 2`, `Winner`, `Loser`, `Score`, and `Date`.

```csv
Name,Gender,Division,Player 1,Player 2,Winner,Loser,Score,Date
Ava Patel,Girls,Singles,,,,,,
,Boys,Singles,Noah Williams,Ethan Kim,Noah Williams,Ethan Kim,6-3,2026-08-03
,Girls,Doubles,Sofia Garcia & Emma Wilson,Chloe Brown & Maya Shah,Chloe Brown & Maya Shah,Sofia Garcia & Emma Wilson,8-5,2026-08-03
```

Roster rows are optional but recommended. They allow a new player to appear at 0–0 before they play a match.

The parser also accepts a row-per-player results sheet using `Player`, `Opponent`, `Result`, `Gender`, and `Division`, where `Result` is `W` or `L`. For the most reliable import, use explicit `Winner` and `Loser` columns.

## Deploy to Vercel

1. Put this folder in a GitHub repository or import the folder into Vercel.
2. Use the default settings; there is no build command and the output is the project root.
3. Deploy.
4. Create a Supabase project and run [`supabase/schema.sql`](supabase/schema.sql) in its SQL Editor.
5. In Vercel Project Settings → Environment Variables, add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a private `BACKEND_WRITE_TOKEN`. Keep the service-role key and write token server-only. Enter the write token in the app's Data panel when saving spreadsheet data.
6. In Google Sheets, choose Share → General access → Anyone with the link → Viewer.
7. Paste the Google Sheet URL in the app's Data panel. Imported rows are automatically upserted into the backend when the API is configured.

The dashboard fetches the sheet in the browser, so no Google API key is required for a public read-only sheet. The Supabase service-role key is used only inside `/api/records.js`. If the backend is temporarily unavailable, the dashboard still works with sample, CSV, or live sheet data and displays the connection status.
