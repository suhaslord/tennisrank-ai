# TennisRank AI agent guide

## Project shape

- This is a vanilla HTML/CSS/JavaScript app. Keep the deployment root at the repository root; there is no build step.
- `index.html` owns the accessible page structure, `style.css` owns visual tokens and responsive layout, and `app.js` owns parsing, ranking calculations, rendering, and interactions.
- `/api/records.js` is the Vercel serverless endpoint for Supabase persistence. Never move service-role credentials into browser code.

## Visual assets

- Keep the hero and story imagery in `/assets` and include that directory in every deployment payload or commit; the page has CSS fallbacks for temporary asset failures, but the real photography is the intended presentation.
- Images above the fold should use `fetchpriority="high"` or preload; below-the-fold story images should use lazy loading and async decoding.

## Icon system

- Use Phosphor Icons for interface icons. The static page loads `@phosphor-icons/web@2.1.1` from jsDelivr in `index.html`.
- Use `ph ph-*` for regular icons and `ph-fill ph-*` for emphasis or status icons.
- Icons must be decorative when visible text already explains the action: add `aria-hidden="true"` and keep the text label.
- Prefer an existing Phosphor icon over hand-drawn inline SVG or emoji. Keep icon weight and size consistent with the surrounding control.
- If a control is icon-only, provide an explicit `aria-label` and `title` where useful.

## UI and verification rules

- Preserve the existing information architecture: hero, story rail, summary, insight, rankings, player table, recent matches, and data panel.
- Maintain responsive behavior and the `prefers-reduced-motion` path when changing animations.
- Before deploying, run `node --check app.js`, exercise the app with a local static server, and verify the home route plus `/api/records` behavior when environment variables are configured.
- Deploy with Vercel from this directory after local checks pass.

## Visual interaction layer

- The hero follows a warm, photo-led editorial direction with translucent top navigation and a floating bottom navigation dock. Keep the existing section order and data workflow when iterating on the visual layer.
- The tennis-ball cursor is CSS-only and enabled only for fine pointers. Keep it hidden for touch devices and stop its rotation under `prefers-reduced-motion`.
- The hero racket is CSS 3D geometry (`.racket-art`), so avoid adding a rendering dependency for this decorative element.
- Route all in-page anchor clicks through `setupAnchorNavigation()` so the fixed top bar and scroll targets stay synchronized with the bottom navigation state.
