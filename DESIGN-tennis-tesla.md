# TennisRank — Tesla-Inspired Design System

This file adapts the project's `DESIGN-tesla` reference to River Islands tennis. It preserves TennisRank's team identity while using the same radical-subtraction principles: photography first, one message per section, minimal UI chrome, restrained typography, and motion that never competes with the content.

## Core direction

- Photography carries the emotion; interface chrome stays quiet.
- Major marketing/dashboard moments can use near-viewport-height sections.
- No decorative gradients, glows, heavy borders, or card-shadow stacks.
- Use one chromatic action color only: **RIHS Court Orange `#f36b21`**. It replaces the Tesla reference blue so the interaction model feels Tesla-like without copying Tesla branding.
- Primary surfaces: `#ffffff`, `#f4f4f4`, `#171a20`, `#393c41`, `#5c5e62`, `#8e8e8e`.
- Navigation may float transparently over photography and become `rgba(255,255,255,.78)` with backdrop blur after scroll.
- Buttons are technical, compact rectangles with `4px` radius and at least `44px` touch height.
- Major imagery may use a restrained `12px` radius; most UI uses `0-4px`.
- Typography uses the system sans stack, weights `400` and `500` only. Prefer larger type over heavier type.
- Default UI/body text clusters around `14px`; section/display titles scale up without extra decoration.
- Universal interaction timing: `330ms cubic-bezier(.5,0,0,.75)`.
- Prefer color, opacity, border, and background transitions. Avoid springy scale/translate hover effects.
- Respect `prefers-reduced-motion`.

## Tennis-specific layout

### Hero
- Full-bleed existing team photography.
- Minimal overlay: `River Islands Tennis`, the current ladder context, and no more than two CTAs.
- Do not remove the existing tennis photos.

### Ladder switcher
- Two prominent tabs: `Boys Ladder` and `Girls Ladder`.
- Active state uses Court Orange only as an interaction signal.
- Switching is client-side and does not reload the page.

### Leader spotlight
- Top three singles players are shown as one visual composition, not three unrelated SaaS cards.
- #1 gets the dominant space; #2 and #3 are supporting positions.
- No medal emoji. Rank numbers and typography carry hierarchy.

### Standings
- The ladder should read like an athletic board, not an enterprise table.
- Each row shows rank, movement, player, record, status, and challenge eligibility when known.
- Avoid borders around every row; use whitespace and sparse dividers.

### Metrics
- Most Wins, Active Streak, and Top Climber are concise editorial metrics.
- Do not introduce extra accent colors for each metric.

## Do not

- Do not add gradients to UI surfaces.
- Do not add decorative shadows to every card.
- Do not use pill shapes as the default component language.
- Do not animate everything on hover.
- Do not hide or replace the existing tennis photography.
- Do not expose private contact information in public views.
- Do not hard-code challenge rules that belong in `team_settings`.
