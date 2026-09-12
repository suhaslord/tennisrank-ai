# TennisRank AI

TennisRank turns River Islands High School tennis data into a current team ranking board and an authenticated challenge ladder.

## Current architecture

- Vanilla HTML/CSS/JavaScript frontend hosted on Vercel.
- Supabase Auth for invited player/admin accounts.
- Vercel serverless APIs validate bearer sessions and use the server-held Supabase service role for private database access.
- Existing spreadsheet/CSV imports continue to populate match statistics.
- Official Boys and Girls singles ladder positions live separately in the ladder tables and are changed only by trusted server/database workflows.

## Ladder workflow

1. Coach initializes Boys/Girls official ladders from the current imported singles board.
2. A linked active player can challenge an available player up to the configured number of positions above them (default 3).
3. The defender accepts or declines; accepted matches can be scheduled.
4. A participant submits the completed score.
5. The score waits in the coach approval queue.
6. Coach approval calls a transactional database function.
7. If the challenger wins, the challenger takes the defender's position and all intermediate players move down one; a defender win leaves ranks unchanged.
8. Rank history and audit logs preserve every official change.

## Coach controls

- Approval queue for submitted challenge scores.
- Manual rank move with audit history.
- Injury/inactive hold. Open challenges involving a held player are cancelled and the active opponent is released.
- One-time ladder initialization from the imported singles board.
- Existing account creation and data import controls remain available.

## Design

`DESIGN-tennis-tesla.md` is the design source of truth for new ladder work. It adapts a Tesla-style radical-subtraction system to River Islands tennis: existing photography stays dominant, controls use restrained 4px geometry, interaction motion is subtle, and Court Orange `#f36b21` is the primary action accent.

## Database rollout

The ladder schema is split into reproducible SQL layers in `supabase/`:

- `ladder_v1.sql`
- `ladder_v1_workflow.sql`
- `ladder_v1_admin.sql`
- `ladder_v1_admin_safety.sql`
- `ladder_v1_seed.sql`
- `ladder_v1_fk_indexes.sql`

All ladder tables use RLS and are intentionally not granted to browser roles. Vercel serverless functions are the application data boundary.

## Verification

The feature branch QA workflow runs:

- JavaScript syntax checks across frontend and API files.
- Ladder engine behavior tests, including challenge distance, rank shifting, injury/pending exclusion, and match-tiebreak handling.
- Source-reconciliation guardrails to ensure the auth gate, player dashboard, accounts panel, and existing tennis photography remain present.
- Server-auth and secret-safety checks.
- Playwright browser tests against the real reconciled `index.html` and scripts with only network responses mocked. These cover player challenge creation, coach approval/admin controls, and mobile overflow.

Run the core local checks with:

```bash
node --check auth.js
node --check app.js
node --check lib/ladder-engine.js
node --check ladder.js
node --check challenge-ui.js
node qa/ladder-engine.test.js
```

## Deployment safety

Do not overwrite a newer direct Vercel source with an older Git snapshot. The feature branch was reconciled from the last known-good auth-enabled production frontend before the ladder layer was added. Preview deployment is required before production promotion.
