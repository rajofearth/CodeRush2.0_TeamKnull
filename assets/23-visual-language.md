# CLAI visual language: palette, density, status strings

Asset for [Lock the visual language: palette, density, status strings](https://github.com/rajofearth/CodeRush2.0_TeamKnull/issues/23). Builds on [Recon reference TUIs](https://github.com/rajofearth/CodeRush2.0_TeamKnull/issues/21) (`assets/21-reference-tui-recon.md`).

This document is the single source of truth for how CLAI looks in a terminal. Every value here is concrete: a builder should be able to type it in without asking a follow-up question. Values are derived from OpenCode's own theme file (`packages/tui/src/theme/assets/opencode.json`) and logo module (`packages/tui/src/logo.ts`, `component/logo.tsx`) in the reference clone at `P:/tmp/wayfinder-refs/opencode`, cross-checked against the target screenshots. Where CLAI deliberately diverges from OpenCode, the divergence is called out.

The headline divergence is the accent. OpenCode's `primary` is a peach (`#fab283`); CLAI's single accent is the blue `#5c9cf5`, which is OpenCode's own `secondary` token. That blue is what the screenshots already use for the prompt box's left rule and the `Build` agent label, and taking it as the one accent gives CLAI its own identity while keeping the neutral chassis identical.

---

## 1. Palette

CLAI ships one theme, `clai-dark`, defined as semantic tokens over a twelve-step neutral ramp. Components must never reference a hex value or a ramp step directly — they reference a semantic token. The ramp exists so that new semantic tokens can be added consistently later.

### 1.1 The dark step ramp

CLAI adopts OpenCode's ramp verbatim for steps 1–8 and 11–12. Steps 9 and 10 in OpenCode hold the primary/primary-hover pair; CLAI substitutes its blue accent there so the ramp stays structurally identical.

| Ramp step | Hex | Role in the ramp |
|---|---|---|
| `step1` | `#0a0a0a` | App background |
| `step2` | `#141414` | Panel surface |
| `step3` | `#1e1e1e` | Element surface |
| `step4` | `#282828` | Element surface, hovered |
| `step5` | `#323232` | Element surface, active/pressed |
| `step6` | `#3c3c3c` | Subtle border |
| `step7` | `#484848` | Default border |
| `step8` | `#606060` | Active border |
| `step9` | `#5c9cf5` | Accent |
| `step10` | `#7fb3f8` | Accent, hovered/brightened |
| `step11` | `#808080` | Muted text |
| `step12` | `#eeeeee` | Primary text |

`step10` is `step9` lightened toward white by 25% and is the only value in this table that is not lifted directly from a reference file.

### 1.2 Semantic tokens

| CLAI token | Hex | Used for |
|---|---|---|
| `clai.background` | `#0a0a0a` | The terminal canvas; the conversation column and the sidebar both sit on it |
| `clai.backgroundPanel` | `#141414` | Prompt box interior, user-message block, completed tool blocks, todo block |
| `clai.backgroundElement` | `#1e1e1e` | Inline code spans, selected list rows, dialog rows |
| `clai.backgroundElementHover` | `#282828` | Hovered list row or button |
| `clai.backgroundElementActive` | `#323232` | Pressed/selected row |
| `clai.text` | `#eeeeee` | Assistant prose, user prose, sidebar section headings, filenames in tool rows |
| `clai.textMuted` | `#808080` | Metadata: token counts, cost, timestamps, keybind descriptions, placeholder text, tool verbs, version string |
| `clai.textFaint` | `#606060` | Third-tier chrome only: the idle segments of the progress bar, disabled rows, the shadow half of the wordmark |
| `clai.accent` | `#5c9cf5` | The one accent: prompt-box left rule, `Build` agent label, focused border, spinner, active progress segments, markdown links, list bullets |
| `clai.accentHover` | `#7fb3f8` | Accent on hover or focus-within |
| `clai.border` | `#484848` | Default box borders and horizontal rules |
| `clai.borderActive` | `#606060` | Border of the focused pane |
| `clai.borderSubtle` | `#3c3c3c` | Dividers inside a panel, sidebar/conversation separator |
| `clai.success` | `#7fd88f` | `Connected`, passing checks, completed todos |
| `clai.warning` | `#f5a742` | `Connecting`, degraded sandbox, approval prompts, truncation notices |
| `clai.error` | `#e06c75` | `Failed`, tool errors, unhandled exceptions |
| `clai.info` | `#56b6c2` | Neutral notices, hints that are not errors, `/status` output labels |
| `clai.diffAdded` | `#4fd6be` | `+` lines in a diff |
| `clai.diffRemoved` | `#c53b53` | `-` lines in a diff |
| `clai.diffContext` | `#828bb8` | Unchanged lines shown around a hunk |
| `clai.diffHunkHeader` | `#828bb8` | `@@ … @@` header lines |
| `clai.diffAddedBg` | `#20303b` | Row background behind an added line |
| `clai.diffRemovedBg` | `#37222c` | Row background behind a removed line |
| `clai.diffLineNumber` | `#8f8f8f` | Gutter numbers in a diff |

Markdown and syntax highlighting get their own token groups so that prose colour never leaks into chrome colour.

| CLAI token | Hex | Used for |
|---|---|---|
| `clai.md.text` | `#eeeeee` | Body copy |
| `clai.md.heading` | `#5c9cf5` | `#`–`######` headings, rendered bold |
| `clai.md.link` | `#5c9cf5` | The URL |
| `clai.md.linkText` | `#56b6c2` | The bracketed label |
| `clai.md.code` | `#7fd88f` | Inline code, on `clai.backgroundElement` |
| `clai.md.blockQuote` | `#e5c07b` | `>` quoted blocks |
| `clai.md.emph` | `#e5c07b` | Italic |
| `clai.md.strong` | `#f5a742` | Bold |
| `clai.md.rule` | `#808080` | `---` horizontal rules |
| `clai.md.listItem` | `#5c9cf5` | The bullet glyph, not the item text |
| `clai.md.listEnumeration` | `#56b6c2` | `1.` style markers |
| `clai.syntax.comment` | `#808080` | |
| `clai.syntax.keyword` | `#9d7cd8` | |
| `clai.syntax.function` | `#5c9cf5` | |
| `clai.syntax.variable` | `#e06c75` | |
| `clai.syntax.string` | `#7fd88f` | |
| `clai.syntax.number` | `#f5a742` | |
| `clai.syntax.type` | `#e5c07b` | |
| `clai.syntax.operator` | `#56b6c2` | |
| `clai.syntax.punctuation` | `#eeeeee` | |

Note that `clai.syntax.keyword` keeps OpenCode's purple `#9d7cd8` rather than the CLAI accent. Code highlighting needs more than one hue to stay legible, so the one-accent rule applies to chrome, not to syntax.

### 1.3 Background discipline

CLAI never paints `clai.background` explicitly. It leaves the terminal's own background showing through for the canvas and only paints surfaces that must read as raised: the prompt box, the user-message block, completed tool blocks, and the todo block, all in `clai.backgroundPanel`. This is what makes the reference screenshots feel like they belong in the terminal rather than covering it. The one exception is the wordmark, which paints tinted backgrounds per cell (section 5).

---

## 2. Colour fallback

### 2.1 How the code asks

Capability detection happens once at startup, in a single module (`src/ui/theme/capabilities.ts`), and the result is frozen for the process lifetime. Resolution order, first match wins:

1. If `NO_COLOR` is set to any non-empty value, the level is `none`. This is non-negotiable and overrides everything below, including `FORCE_COLOR`.
2. If `CLAI_COLOR` is set, use it. Accepted values are `truecolor`, `256`, `16`, `none`. This is the escape hatch a user reaches for when detection is wrong.
3. If `FORCE_COLOR` is set, map `3` to `truecolor`, `2` to `256`, `1` to `16`, and `0` to `none`.
4. If stdout is not a TTY, the level is `none` and CLAI additionally switches to the headless printer.
5. If `COLORTERM` equals `truecolor` or `24bit`, the level is `truecolor`.
6. On Windows, if `WT_SESSION` is set (Windows Terminal) or the build number reported by `os.release()` is 15063 or higher, the level is `truecolor`. Legacy `conhost` on older builds falls to step 8.
7. If `TERM` contains `256color`, the level is `256`.
8. Otherwise the level is `16`.

Every token resolves through one function, `resolve(token): string`, which returns a ready-to-write SGR sequence for the detected level. No component branches on capability itself.

### 2.2 The 256-colour degradation

Each token gets a hand-picked xterm-256 index rather than a computed nearest-neighbour, because automatic quantisation collapses the neutral ramp into indistinguishable greys.

| Token | 256 index | Approx hex |
|---|---|---|
| `clai.background` | 232 | `#080808` |
| `clai.backgroundPanel` | 233 | `#121212` |
| `clai.backgroundElement` | 234 | `#1c1c1c` |
| `clai.backgroundElementHover` | 235 | `#262626` |
| `clai.backgroundElementActive` | 236 | `#303030` |
| `clai.borderSubtle` | 237 | `#3a3a3a` |
| `clai.border` | 238 | `#444444` |
| `clai.borderActive` | 240 | `#585858` |
| `clai.textFaint` | 241 | `#626262` |
| `clai.textMuted` | 244 | `#808080` |
| `clai.text` | 255 | `#eeeeee` |
| `clai.accent` | 75 | `#5fafff` |
| `clai.accentHover` | 117 | `#87d7ff` |
| `clai.success` | 114 | `#87d787` |
| `clai.warning` | 215 | `#ffaf5f` |
| `clai.error` | 174 | `#d78787` |
| `clai.info` | 73 | `#5fafaf` |
| `clai.diffAdded` | 79 | `#5fd7af` |
| `clai.diffRemoved` | 161 | `#d7005f` |
| `clai.diffContext` | 103 | `#8787af` |

Diff row backgrounds (`clai.diffAddedBg`, `clai.diffRemovedBg`, and the line-number backgrounds) are dropped entirely at 256 colours. Tinted dark backgrounds do not survive quantisation — they land on a grey that reads as a rendering bug. Instead the `+` and `-` sigils are coloured with `clai.diffAdded` and `clai.diffRemoved` and the whole line takes that foreground.

### 2.3 The 16-colour degradation

At 16 colours CLAI stops trying to look like the screenshots and optimises for legibility. Surfaces are abandoned: the prompt box, the user block, and tool blocks lose their fills and are distinguished by their border and left rule alone.

| Token | ANSI colour |
|---|---|
| `clai.text` | bright white (97) |
| `clai.textMuted` | bright black / grey (90) |
| `clai.textFaint` | bright black (90), plus the dim attribute |
| `clai.accent` | bright blue (94) |
| `clai.accentHover` | bright cyan (96) |
| `clai.success` | bright green (92) |
| `clai.warning` | yellow (33) |
| `clai.error` | bright red (91) |
| `clai.info` | cyan (36) |
| `clai.diffAdded` | green (32) |
| `clai.diffRemoved` | red (31) |
| `clai.border`, `clai.borderSubtle` | bright black (90) |
| `clai.borderActive` | white (37) |
| all backgrounds | not emitted |

### 2.4 No colour at all

At level `none` no SGR sequences are emitted whatsoever, including bold and dim. Everything that colour was carrying must be carried by text instead. Concretely: status dots become literal words, so `● herd Connected` becomes `herd: connected` and `● herd Failed` becomes `herd: failed`; diff lines keep their leading `+`, `-`, and space; the sidebar sections are separated by blank lines and their headings by a trailing colon. This level is also what the existing headless printer (`CLAI_NO_TUI=1`) uses, so the two paths share one renderer.

---

## 3. Density and spacing

### 3.1 The two-column frame

The screen is one flexbox row. The conversation column grows to fill; the sidebar is a fixed **42 columns**, matching OpenCode. The behaviour depends on terminal width:

- **Width ≥ 120 columns**: the sidebar is docked on the right, always visible, separated from the conversation by a one-column gap. There is no vertical rule character between them — the gap alone reads as a separation because the sidebar's content is left-aligned within it.
- **Width < 120 columns**: the sidebar is hidden and becomes an overlay, toggled by a keybind. When open it occupies the rightmost 42 columns and the conversation behind it is dimmed by rendering its text at `clai.textFaint`.
- **Width < 60 columns**: the sidebar overlay takes the full width when opened, and the footer collapses to the working directory only.
- **Subagent sessions**: the sidebar is hidden entirely and cannot be toggled.

Vertically the frame is: conversation scroll region (grows), one blank line, prompt box (3 rows plus border), footer (1 row). The sidebar spans from the top of the screen down to its own footer, which sits on the same two rows as the main footer.

### 3.2 Conversation column

The conversation column has one column of left padding and two columns of right padding, so text never touches either edge. Content wraps at the column width minus that padding; it is never given a separate maximum measure, because on a wide terminal the reference layout genuinely does run long lines.

Blank-line rules, stated as the number of blank rows between two adjacent elements:

| Above | Below | Blank rows |
|---|---|---|
| Top of the scroll region | first message | 1 |
| User message block | assistant prose | 1 |
| Assistant prose paragraph | next paragraph | 1 |
| Assistant prose | first tool row of a group | 1 |
| Tool row | next tool row in the same group | 0 |
| Last tool row of a group | following prose | 1 |
| Any block | a bordered block (todo, completed tool, subagent) | 1 |
| Last message | bottom of the scroll region | 1 |

Tool rows are deliberately dense — a run of twenty reads and globs is a single visual texture, not twenty separate events, and that texture is a big part of the reference look.

### 3.3 Tool rows and indentation

A tool row is one line: a two-character sigil field, the tool verb, and the target.

```
· Read app/Models/User.php
```

The sigil occupies columns 1–2 (glyph plus space) at `clai.accent`. The verb is `clai.text`, capitalised (`Read`, `Glob`, `Grep`, `Edit`, `Write`, `Bash`, `List`). The target follows one space later at `clai.textMuted`. When a tool row belongs to a subagent or a nested task, the whole row is indented by two additional columns and prefixed with a tree glyph in the sigil field (section 4.3). Nesting is capped at two levels; deeper nesting reuses level two.

A tool that is still running renders as an inline one-liner with a spinner in the sigil field. A tool that has completed and succeeded collapses to the one-liner above. A tool that failed, or one the user has expanded, becomes a bordered block on `clai.backgroundPanel` with a one-column left rule in `clai.error` or `clai.border` respectively, one column of interior padding on each side, and no blank line inside the border.

### 3.4 The prompt box

The prompt box is three content rows tall by default and grows to a maximum of ten as the input wraps. It sits on `clai.backgroundPanel`. Its left edge is a one-column vertical rule (`▌`) painted `clai.accent` when focused and `clai.border` when not; there is no top, right, or bottom border. Interior padding is one column on the left of the rule's inner edge and one on the right.

Row one is the input line, or the placeholder when empty. Row two is blank. Row three is the model/agent line described in section 6. Immediately below the box, outside it, the keybind hint line is right-aligned against the conversation column's right padding.

### 3.5 Sidebar internals

Within its 42 columns the sidebar has one column of left padding and one of right, giving a 40-column measure. Section structure from top to bottom, with blank rows noted:

1. Session title, wrapped, bold, `clai.text`. Blank row after.
2. `Context` heading, then three metadata rows. Blank row after.
3. `MCP` heading, then one row per server. Blank row after. Omitted entirely when no MCP servers are configured.
4. `LSP` heading, then one row per server, or the single placeholder line when none have activated. Blank row after.
5. `Todo` heading, then one row per item, wrapped with a two-column hanging indent under the checkbox. No blank row after; the list runs to the bottom.

Section headings are bold `clai.text`; the rows beneath them are `clai.textMuted` except where a status word carries a semantic colour. Collapsible sections (`MCP`, `LSP`, `Todo`) carry a disclosure glyph in column 1 and their heading starts in column 3; `Context` is not collapsible and its heading starts in column 1.

The sidebar footer is pinned to the bottom: the working directory on one row, then the product line on the next.

### 3.6 Footer

The main footer is one row, on `clai.background`, with no top border. On the left, in order: the progress bar (eight cells), one space, the interrupt hint. On the right, right-aligned: the keybind hints, separated from one another by two spaces. When the two would collide, the keybind hints are dropped from right to left until they fit.

### 3.7 Borders and rules

CLAI uses exactly four line-drawing characters and nothing else.

| Purpose | Character | Codepoint |
|---|---|---|
| Left rule on a panel or message block | `▌` | U+258C |
| Horizontal rule between sections | `─` | U+2500 |
| Progress bar, filled cell | `█` | U+2588 |
| Progress bar, idle cell | `░` | U+2591 |

There are no box corners, no `┌`, no `│`, no rounded borders. Blocks are delimited by a left rule and a background fill only. This is both the reference look and a hedge: corner characters are where terminal font fallback most often produces gaps.

---

## 4. Typography

### 4.1 Weight

Bold is used for exactly four things: sidebar section headings, the session title, the bright half of the wordmark, and the key portion of a keybind hint (the `tab` in `tab switch agent`). Nothing else is ever bold. In particular, assistant prose is not bold, tool verbs are not bold, and markdown `**strong**` uses `clai.md.strong`'s colour rather than the bold attribute, because doubling colour and weight makes prose noisy.

The dim attribute is not used at truecolor or 256 levels; `clai.textMuted` and `clai.textFaint` carry that job as real colours, which is more predictable across terminals. Dim is used only at the 16-colour level, and only for `clai.textFaint`.

Italic and underline are not used anywhere in chrome. Underline appears only on OSC 8 hyperlinks, where the terminal draws it.

### 4.2 Case

Chrome is lowercase. This is the most recognisable single feature of the reference look and it should be applied without exceptions creeping in.

- Keybind hints are lowercase: `tab switch agent`, `ctrl+p commands`, `esc interrupt`.
- Placeholder text is sentence case with a trailing ellipsis: `Ask anything...`.
- The wordmark is lowercase: `clai`.
- Slash commands are lowercase: `/status`.

Title case is reserved for three categories: sidebar section headings (`Context`, `MCP`, `LSP`, `Todo`), tool verbs (`Read`, `Grep`), and status words (`Connected`, `Connecting`, `Failed`). Acronyms stay uppercase (`MCP`, `LSP`). Model and provider names are rendered exactly as the provider reports them and are never case-normalised.

### 4.3 Character set

Every glyph CLAI is permitted to draw, with its codepoint and its ASCII fallback for the `CLAI_ASCII=1` mode described below.

| Role | Glyph | Codepoint | ASCII fallback |
|---|---|---|---|
| Tool row sigil, default | `·` | U+00B7 | `-` |
| Tool row sigil, read-family | `→` | U+2192 | `>` |
| Tool row sigil, search-family | `✳` | U+2733 | `*` |
| Tool row sigil, task/subagent | `◈` | U+25C8 | `#` |
| Status dot | `●` | U+25CF | `*` |
| List bullet | `•` | U+2022 | `-` |
| Tree branch | `├` | U+251C | `|` |
| Tree last branch | `└` | U+2514 | `` ` `` |
| Tree vertical | `│` | U+2502 | `|` |
| Disclosure, expanded | `▾` | U+25BE | `v` |
| Disclosure, collapsed | `▸` | U+25B8 | `>` |
| Agent-line marker | `◼` | U+25FC | `#` |
| Prompt/panel left rule | `▌` | U+258C | `|` |
| Horizontal rule | `─` | U+2500 | `-` |
| Progress filled | `█` | U+2588 | `#` |
| Progress idle | `░` | U+2591 | `.` |
| Wordmark upper half | `▀` | U+2580 | `#` |
| Wordmark lower half | `▄` | U+2584 | `#` |
| Wordmark full block | `█` | U+2588 | `#` |
| Todo, pending | `[ ]` | ASCII | `[ ]` |
| Todo, in progress | `[~]` | ASCII | `[~]` |
| Todo, complete | `[x]` | ASCII | `[x]` |
| Todo, cancelled | `[-]` | ASCII | `[-]` |

The spinner is a ten-frame Braille sequence at 80 ms per frame: `⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏` (U+280B, U+2819, U+2839, U+2838, U+283C, U+2834, U+2826, U+2827, U+2807, U+280F). Its ASCII fallback is the four-frame `| / - \` at 120 ms.

**Windows Terminal notes.** The default font is Cascadia Mono, and it covers the block elements (U+2580, U+2584, U+2588, U+258C, U+2591), the box drawing set (U+2500, U+2502, U+251C, U+2514), the geometric shapes used above (U+25B8, U+25BE, U+25C8, U+25CF, U+25FC), the bullet, the middle dot, and the arrow. All of those are safe. Cascadia Mono does **not** cover the Braille range, so the spinner falls back to a font substitution that is frequently the wrong width and produces a one-cell jitter on every frame. It also does not cover U+2733 (`✳`), which substitutes into an emoji-presentation glyph that occupies two cells in some builds. Therefore:

- On Windows, when `WT_SESSION` is set, the spinner defaults to the ASCII four-frame sequence and the search sigil defaults to `*`. Both can be forced back on with `CLAI_GLYPHS=unicode`.
- `CLAI_ASCII=1` forces the entire fallback column above, for CI logs, `conhost`, and screen readers.
- No glyph in CLAI is ever emoji-presentation, and no glyph is ever double-width. Any candidate glyph must be East Asian Width `Narrow` or `Neutral`; anything `Wide` or `Ambiguous` is rejected during review, because ambiguous-width characters render at one cell in some terminals and two in others and will break column alignment.

---

## 5. The CLAI wordmark

### 5.1 Technique

OpenCode builds its wordmark from half-block characters with tinted per-cell backgrounds, which lets a four-row-tall glyph carry apparent half-row detail. The art is stored as two arrays of strings, `left` and `right`, rendered side by side with a one-column gap: the left half in `textMuted` and not bold, the right half in `text` and bold, so the wordmark reads as two-tone. Four characters in the source strings are treated as marks rather than literal glyphs, and each expands to a character plus a colour pair, where the *shadow* colour is the foreground tinted 25% toward the background:

| Mark | Renders | Foreground | Background |
|---|---|---|---|
| `_` | space | foreground | shadow |
| `^` | `▀` | foreground | shadow |
| `~` | `▀` | shadow | none |
| `,` | `▄` | shadow | none |

Every other character in the source is drawn literally in the half's foreground colour with no background. CLAI adopts this technique unchanged, including the 25% tint ratio, so a builder can port `component/logo.tsx` almost line for line.

### 5.2 The art

CLAI splits the wordmark as `cl` (muted, not bold) and `ai` (bright, bold). Four rows; row zero carries ascenders and dots only. The source arrays:

```
left  = [ "     ▄   ",
          "█▀▀▀ █   ",
          "█___ █   ",
          "▀▀▀▀ ▀▀▀▀" ]

right = [ "     ▄",
          "█▀▀█ █",
          "█^^█ █",
          "▀▀▀▀ ▀" ]
```

The left half is nine columns, the right half six, and with the one-column gap between them the wordmark is sixteen columns wide by four rows tall. Rendered with the marks expanded — `_` becoming a shadowed space and `^` becoming a shadowed `▀` — it reads on screen as:

```
     ▄         ▄
█▀▀▀ █    █▀▀█ █
█    █    █▀▀█ █
▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀
```

The `c` is an open bowl, the `l` an ascender on a baseline serif, the `a` a closed bowl with a mid crossbar carried by the `^` marks (the same trick OpenCode uses for its `e`), and the `i` a stem with a dot. The wordmark is centred horizontally in the conversation column and its ASCII fallback replaces every block character with `#`, which is legible if inelegant.

### 5.3 What surrounds it on the splash

The splash is not a full-screen takeover. It is the home route: the wordmark and prompt box are centred as a group in the vertical middle of the conversation area, the footer is present as usual, and the sidebar is absent because there is no session yet. Below the wordmark there is one blank row, then the prompt box, then the keybind hint line right-aligned to the prompt box's right edge. The prompt box on the splash is 44 columns wide and centred, rather than filling the column, which is what gives the splash its composed feel.

A startup spinner appears bottom-anchored only if initialisation exceeds 500 ms, so a fast start never flashes it.

### 5.4 Splash mock

Rendered at 120 columns by 30 rows. Dots mark intentional blank space and are not drawn.

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                          ▄         ▄                                                 │
│                                                     █▀▀▀ █    █▀▀█ █                                                 │
│                                                     █    █    █▀▀█ █                                                 │
│                                                     ▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀                                                 │
│                                                                                                                      │
│                       ▌ Ask anything... "fix the failing edit tool test"                                             │
│                       ▌                                                                                              │
│                       ▌ Build  gpt-oss-20b  Groq                                                                     │
│                                                                            tab switch agent  ctrl+p commands         │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│ P:/Projects/clai  ● 2 MCP  /status                                                                        clai 0.1.0 │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

The outer box in the mock represents the terminal edge and is not drawn by CLAI. In the real render, `Ask anything...` is `clai.textMuted`, `Build` is `clai.accent`, the model name is `clai.text`, the provider name is `clai.textMuted`, `tab` and `ctrl+p` are bold `clai.text` with their descriptions in `clai.textMuted`, and the whole footer row is `clai.textMuted` except the `●` which is `clai.success`.

### 5.5 Working-screen mock

Rendered at 140 columns by 34 rows, sidebar docked.

```
┌────────────────────────────────────────────────────────────────────────────────────────────────┬──────────────────────────────────────────┐
│                                                                                                │ Wire the edit tool into the sandbox      │
│ ▌ add a new field for signups that validates the user is 18                                    │ approval path                            │
│ ▌ yashraj                                                                                      │                                          │
│                                                                                                │ Context                                  │
│ I'll add an age verification field. Let me first explore the repo to understand the current    │ 28,221 tokens                            │
│ signup structure.                                                                              │ 14% used                                 │
│                                                                                                │ $0.24 spent                              │
│ ✳ Grep "CreateNewUser|RegisterController"                                                      │                                          │
│ → Read src/tools/edit.ts                                                                       │ MCP                                      │
│ → Read src/sandbox/index.ts                                                                    │ ● context7 Connected                     │
│ · List src/tools                                                                               │ ● exa Connecting                         │
│ → Read src/tools/write.ts                                                                      │                                          │
│                                                                                                │ ▾ LSP                                    │
│ ◈ Explore Task "find the approval seam"                                                        │ • typescript                             │
│   ├ ✳ Grep "approval" src/sandbox                                                              │ • eslint                                 │
│   ├ → Read src/sandbox/approval.ts                                                             │                                          │
│   └ · List src/sandbox                                                                         │ ▾ Todo                                   │
│                                                                                                │ [x] Read the sandbox approval seam       │
│ ctrl+x right, ctrl+x left to navigate between subagent sessions                                │ [~] Route edit through the approval      │
│                                                                                                │     hook                                 │
│ Now I have the picture. Here is the plan:                                                      │ [ ] Add a trace event for denials        │
│                                                                                                │ [ ] Update the tiny-edit fixture         │
│ ▌ [x] Read the sandbox approval seam                                                           │ [ ] Run the offline demo                 │
│ ▌ [~] Route edit through the approval hook                                                     │                                          │
│ ▌ [ ] Add a trace event for denials                                                            │                                          │
│ ▌ [ ] Update the tiny-edit fixture                                                             │                                          │
│ ▌ [ ] Run the offline demo                                                                     │                                          │
│                                                                                                │                                          │
│ ⠹ Build · gpt-oss-20b                                                                          │                                          │
│                                                                                                │                                          │
│ ▌                                                                                              │                                          │
│ ▌                                                                                              │                                          │
│ ▌ Build  gpt-oss-20b  Groq                                                                     │ P:/Projects/clai                         │
│ ███░░░░░ esc interrupt                                        tab switch agent  ctrl+p commands│ ● clai 0.1.0                             │
└────────────────────────────────────────────────────────────────────────────────────────────────┴──────────────────────────────────────────┘
```

Again the outer box and the vertical divider are the terminal edge and the notional column boundary; neither is drawn. The user message block and the todo block are the two regions filled with `clai.backgroundPanel`, each with a `clai.border` left rule. The in-flight agent line at the bottom of the transcript carries the spinner in `clai.accent`, the agent name in `clai.text`, and the model in `clai.textMuted`.

---

## 6. Exact status strings

Every string below is literal. Placeholders are written in angle brackets and are the only part a builder substitutes. Spacing shown between fields is exact: where two spaces appear, two spaces are meant.

### 6.1 Sidebar

| Element | Literal string | Colour |
|---|---|---|
| Session title | `<title>` | `clai.text`, bold |
| Session title, before naming | `New session` | `clai.textMuted`, bold |
| Context heading | `Context` | `clai.text`, bold |
| Token count | `<n> tokens` | `clai.textMuted` |
| Token count, zero | `0 tokens` | `clai.textMuted` |
| Percentage used | `<p>% used` | `clai.textMuted`; `clai.warning` at 80–94; `clai.error` at 95+ |
| Cost | `$<d> spent` | `clai.textMuted` |
| MCP heading | `MCP` | `clai.text`, bold |
| MCP entry, connected | `● <name> Connected` | dot `clai.success`, name `clai.text`, state `clai.textMuted` |
| MCP entry, connecting | `● <name> Connecting` | dot `clai.warning`, name `clai.text`, state `clai.textMuted` |
| MCP entry, failed | `● <name> Failed` | dot `clai.error`, name `clai.text`, state `clai.error` |
| MCP entry, disabled | `● <name> Disabled` | dot `clai.textFaint`, name and state `clai.textMuted` |
| MCP, none configured | `No MCP servers configured` | `clai.textMuted` |
| LSP heading | `LSP` | `clai.text`, bold |
| LSP entry | `• <name>` | bullet `clai.accent`, name `clai.textMuted` |
| LSP, none activated | `LSPs will activate as files are read` | `clai.textMuted` |
| Todo heading | `Todo` | `clai.text`, bold |
| Todo, pending | `[ ] <text>` | box and text `clai.textMuted` |
| Todo, in progress | `[~] <text>` | box `clai.accent`, text `clai.text` |
| Todo, complete | `[x] <text>` | box `clai.success`, text `clai.textFaint` |
| Todo, cancelled | `[-] <text>` | box and text `clai.textFaint` |
| Sidebar footer, cwd | `<cwd>` | `clai.textMuted` |
| Sidebar footer, product | `● clai <version>` | dot `clai.accent`, `clai` `clai.text`, version `clai.textMuted` |

Token counts use thousands separators from the `en-US` locale, so `28,221 tokens`. The percentage is an integer with no decimal and always carries the `%`. Cost is always two decimal places and always carries the leading `$`, so a free run shows `$0.00 spent`, never `$0 spent`.

### 6.2 Prompt box and footer

| Element | Literal string | Colour |
|---|---|---|
| Placeholder | `Ask anything... "<rotating example>"` | `clai.textMuted` |
| Agent/model line | `<Agent>  <model>  <provider>` | agent `clai.accent`, model `clai.text`, provider `clai.textMuted` |
| Agent/model line, concrete | `Build  gpt-oss-20b  Groq` | as above |
| In-flight transcript line | `<spinner> <Agent> · <model>` | spinner `clai.accent`, agent `clai.text`, `·` and model `clai.textMuted` |
| Interrupt, armed | `esc interrupt` | `esc` bold `clai.text`, word `clai.textMuted` |
| Interrupt, second tap needed | `esc again to interrupt` | `esc` bold `clai.warning`, rest `clai.textMuted` |
| Keybind hint, agent | `tab switch agent` | key bold `clai.text`, description `clai.textMuted` |
| Keybind hint, palette | `ctrl+p commands` | as above |
| Keybind hint, subagents | `ctrl+x right, ctrl+x left to navigate between subagent sessions` | keys bold `clai.text`, rest `clai.textMuted` |
| Footer cwd | `<cwd>` | `clai.textMuted` |
| Footer MCP summary | `● <n> MCP` | dot `clai.success` if all connected, `clai.warning` if any connecting, `clai.error` if any failed; text `clai.text` |
| Footer status command | `/status` | `clai.textMuted` |
| Footer version | `clai <version>` | `clai` `clai.text`, version `clai.textMuted` |

The three footer-left fields on the splash are joined by two spaces: `<cwd>  ● 2 MCP  /status`. The keybind hints on the right are also joined by two spaces. The MCP summary is pluralised only in the count, never in the acronym — `● 1 MCP`, not `● 1 MCPs`.

### 6.3 Tool and transcript strings

| Element | Literal string |
|---|---|
| Read | `→ Read <path>` |
| Write | `· Write <path>` |
| Edit | `· Edit <path>` |
| Glob | `· Glob <pattern>` |
| Grep, no count | `✳ Grep "<pattern>"` |
| Grep, with count | `✳ Grep "<pattern>" (<n> matches)` |
| List | `· List <path>` |
| Bash | `· Bash <command>` |
| Subagent task | `◈ <Agent> Task "<description>"` |
| Delegation notice | `~ Delegating...` |
| Question notice | `~ Asking questions...` |
| Tool failure | `● <Verb> <target> Failed` with the dot and `Failed` in `clai.error` |
| Truncation notice | `… <n> more lines` in `clai.textMuted` |

Tool verbs are always title case and always a single word. The target is never quoted except for Grep patterns, which always are. Paths are rendered relative to the working directory when they are inside it and absolute when they are not; they are never abbreviated with an ellipsis in the middle, because a truncated path is worse than a wrapped one.

---

## 7. What a builder should do first

Land the palette module and the capability detector before any component work, because every component depends on `resolve(token)` and retrofitting it is painful. Then the four line-drawing characters and the glyph table, since those decide the Windows story. The wordmark is last: it is the most visible piece and the least structural, and it can be dropped into a working home route in an afternoon once the theme module exists.
