# Renderer foundation and mouse strategy

Asset for [Decide the rendering foundation and mouse strategy](https://github.com/rajofearth/CodeRush2.0_TeamKnull/issues/22). Builds on [`21-reference-tui-recon.md`](./21-reference-tui-recon.md).

## Decision

**CLAI stays on Ink and grows its own mouse layer** — alternate screen buffer, a raw-stdin SGR parser, and bounding-box hit testing computed in userland — shaped like Gemini CLI's approach but, crucially, **without forking Ink**. OpenTUI is rejected because it cannot start under Node today, and the Pi-style split-stack option is rejected because it buys less than it costs.

The two probes below are what decided this. Neither was a reading exercise.

## Probe 1 — OpenTUI under Node: it does not run

Tested on `node v24.12.0`, `win32/arm64`, pnpm 9.15.0, in `P:/tmp/opentui-probe` (outside the repo).

```powershell
node -v                      # v24.12.0
node -p "process.arch+' '+process.platform"   # arm64 win32
pnpm init
pnpm add @opentui/core       # + @opentui/core 0.5.1, done in 8s
```

The install is healthy and genuinely cross-platform. `@opentui/core@0.5.1` declares no `engines` field at all, ships a real Node entry point (`"exports": { ".": { "bun": "./index.bun.js", "node": "./index.node.js" } }`), and lists prebuilt natives for all eight platform triples as optional dependencies, including `@opentui/core-win32-arm64`. That native package resolved and installed correctly here, carrying a prebuilt `opentui.dll`. Total `node_modules` after install: **45.9 MB**. So far this looks like a package that supports Node.

Importing it under Node also works. A script that does `await import("@opentui/core")` loads cleanly and exposes the full surface — `createCliRenderer`, `BoxRenderable`, `TextRenderable`, `ScrollBoxRenderable`, `MarkdownRenderable`, `MouseEvent`, `MouseParser`, `SelectRenderable`, and about seventy more exports.

It fails the moment you try to create a renderer. The smoke script (`smoke.mjs`) creates a renderer with `useMouse: true`, mounts a bordered box with text, attaches an `onMouse` handler, and exits on `q` or a timeout:

```powershell
node smoke.mjs
```

```
Error: Failed to initialize OpenTUI render library: OpenTUI native FFI is not available for this runtime yet
    at resolveRenderLib (.../@opentui/core/chunk-node-m23dbcww.js:16452:13)
    at new CliRenderer (.../@opentui/core/chunk-node-0yw3x5m7.js:7176:17)
    at createCliRenderer (.../@opentui/core/chunk-node-0yw3x5m7.js:6923:20)
    at file:///P:/tmp/opentui-probe/smoke.mjs:8:24

Node.js v24.12.0
```

The log line written before the throw confirms the runtime: `node v24.12.0 win32/arm64`.

The cause is not a missing binary and not the ARM64 host. The prebuilt DLL is present and its resolver returns a valid path. The problem is how OpenTUI calls into it. Its Node backend loads the Zig core through `node:ffi`, and the bundled dependency states the requirement in plain text:

```
node_modules/@opentui/core/chunk-node-m23dbcww.js:240
    const nodeFfi = requireModule("node:ffi");

node_modules/@opentui/core/chunk-node-m23dbcww.js:11136
    var FFI_LOAD_ERROR = "bun-ffi-structs pointer operations require Bun or
    Node.js 26.1+ with node:ffi enabled (--experimental-ffi)."
```

And that module simply does not exist in the Node we run:

```powershell
node --input-type=module -e "try{await import('node:ffi')}catch(e){console.log(e.code, e.message)}"
# ERR_UNKNOWN_BUILTIN_MODULE No such built-in module: node:ffi
```

Checking the upstream story: `node:ffi` landed in **Node.js 26.1.0** as **Stability 1 – Experimental**, gated behind `--experimental-ffi`, additionally gated behind `--allow-ffi` under the Permission Model, and only present in builds compiled with FFI support (the docs note the unofficial GN build has none). Node 26 is the Current line, not LTS.

So adopting OpenTUI would mean requiring every CLAI user to be on Node 26.1+, on an FFI-enabled build, launching the binary with an experimental flag — against a `package.json` that currently says `"node": ">=20"`. `@opentui/solid` sits on top of `@opentui/core` and therefore inherits this failure exactly; there was no point installing it once the core renderer could not be constructed.

That single finding removes option 1 from consideration for this hackathon. It is not a judgement about OpenTUI's quality — the API surface is excellent and the OpenCode screenshots prove what it can do. It is a runtime fact.

## Probe 2 — the Ink mouse layer does not need a fork

The recon's strongest argument against staying on Ink was that Gemini CLI had to run a **forked** Ink (`npm:@jrichman/ink@6.6.9`) to get `getBoundingBox()` for hit testing. If a fork were mandatory, option 2 would be nearly as expensive as a rewrite. So I tested whether stock Ink can produce absolute element geometry.

It can. Ink 5.2.1's public `measureElement()` returns width and height only, which is the gap Gemini's fork filled:

```js
// node_modules/ink/build/measure-element.js
const measureElement = (node) => ({
    width: node.yogaNode?.getComputedWidth() ?? 0,
    height: node.yogaNode?.getComputedHeight() ?? 0,
});
```

But the Yoga node and the parent chain are both on the public `DOMElement` type that a `ref` hands you (`node_modules/ink/build/dom.d.ts` declares `parentNode: DOMElement | undefined` and `yogaNode?: YogaNode`), so absolute position is a walk up the tree summing `getComputedLeft()` and `getComputedTop()`. The probe (`.wayfinder-tmp/ink-bbox-probe.mjs`) renders a miniature CLAI layout — header, an indented pair of tool rows inside a `marginTop` container, a footer — into a `PassThrough` stream so it runs headlessly, then reads the geometry off four refs:

```powershell
node .wayfinder-tmp\ink-bbox-probe.mjs
```

```
--- absolute bounding boxes from stock ink 5.2 ---
header    abs x=1 y=0 w=78 h=1   measureElement w=78 h=1
toolRow1  abs x=3 y=2 w=76 h=1   measureElement w=76 h=1
toolRow2  abs x=3 y=3 w=76 h=1   measureElement w=76 h=1
footer    abs x=1 y=5 w=78 h=1   measureElement w=78 h=1
```

Every number is right. The header sits at `x=1` from the container's `paddingX`, the tool rows at `x=3` from the additional `paddingLeft: 2` and at `y=2`/`y=3` after the `marginTop: 1` gap, and the footer at `y=5` below its own margin. That is exactly the input a hit tester needs: given a click at row `y` and column `x`, find the smallest registered box containing it. The fork was a convenience, not a necessity.

The second half of the probe covers the other hard part the recon flagged — Pi's `stdin-buffer.ts` exists because SGR sequences arrive fragmented from the terminal, and ConPTY on Windows is a notorious offender. A twenty-line buffering parser handles it. The probe feeds a wire containing a press, a release, and two wheel events, deliberately chopped into three-byte fragments that split escape sequences mid-token:

```
--- fragmented SGR parse ---
[{"button":0,"x":12,"y":3,"press":true},
 {"button":0,"x":12,"y":3,"press":false},
 {"button":64,"x":40,"y":10,"press":true},
 {"button":65,"x":40,"y":10,"press":true}]
```

All four events reassemble intact, including the wheel-up (`64`) and wheel-down (`65`) codes. Reassembly is a solved problem at the scale CLAI needs, not a research project.

What I could **not** verify from this agent shell is behaviour in a real interactive terminal, because the shell here is not a TTY (`process.stdout.isTTY === false`, which is also why the OpenTUI smoke script logged to a file). Alternate-buffer switching, whether Windows Terminal delivers the mouse reports after `\x1b[?1002h\x1b[?1006h`, and whether ConPTY needs OpenCode's `ENABLE_PROCESSED_INPUT` workaround all remain to be confirmed by hand. Those are the first things to check when the mouse layer is built, and they are risks against the chosen option, not against the rejected ones.

## Why the current architecture makes this cheap

CLAI's UI is already split along the seam that matters. `src/ui/events.ts` defines `UiBus` and a closed `UiEvent` union; `src/ui/state.ts` folds events into `UiState` with a pure reducer; `src/ui/headless.ts` prints the same stream as lines; only `app.tsx` and `components.tsx` know about React. Any renderer decision touches roughly two files, and `headless.ts` is untouched by all three options because it subscribes to the bus and never sees a component.

`app.tsx` also already does the thing that makes an alternate buffer safe. `windowBlocks()` fits visible blocks into a `rows - 10` budget and drops the rest, so a frame never exceeds the viewport height. Ink's erase-and-redraw strategy breaks when a frame is taller than the terminal and content scrolls out of reach — that is the flicker Gemini's `useFlickerDetector` was hunting. CLAI's transcript is already a fixed-height windowed viewport with explicit `PgUp`/`PgDn` scrolling, which is structurally the alt-screen model. Turning on `\x1b[?1049h` formalises what the layout already assumes.

## Rejected options

**OpenTUI plus SolidJS (option 1).** Rejected on the probe. It cannot construct a renderer under Node 24 and would demand Node 26.1+ with `--experimental-ffi` from every user, against a stated floor of Node 20. Even setting the runtime aside, it meant rebuilding `app.tsx` and `components.tsx` against an unfamiliar API, introducing SolidJS alongside React, and carrying 46 MB of dependencies with a per-platform native artifact — during a hackathon. Worth revisiting after `node:ffi` stabilises and Node 26 goes LTS, which is a post-hackathon conversation.

**Pi-style custom transcript with Ink retained for input and dialogs (option 3).** Rejected as the worst trade of the three. It means writing a renderer — line diffing, synchronized output, scroll views, a mouse parser — and then still owning Ink, with two input stacks racing for the same stdin and two layout models that must agree on where the seam sits. Pi and OpenCode both deliberately run one stack. The recon named this option as reducing blast radius, but the bounding-box probe shows the blast radius of option 2 is already small, which removes the only reason to accept the split.

**Forking Ink, as Gemini did.** Rejected as unnecessary rather than wrong. The fork's headline feature for our purposes, `getBoundingBox()`, is reproducible in about fifteen lines against stock Ink's public `DOMElement`. Its other options (`incrementalRendering`, `terminalBuffer`, `standardReactLayoutTiming`) address problems CLAI's windowed transcript avoids by construction. A fork is a permanent maintenance liability and we should only take it if flicker turns out to be unfixable in userland.

## Migration shape

**Replace in place, incrementally, with the mouse layer behind an opt-in flag until it earns the default.** Not a parallel second app, and not a big-bang swap.

Concretely, the work lands as additive modules beside the existing app rather than as a rewrite of it:

- A `src/ui/mouse.ts` owning terminal mode (`\x1b[?1049h` for the alternate buffer, `\x1b[?1002h\x1b[?1006h` for SGR button-and-drag reporting) plus guaranteed teardown on exit, `SIGINT`, and uncaught exceptions. A terminal left in mouse-reporting mode after a crash is the single worst failure mode here.
- A buffering SGR parser and a hit-test registry, both shaped by probe 2. Components register a `ref` and a handler; the dispatcher walks registrations, computes absolute boxes, and picks the smallest box containing the click.
- Adoption in `components.tsx` one affordance at a time, in this order: wheel scrolling on the transcript (replaces `PgUp`/`PgDn` and is the highest-value, lowest-risk change), then click-to-expand on tool rows, then the clickable footer, then the palette when it exists.

Three guard rails apply throughout. Mouse mode only ever activates when `isTuiEnabled()` is true, so `CLAI_NO_TUI=1` and non-TTY stdout keep taking the headless path with zero new code in their way. Mouse sequences must be filtered before they reach Ink's `useInput`, or a stray `\x1b[<` will be typed into the composer. And every click handler adopts OpenCode's selection guard — bail if a text selection is active — because terminal drag-select must keep working; `\x1b[?1002h` reports drags to us, which is what breaks native selection if we are careless, so `Shift`-drag as the documented escape hatch needs testing on both Windows Terminal and macOS.

### What "parity" means

Since Ink is not being retired, parity is the bar the mouse layer must clear before `CLAI_MOUSE=1` inverts into `CLAI_NO_MOUSE=1` and the alternate buffer becomes default. All of the following, on Windows Terminal and on macOS Terminal or iTerm2:

1. Everything reachable by mouse is still reachable by keyboard. `PgUp`/`PgDn`, `Esc`, and `Enter` behave exactly as they do today.
2. Scroll wheel moves the transcript, and the transcript still sticks to the bottom while tokens stream.
3. Clicking a completed tool row expands and collapses it; clicking a footer affordance fires it.
4. Drag-selecting transcript text still selects text and still copies with the terminal's own copy, and a click that ends a drag-select does not also fire a click handler.
5. `Ctrl+C` exits, and the terminal is restored — main buffer, mouse reporting off, cursor visible — after a clean exit, after `Ctrl+C`, and after a thrown exception.
6. `CLAI_NO_TUI=1 pnpm clai demo` and a piped non-TTY run produce byte-identical output to today.
7. No visible flicker during fast token streaming at 80×24 and at 200×50.

Rolling back is one environment variable, and if the layer is abandoned entirely it deletes cleanly because it is additive.

## Questions this surfaced, worth ticketing

- **Windows ConPTY input mode.** OpenCode disables `ENABLE_PROCESSED_INPUT` in `terminal-win32.ts` for mouse and `Ctrl+C` to behave. Does CLAI need the same, and how do we do it from Node without a native addon? This is the largest unknown remaining in the chosen path.
- **Terminal restoration on abnormal exit.** A crash that leaves `?1049h` and `?1002h` set makes the user's shell unusable. This deserves its own hardening ticket with a deliberate crash test, not a line in the mouse ticket.
- **Selection versus drag reporting.** Decide and document the policy: `?1002h` (button-drag) versus `?1000h` (press/release only), and whether `Shift`-drag is a reliable native-selection escape hatch across Windows Terminal, macOS Terminal, iTerm2, and tmux.
- **Streaming flicker measurement.** Adopt something like Gemini's flicker detector as a test rather than a vibe, so parity item 7 has a number behind it.
- **Sticky-bottom scroll semantics.** OpenCode's `stickyScroll` is what makes streaming feel anchored. `windowBlocks()` approximates it; the wheel-scroll work should pin down the exact rule for when new content should and should not pull the viewport down.
- **Revisit OpenTUI once `node:ffi` stabilises.** Track Node 26 reaching LTS and `node:ffi` leaving experimental. If both happen, option 1 becomes viable again and the `UiBus` seam means the view layer is the only thing that would change.
- **Adopt-regardless items from the recon.** The sidebar-as-plugin-slots pattern, delta-append streaming events, the inline-pending/block-complete tool taxonomy, semantic theme tokens, the leader-key and mode-stack keymap, and double-`Esc` interrupt are all renderer-independent and should be their own tickets under the visual-language work.

## Probe artefacts

Left in `P:/tmp/opentui-probe` (outside the repo): `package.json`, `exports.mjs`, `smoke.mjs`, `smoke.log`. The Ink probe is `.wayfinder-tmp/ink-bbox-probe.mjs`. Nothing under `src/` was modified.
