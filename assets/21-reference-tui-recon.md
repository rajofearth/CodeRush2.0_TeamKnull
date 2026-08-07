# Reference TUI recon: OpenCode, Pi, Gemini CLI

Asset for [Recon reference TUIs: renderer, layout, mouse](https://github.com/rajofearth/CodeRush2.0_TeamKnull/issues/21), feeding [Decide the rendering foundation and mouse strategy](https://github.com/rajofearth/CodeRush2.0_TeamKnull/issues/22) and [Lock the visual language](https://github.com/rajofearth/CodeRush2.0_TeamKnull/issues/23).

Clones live under `P:/tmp/wayfinder-refs/{opencode,pi,gemini-cli}`.

## Headline

None of the three references is plain Ink. Two of them abandoned React-on-terminal entirely, and the one that kept it had to fork Ink and bypass it for mouse input. The screenshot look CLAI is chasing is OpenCode's, and OpenCode is SolidJS on a custom renderer.

| | OpenCode | Pi | Gemini CLI |
|---|---|---|---|
| Stack | SolidJS + `@opentui/core` (Bun) | Custom `@earendil-works/pi-tui`, no React | React 19 + **forked** Ink (`npm:@jrichman/ink@6.6.9`) |
| Mouse | Native, per-element handlers | Native, architectural | Bolted on: raw stdin SGR parsing, Ink used only for hit-test boxes |
| Full screen | Alt screen, `externalOutputMode: "passthrough"` | Dual renderers: main-buffer and alt-screen | Alt buffer behind a flag; fork adds `alternateBuffer`/`terminalBuffer`/`incrementalRendering` |
| Sidebar | Yes — 42 cols, auto above 120 cols, overlay below | No sidebar; vertical split (transcript + dock) | No sidebar; history pane + bottom chrome |
| Repaint strategy | Solid reactivity, 60fps renderer | Line-level diff + CSI `?2026` synchronized output | `<Static>` for committed turns + virtualized list |

## OpenCode — the look CLAI is cloning

Entry chain: `packages/opencode/src/cli/tui/layer.ts` → `packages/tui/src/app.tsx`, which calls `createCliRenderer({ targetFps: 60, useMouse, useKittyKeyboard, externalOutputMode: "passthrough" })` and renders `<App/>` with `@opentui/solid`.

Layout is JSX flexbox over terminal cells — `<box flexDirection="row">` with a `flexGrow` conversation column and a fixed 42-col `<Sidebar>`. The conversation is a `<scrollbox stickyScroll stickyStart="bottom">`, which is what makes streaming feel anchored. Below 120 columns the sidebar becomes an overlay with a dimmed backdrop; for subagent sessions it is hidden entirely.

Sidebar contents (MCP, LSP, todos, context) are not hardcoded into the route — they are **plugin slots** (`sidebar_content`, `home_footer`, `app_bottom`) registered in `feature-plugins/builtins.ts`. Worth stealing regardless of renderer.

There is no full-screen splash. The home route shows an ASCII wordmark (`component/logo.tsx`, block characters `▀▄` with tinted backgrounds) above a centered prompt; a bottom-anchored spinner overlay appears only if startup exceeds 500ms.

Streaming is SSE → Solid store → reactive re-render. `message.part.delta` events append to a field in place rather than replacing the message. Assistant text renders through `<markdown streaming={true}>`, reasoning through `<code streaming={true}>`. Tool calls have a two-state taxonomy: inline one-liner with spinner while pending, bordered collapsible block once complete, with successful tools hidden by default.

Mouse is per-element: `onMouseUp`, `onMouseOver`/`onMouseOut` for hover, right-click to copy the selection. The important idiom is the selection guard — a click handler bails if `renderer.getSelection()?.getSelectedText()` is non-empty, so clicking never steals a drag-select. Windows needs `ENABLE_PROCESSED_INPUT` disabled in ConPTY (`terminal-win32.ts`) for mouse and Ctrl+C to behave.

Keybinds run through `@opentui/keymap` with a leader key (default `ctrl+x`), a mode stack so dialogs scope their bindings, and 100+ named user-overridable bindings. `ctrl+p` opens a fuzzy command palette over commands tagged `namespace: "palette"`. Esc interrupt is a double-tap within 5 seconds, and the footer text changes to `esc again to interrupt`.

Themes are semantic JSON token sets (`background`, `backgroundPanel`, `backgroundElement`, `text`, `textMuted`, `primary`, plus separate markdown and syntax palettes) with a 12-step dark ramp, 30+ built-ins, and user themes from `~/.opencode/themes/`.

## Pi — the mouse reference

`@earendil-works/pi-tui` is a hand-rolled renderer: components are objects with `render(width): string[]`, composed via `VStack`/`HStack`/`ScrollView` with a width-keyed render cache. `TuiMainScreen` diffs `previousLines` against `newLines` and rewrites only the changed range, wrapped in CSI `?2026` synchronized output. `TuiAltScreen` owns the viewport instead. `switchTuiMode()` swaps between them while preserving the component tree via `captureRenderState()`/`restoreRenderState()`.

Mouse is first-class in the alt screen: SGR enabled with `\x1b[?1000h\x1b[?1002h\x1b[?1004h\x1b[?1006h` (all-motion `?1003h` outside tmux), then a parser routes wheel events to nested scroll views, drives scrollbar drag and hover, handles double/triple-click word and line selection, opens OSC 8 hyperlinks, and does Windows right-click paste. `stdin-buffer.ts` reassembles SGR sequences that arrive fragmented — a real problem CLAI will hit.

Pi's default layout is a vertical split (transcript above, dock below) rather than a sidebar, but `HStack` supports one; the agent just does not use it.

## Gemini CLI — what it costs to keep Ink

Gemini kept React but pays for it. It runs a forked Ink and passes fork-only options: `alternateBuffer`, `terminalBuffer`, `incrementalRendering`, `standardReactLayoutTiming`, `renderProcess`.

History is split at the last user prompt: everything older goes into `<Static>` and never re-renders, while the current turn stays dynamic. In alt-buffer mode it swaps to a `VirtualizedList` rendering only the visible window. There is a `useFlickerDetector` comparing root height against terminal height, which tells you flicker was a real fight.

Mouse does not go through Ink at all. `enableMouseEvents()` writes `\u001b[?1002h\u001b[?1006h`, a `MouseContext` taps `stdin.on('data')` and parses SGR/X11 itself, and `ScrollProvider` hit-tests by calling Ink's `getBoundingBox()` on registered scrollables, picking the smallest-area hit. Ink contributes layout geometry and nothing else. Mouse is only enabled when the alternate buffer is on.

No command palette — slash commands complete inline in the input. Markdown is a hand-written line parser; syntax highlighting is `lowlight` HAST mapped to Ink `<Text color>`.

## Bearing on CLAI's decision

The named risks map straight onto this evidence. Mouse-as-rabbit-hole is real on Ink: Gemini needed a fork, a private stdin parser, and a hit-test layer, and still only gets mouse in the alt buffer. Flicker under streaming is real on Ink too — hence `<Static>`, virtualization, and a flicker detector. Both custom renderers avoid the problem structurally, one with Solid reactivity at 60fps, the other with line diffs and synchronized output.

Against that, the rewrite and time risks push the other way: CLAI's Ink app in `src/ui/` works today, and OpenTUI would mean rebuilding `app.tsx` and `components.tsx` on an unfamiliar API. What survives either way is the harness-facing half — `UiBus`, the reducer, and the headless printer — provided the event contract is clean.

Three shapes for ticket 22 to choose between:

1. **OpenTUI + Solid**, mirroring OpenCode. Highest fidelity to the screenshots, native mouse, sticky scroll, streaming markdown and a scrollbar widget for free. Cost: rewrite the view layer, new runtime story (OpenCode runs Bun; CLAI is Node — needs verifying).
2. **Ink plus a Gemini-style mouse layer**. Keeps the working app. Cost: alt-buffer support, a stdin SGR parser, bounding-box hit testing, and a static/virtualized history split — most of a renderer's hard parts, without a renderer's benefits, and likely a forked Ink.
3. **Pi-style custom viewport for the transcript, Ink retained for input and dialogs.** Reduces blast radius but means two input stacks, which Pi and OpenCode both deliberately avoided.

Independent of that choice, adopt regardless: the sidebar-as-slots pattern, delta-append streaming events, the inline-pending/block-complete tool taxonomy, the selection-guard on click handlers, semantic theme tokens over literal colors, the leader-key plus mode-stack keymap, and double-esc interrupt.
