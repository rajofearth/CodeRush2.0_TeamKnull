# Pi-tui adoption evaluation

**Verdict: stay on Ink.** Do not add `@earendil-works/pi-tui` or `@mariozechner/pi-tui` as CLAI’s renderer.

| Concern | Detail |
|---------|--------|
| Stack | pi-tui is `Component.render(width) → string[]`, not React/Ink |
| TTY | Cannot coexist with Ink in one session (both own stdin/screen) |
| Engines | `@earendil-works/pi-tui@0.84.1` needs Node `>=22.19`; CLAI is `>=20` |
| Cost | Adopting = rewrite `app.tsx` + `components.tsx` (~2k LOC) |

**Approach:** port pi *look, density, composer ergonomics, dock layout* into Ink while keeping CLAI wordmark, credit, StatsPanel, metallic tokens, and UiBus.
