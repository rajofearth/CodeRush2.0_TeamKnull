# Pi TUI → CLAI Adaptation Brief

Patterns adapted from [earendil-works/pi](https://github.com/earendil-works/pi) (`packages/tui`, `packages/coding-agent`) into CLAI’s Ink shell. **Do not depend on `@earendil-works/pi-tui`.**

## Scroll (ported)

Pi is line-oriented (`scrollTop` / `followEnd`). CLAI now mirrors this in `src/ui/scroll.ts`:

- `scrollFromBottom === 0` → follow live edge
- Units are **terminal lines**, not activity blocks
- Page = `viewportRows - 1`; wheel = ±3 lines
- Tall messages: `clipTop` skips leading lines so mid-reply scroll works
- Mouse CSI forwards PageUp/PageDown (`\x1b[5~` / `\x1b[6~`) so keys work with mouse armed

## Layout stack

```text
header → sticky user (when scrolled) → scrollback → turn status → composer → strip
```

Docked chrome stays outside the scroll region (pi fullscreen pattern).

## Not copied

pi-tui custom renderer, Kitty images, full Editor (~2k lines) as a dependency, dual Ink/pi stacks, OSC 133 (defer), pi branding.
