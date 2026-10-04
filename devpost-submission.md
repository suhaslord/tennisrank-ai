# TennisRank

School tennis rankings, reliable spreadsheet imports, and coach-verified challenges in one shared team workspace.

## Problem

A school tennis team needs a current lineup, clear challenge rules, and a way to track the season. A spreadsheet can store results, but it does not tell a player who they can challenge, help a coach approve a score, or explain why a rank changed. Updating a team website by hand creates another copy of the same information to maintain.

TennisRank connects those jobs. The target users are high school tennis players and coaches, with River Islands tennis as the project's school context.

## Solution and key features

Coaches bring in the sheet they already use. TennisRank interprets roster and match rows, previews the changes, and turns the data into team rankings and player statistics. Players have a separate authenticated challenge workflow, and coaches retain control over official results.

- **Five ranking boards:** boys singles, girls singles, boys doubles, girls doubles, and mixed doubles. Doubles partners remain one team identity; official challenges stay on the boys and girls singles ladders.
- **Safer imports:** Google Sheets workbooks, spreadsheet files, and CSV/TSV input, with flexible headers, repeated-header cleanup, duplicate detection, and explicit blocking of contradictory match results.
- **Review before publication:** coaches can see which players and boards will change. Stale previews and overlapping refreshes are rejected instead of silently replacing newer data.
- **Coach-verified challenges:** eligible players propose match times, record scores, and wait for coach approval. A challenger win moves the player to the defender's position and shifts intermediate ranks down; a defender win leaves ranks unchanged.
- **Team operations:** score approvals, injury/inactive holds, manual rank moves, account setup, import snapshots, audit history, and undo controls.
- **Season context:** player records, recent form, rank movement, and a responsive interface for desktop and phone screens.

## Why this matters

The project keeps the coach's existing spreadsheet workflow while giving players a clearer shared view of the team. It separates imported performance statistics from official challenge ranks and makes consequential updates reviewable. The intended benefit is less repeated data entry and fewer ambiguous lineup changes. This entry does not claim measured time savings or school-wide adoption.

## What changed during the hackathon

**Prior work is explicitly disclosed:** TennisRank existed before September 4, 2026. The original app, authentication, singles ladder, challenge engine, and much of the coach infrastructure were already present. They are context for this entry, not claimed as newly built during this event.

The public repository records substantial development during September 12–17, within the official hackathon period: full-workbook Google Sheets imports, a schema-flexible interpreter and certainty gate, repeated-header and match-result repairs, doubles/mixed support, duplicate/conflict protection, stale-preview and concurrent-refresh guards, coach workflow improvements, account setup reliability, and extensive browser/regression coverage. Team photos without confirmed permission were removed.

Final preparation on October 4 also fixed ranking text contrast and a roster-refresh race that could discard a coach's newly typed rank. The submitted work is these improvements to the existing project. Git history makes the boundary inspectable; the last pre-event main-branch commit is `b294135` from August 16.

## How AI and Codex were used

AI development assistants were used for implementation and debugging assistance, as disclosed in the earlier project entry. During this final preparation, OpenAI Codex inspected the code and commit history, ran unit and browser checks, found and repaired the two interface issues above, captured screenshots from the actual app with synthetic data, and helped prepare this write-up.

The app's optional Gemini integration proposes spreadsheet column mappings when deterministic parsing is uncertain. Clean imports stay local; uncertain imports can escalate to AI, and publication still requires the configured 85% interpretation-certainty threshold. The threshold is a software confidence gate, not a claim of 85% real-world accuracy. AI does not approve match results or directly change official ranks. Live Gemini calls were not exercised during final verification; parser and escalation tests used fixtures.

## Architecture and outside resources

The frontend uses vanilla HTML, CSS, and JavaScript. Vercel hosts the frontend and serverless APIs. Supabase provides authentication and PostgreSQL storage; server APIs validate sessions and hold privileged database credentials. Database functions handle official ladder mutations and audit records. Google Sheets and SheetJS support spreadsheet ingestion. Gemini is the optional mapping provider. Interface resources include Phosphor Icons and the bundled Space Grotesk font and license. QA uses Node.js assertions and Playwright.

No new real student dataset was collected for this submission. All gallery screenshots use synthetic QA data and mocked API responses, clearly labeled in the images and captions.

## Testing instructions and judge walkthrough

1. Start with the gallery: team rankings, import preview, player challenge, coach dashboard, and the mobile coach view. These show the actual interface without requiring access to private student accounts.
2. Open the [hosted app](https://tennisrank-ai.vercel.app/). It requires an invited account; there are no public coach credentials. The [public source](https://github.com/suhaslord/tennisrank-ai) and gallery are the accessible judging path.
3. Clone the repository and run `node qa/ladder-engine.test.js`, `node qa/connected-sheet-guard.test.js`, `node qa/match-dedup-guard.test.js`, and `node qa/doubles-mixed.test.js`.
4. For a browser walkthrough, follow the repository README. The existing Playwright fixtures exercise the real frontend with synthetic responses, including challenge creation, coach approvals, import preview/publish/recovery, board switching, and mobile controls.

Final local verification passed 25 selected browser scenarios, plus ladder, import, workbook, account, and safety regression checks. The hosted home route returned HTTP 200; unauthenticated records and ladder requests returned HTTP 401. A credential scan found test fixtures and secret-variable references, with no exposed credentials.

## Known limitations and next steps

The hosted service needs configured Vercel/Supabase resources and invited accounts. A static preview cannot run authenticated server APIs. Gallery images and browser tests demonstrate the interface with fixtures; they do not establish a complete live-database or live-Gemini test. No demo video is included; the event permits screenshots and public source as the demonstration.

Next steps are a separate read-only synthetic demo environment, usability feedback from coaches and players with appropriate permission, and continued testing of real workbook variations.

## Team

Suhas Beemineni — project author.
