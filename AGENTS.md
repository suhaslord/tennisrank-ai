# TennisRank AI agent guide

## Project shape

- This is a vanilla HTML/CSS/JavaScript app. Keep the deployment root at the repository root; there is no build step.
- `index.html` owns the accessible page structure, `style.css` owns the legacy visual tokens and responsive layout, `ladder.css` owns the new ladder visual layer, and `app.js` owns parsing, ranking calculations, rendering, and interactions.
- `lib/ladder-engine.js` owns reusable ladder rules. Do not duplicate challenge eligibility, score validation, or rank-shift logic inside UI handlers.
- `/api/records.js` is the Vercel serverless endpoint for Supabase persistence. Never move service-role credentials into browser code.
- `supabase/ladder_v1.sql` is the database foundation for ladder entries, challenges, verified matches, rank history, settings, and audit logs.

## Design source of truth

- Use `DESIGN-tennis-tesla.md` as the visual source of truth for new TennisRank work.
- The direction is Tesla-inspired radical subtraction adapted to River Islands tennis, not a copy of Tesla branding.
- Keep photography dominant, whitespace generous, UI chrome minimal, and typography restrained.
- Use RIHS Court Orange `#f36b21` as the single interaction accent for new ladder surfaces.
- Do not introduce decorative gradients, glow effects, shadow stacks, oversized radii, or generic SaaS card grids in new ladder work.
- Preserve the existing tennis photography. Do not replace the hero/team imagery with generated decoration.
- Use the documented 330ms interaction timing and respect `prefers-reduced-motion`.

## Visual assets

- Keep the hero and story imagery in `/assets` and include that directory in every deployment payload or commit; the page has CSS fallbacks for temporary asset failures, but the real photography is the intended presentation.
- Images above the fold should use `fetchpriority="high"` or preload; below-the-fold story images should use lazy loading and async decoding.

## Icon system

- Use Phosphor Icons for interface icons. The static page loads `@phosphor-icons/web@2.1.1` from jsDelivr in `index.html`.
- Use `ph ph-*` for regular icons and `ph-fill ph-*` for emphasis or status icons.
- Icons must be decorative when visible text already explains the action: add `aria-hidden="true"` and keep the text label.
- Prefer an existing Phosphor icon over hand-drawn inline SVG or emoji. Keep icon weight and size consistent with the surrounding control.
- If a control is icon-only, provide an explicit `aria-label` and `title` where useful.

## Ladder behavior

- Boys and Girls singles ladders are separate competitive contexts.
- Default maximum challenge distance is 3 positions and belongs in team settings, not hard-coded UI policy.
- A challenger win moves the challenger into the defender's rank. Every player from the defender through the position immediately above the challenger shifts down one rank.
- A defender win leaves ranks unchanged.
- Challenge/rank mutation must occur transactionally through trusted backend/database code; the browser must never directly rewrite official ranks.
- Match-tiebreak scores such as `10-8` and `10-2` are legitimate when the format uses a match tiebreak. Do not reject them with a simplistic score regex.
- Injury holds remove players from challenge eligibility without deleting historical results.
- Every verified challenge rank change and coach override must remain auditable.

## UI and verification rules

- Preserve the existing information architecture and data workflow while the ladder experience is introduced incrementally.
- Maintain responsive behavior and the `prefers-reduced-motion` path when changing animations.
- Before deploying, run `node --check app.js`, `node --check lib/ladder-engine.js`, `node --check ladder.js`, and `node qa/ladder-engine.test.js`.
- Exercise Boys/Girls switching, empty ladders, mobile layout, linked-player challenge eligibility, and imported-data refreshes.
- Verify the home route plus authenticated `/api/records` behavior when environment variables are configured.
- Never promote a GitHub build over a newer direct Vercel production source without first reconciling the source snapshots.

## Visual interaction layer

- The hero remains photo-led with translucent top navigation. Keep the existing section order and data workflow when iterating on the visual layer.
- The tennis-ball cursor is CSS-only and enabled only for fine pointers. Keep it hidden for touch devices and stop its rotation under `prefers-reduced-motion`.
- The hero racket is CSS 3D geometry (`.racket-art`), so avoid adding a rendering dependency for this decorative element.
- Route all existing in-page anchor clicks through `setupAnchorNavigation()` so fixed navigation and scroll targets stay synchronized.
