/**
 * ui/theme — metallic silver / matte black visual language for the CLAI Ink TUI.
 *
 * One palette, one capability probe frozen at startup, one `resolve(token)`.
 * Components never hard-code hex/ANSI. Saturated colour is reserved for the
 * verification lifecycle; everything else stays brushed steel on matte black.
 *
 * Colour depth follows chalk's level (truecolor → 256 → 16 → none). `NO_COLOR`
 * unconditionally collapses brand/text/border to the terminal default; state
 * icons still render (shape carries meaning).
 */

import chalk from "chalk";

// ── capability ───────────────────────────────────────────────────────────────

export type ColorLevel = "truecolor" | "256" | "16" | "none";

export type ThemeEnv = Record<string, string | undefined>;

/** Map chalk.level (0–3) onto our named depth. */
export function chalkLevelToColorLevel(level: number): ColorLevel {
  if (level <= 0) return "none";
  if (level === 1) return "16";
  if (level === 2) return "256";
  return "truecolor";
}

/**
 * Resolution order (first match wins):
 * NO_COLOR → CLAI_COLOR → FORCE_COLOR → non-TTY → chalk.level (process env) →
 * COLORTERM / TERM heuristics for custom env bags (tests).
 */
export function detectColorLevel(
  env: ThemeEnv = process.env,
  isTTY: boolean = Boolean(process.stdout.isTTY),
): ColorLevel {
  if (env.NO_COLOR) return "none";

  const claiColor = env.CLAI_COLOR;
  if (
    claiColor === "truecolor" ||
    claiColor === "256" ||
    claiColor === "16" ||
    claiColor === "none"
  ) {
    return claiColor;
  }

  const force = env.FORCE_COLOR;
  if (force === "3") return "truecolor";
  if (force === "2") return "256";
  if (force === "1") return "16";
  if (force === "0") return "none";

  if (!isTTY) return "none";

  // Prefer chalk's live probe when reading the real process environment.
  if (env === process.env) {
    return chalkLevelToColorLevel(chalk.level);
  }

  const colorterm = env.COLORTERM;
  if (colorterm === "truecolor" || colorterm === "24bit") return "truecolor";
  if (env.TERM?.includes("256color")) return "256";
  return "16";
}

// ── lifecycle (the only saturated colours) ───────────────────────────────────

export type LifecycleState =
  | "working"
  | "verify"
  | "pass"
  | "repair"
  | "fail"
  | "blocked";

export type LifecycleSpec = {
  state: LifecycleState;
  icon: string;
  /** Semantic token that paints the icon (and spinner during working/verify). */
  token: ThemeToken;
  label: string;
};

/** Canonical icon + colour pairing — reuse everywhere the phase appears. */
export const LIFECYCLE: Record<LifecycleState, LifecycleSpec> = {
  working: { state: "working", icon: "●", token: "state.working", label: "Working" },
  verify: { state: "verify", icon: "◐", token: "state.verify", label: "Verify" },
  pass: { state: "pass", icon: "✓", token: "state.pass", label: "PASS" },
  repair: { state: "repair", icon: "↻", token: "state.repair", label: "Repair" },
  fail: { state: "fail", icon: "✗", token: "state.fail", label: "FAIL" },
  blocked: { state: "blocked", icon: "⊘", token: "state.blocked", label: "BLOCKED" },
};

// ── tokens ───────────────────────────────────────────────────────────────────

export type ThemeToken =
  | "brand.wordmark"
  | "text.primary"
  | "text.muted"
  | "border"
  | "state.working"
  | "state.verify"
  | "state.pass"
  | "state.repair"
  | "state.fail"
  | "state.blocked"
  // Legacy aliases kept so log.ts / chat stay source-compatible without
  // touching non-ui modules. They resolve to the metallic palette above.
  | "clai.background"
  | "clai.backgroundPanel"
  | "clai.backgroundElement"
  | "clai.backgroundElementHover"
  | "clai.backgroundElementActive"
  | "clai.text"
  | "clai.textMuted"
  | "clai.textFaint"
  | "clai.accent"
  | "clai.accentHover"
  | "clai.border"
  | "clai.borderActive"
  | "clai.borderSubtle"
  | "clai.success"
  | "clai.warning"
  | "clai.error"
  | "clai.info"
  | "clai.diffAdded"
  | "clai.diffRemoved"
  | "clai.diffContext"
  | "clai.diffHunkHeader"
  | "clai.diffAddedBg"
  | "clai.diffRemovedBg"
  | "clai.diffLineNumber";

/** Truecolor hexes — primary column of the metallic palette. */
const HEX: Record<ThemeToken, string> = {
  "brand.wordmark": "#E8E8ED",
  "text.primary": "#C0C0C8",
  "text.muted": "#6B6E76",
  border: "#3A3C42",
  "state.working": "#D4A24C",
  "state.verify": "#8FD3E8",
  "state.pass": "#5FD98A",
  "state.repair": "#E08A3C",
  "state.fail": "#E85555",
  "state.blocked": "#6B6E76",

  // Legacy → metallic
  "clai.background": "#0A0A0A",
  "clai.backgroundPanel": "#121214",
  "clai.backgroundElement": "#1A1A1C",
  "clai.backgroundElementHover": "#222226",
  "clai.backgroundElementActive": "#2A2A2E",
  "clai.text": "#C0C0C8",
  "clai.textMuted": "#6B6E76",
  "clai.textFaint": "#6B6E76",
  "clai.accent": "#E8E8ED",
  "clai.accentHover": "#C0C0C8",
  "clai.border": "#3A3C42",
  "clai.borderActive": "#6B6E76",
  "clai.borderSubtle": "#3A3C42",
  "clai.success": "#5FD98A",
  "clai.warning": "#D4A24C",
  "clai.error": "#E85555",
  "clai.info": "#8FD3E8",
  "clai.diffAdded": "#5FD98A",
  "clai.diffRemoved": "#E85555",
  "clai.diffContext": "#6B6E76",
  "clai.diffHunkHeader": "#6B6E76",
  "clai.diffAddedBg": "#122018",
  "clai.diffRemovedBg": "#201212",
  "clai.diffLineNumber": "#6B6E76",
};

/** Named-colour fallback (Ink/chalk colour names) for 16-colour terminals. */
const ANSI_16: Partial<Record<ThemeToken, string>> = {
  "brand.wordmark": "whiteBright",
  "text.primary": "white",
  "text.muted": "gray",
  border: "gray",
  "state.working": "yellow",
  "state.verify": "cyan",
  "state.pass": "green",
  "state.repair": "yellow",
  "state.fail": "red",
  "state.blocked": "gray",

  "clai.text": "white",
  "clai.textMuted": "gray",
  "clai.textFaint": "gray",
  "clai.accent": "whiteBright",
  "clai.accentHover": "white",
  "clai.success": "green",
  "clai.warning": "yellow",
  "clai.error": "red",
  "clai.info": "cyan",
  "clai.diffAdded": "green",
  "clai.diffRemoved": "red",
  "clai.diffContext": "white",
  "clai.diffHunkHeader": "white",
  "clai.diffLineNumber": "gray",
  "clai.border": "gray",
  "clai.borderSubtle": "gray",
  "clai.borderActive": "white",
};

/** Hand-picked xterm-256 indices for the metallic ramp + state colours. */
const INDEX_256: Partial<Record<ThemeToken, number>> = {
  "brand.wordmark": 255,
  "text.primary": 251,
  "text.muted": 242,
  border: 238,
  "state.working": 179,
  "state.verify": 116,
  "state.pass": 114,
  "state.repair": 208,
  "state.fail": 203,
  "state.blocked": 242,

  "clai.background": 232,
  "clai.backgroundPanel": 233,
  "clai.backgroundElement": 234,
  "clai.backgroundElementHover": 235,
  "clai.backgroundElementActive": 236,
  "clai.borderSubtle": 238,
  "clai.border": 238,
  "clai.borderActive": 242,
  "clai.textFaint": 242,
  "clai.textMuted": 242,
  "clai.text": 251,
  "clai.accent": 255,
  "clai.accentHover": 251,
  "clai.success": 114,
  "clai.warning": 179,
  "clai.error": 203,
  "clai.info": 116,
  "clai.diffAdded": 114,
  "clai.diffRemoved": 203,
  "clai.diffContext": 242,
  "clai.diffHunkHeader": 242,
  "clai.diffLineNumber": 242,
};

const BACKGROUND_TOKENS = new Set<ThemeToken>([
  "clai.background",
  "clai.backgroundPanel",
  "clai.backgroundElement",
  "clai.backgroundElementHover",
  "clai.backgroundElementActive",
  "clai.diffAddedBg",
  "clai.diffRemovedBg",
]);

/** Brand/text/border tokens — dropped under NO_COLOR (level none). */
const CHROME_TOKENS = new Set<ThemeToken>([
  "brand.wordmark",
  "text.primary",
  "text.muted",
  "border",
  "clai.text",
  "clai.textMuted",
  "clai.textFaint",
  "clai.accent",
  "clai.accentHover",
  "clai.border",
  "clai.borderActive",
  "clai.borderSubtle",
]);

function xterm256ToHex(index: number): string {
  if (index >= 232) {
    const v = 8 + (index - 232) * 10;
    const h = v.toString(16).padStart(2, "0");
    return `#${h}${h}${h}`;
  }
  const scale = [0, 95, 135, 175, 215, 255];
  const i = index - 16;
  const r = scale[Math.floor(i / 36) % 6]!;
  const g = scale[Math.floor(i / 6) % 6]!;
  const b = scale[i % 6]!;
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

let frozenLevel: ColorLevel | null = null;

/** The frozen capability level for this process. */
export function colorLevel(): ColorLevel {
  if (frozenLevel == null) frozenLevel = detectColorLevel();
  return frozenLevel;
}

/** Test seam: override the frozen level (render checks, previews). */
export function setColorLevel(level: ColorLevel | null): void {
  frozenLevel = level;
}

/**
 * Resolve a semantic token to a colour Ink's `color` / `backgroundColor`
 * props accept. `undefined` means emit nothing (NO_COLOR chrome, dropped
 * background, or level `none` for non-state tokens).
 *
 * State tokens still resolve under NO_COLOR as `undefined` so icons render
 * in the default foreground — shape carries the meaning.
 */
export function resolve(token: ThemeToken): string | undefined {
  const level = colorLevel();
  if (level === "none") return undefined;
  if (level === "truecolor") return HEX[token];
  if (level === "256") {
    const index = INDEX_256[token];
    return index == null ? undefined : xterm256ToHex(index);
  }
  if (BACKGROUND_TOKENS.has(token)) return undefined;
  return ANSI_16[token];
}

/** True when muted text should additionally carry the dim attribute. */
export function faintUsesDim(): boolean {
  return colorLevel() === "16" || colorLevel() === "none";
}

/** Tint `hex` toward `toward` by `ratio` (0..1). Kept for callers that still use it. */
export function tintHex(hex: string, toward: string, ratio: number): string {
  const parse = (value: string) => [
    parseInt(value.slice(1, 3), 16),
    parseInt(value.slice(3, 5), 16),
    parseInt(value.slice(5, 7), 16),
  ];
  const a = parse(hex);
  const b = parse(toward);
  const mix = a.map((channel, i) =>
    Math.round(channel + (b[i]! - channel) * ratio),
  );
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(mix[0]!)}${h(mix[1]!)}${h(mix[2]!)}`;
}

// ── glyphs ───────────────────────────────────────────────────────────────────

/**
 * Allowed UI icons (see README). Anything else must be added here and documented.
 * Spinner frames are motion, not icons, and live separately.
 */
export type GlyphName =
  | "pass"
  | "fail"
  | "warn"
  | "working"
  | "verify"
  | "repair"
  | "blocked"
  // Legacy names → mapped onto the allowed set so log.ts keeps compiling.
  | "sigilDefault"
  | "sigilRead"
  | "sigilSearch"
  | "sigilTask"
  | "statusDot"
  | "bullet"
  | "treeBranch"
  | "treeLast"
  | "treeVertical"
  | "discloseOpen"
  | "discloseClosed"
  | "agentMarker"
  | "leftRule"
  | "hRule"
  | "progressFull"
  | "progressIdle"
  | "blockUpper"
  | "blockLower"
  | "blockFull";

const UNICODE_GLYPHS: Record<GlyphName, string> = {
  pass: "✓",
  fail: "✗",
  warn: "⚠",
  working: "●",
  verify: "◐",
  repair: "↻",
  blocked: "⊘",
  // Legacy → allowed set / quiet chrome
  sigilDefault: "●",
  sigilRead: "●",
  sigilSearch: "●",
  sigilTask: "●",
  statusDot: "●",
  bullet: "●",
  treeBranch: "├",
  treeLast: "└",
  treeVertical: "│",
  discloseOpen: "▾",
  discloseClosed: "▸",
  agentMarker: "●",
  leftRule: "│",
  hRule: "─",
  progressFull: "─",
  progressIdle: "─",
  blockUpper: "▀",
  blockLower: "▄",
  blockFull: "█",
};

const ASCII_GLYPHS: Record<GlyphName, string> = {
  pass: "+",
  fail: "x",
  warn: "!",
  working: "*",
  verify: "o",
  repair: "~",
  blocked: "#",
  sigilDefault: "*",
  sigilRead: "*",
  sigilSearch: "*",
  sigilTask: "*",
  statusDot: "*",
  bullet: "*",
  treeBranch: "|",
  treeLast: "`",
  treeVertical: "|",
  discloseOpen: "v",
  discloseClosed: ">",
  agentMarker: "*",
  leftRule: "|",
  hRule: "-",
  progressFull: "-",
  progressIdle: "-",
  blockUpper: "#",
  blockLower: "#",
  blockFull: "#",
};

const UNICODE_SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const ASCII_SPINNER = ["|", "/", "-", "\\"];

export type GlyphSet = {
  glyph: (name: GlyphName) => string;
  spinnerFrames: string[];
  spinnerIntervalMs: number;
};

/**
 * Glyph selection. `CLAI_ASCII=1` forces the ASCII column. On Windows Terminal
 * the braille spinner degrades unless `CLAI_GLYPHS=unicode`.
 */
export function detectGlyphs(env: ThemeEnv = process.env): GlyphSet {
  if (env.CLAI_ASCII === "1") {
    return {
      glyph: (name) => ASCII_GLYPHS[name],
      spinnerFrames: ASCII_SPINNER,
      spinnerIntervalMs: 120,
    };
  }
  const wtDegrade = Boolean(env.WT_SESSION) && env.CLAI_GLYPHS !== "unicode";
  return {
    glyph: (name) => UNICODE_GLYPHS[name],
    spinnerFrames: wtDegrade ? ASCII_SPINNER : UNICODE_SPINNER,
    spinnerIntervalMs: wtDegrade ? 120 : 80,
  };
}

let frozenGlyphs: GlyphSet | null = null;

export function glyphs(): GlyphSet {
  if (frozenGlyphs == null) frozenGlyphs = detectGlyphs();
  return frozenGlyphs;
}

/** Test seam: override the frozen glyph set. */
export function setGlyphs(set: GlyphSet | null): void {
  frozenGlyphs = set;
}

export function glyph(name: GlyphName): string {
  return glyphs().glyph(name);
}

/** Lifecycle icon for a phase, honouring ASCII degrade. */
export function lifecycleIcon(state: LifecycleState): string {
  const map: Record<LifecycleState, GlyphName> = {
    working: "working",
    verify: "verify",
    pass: "pass",
    repair: "repair",
    fail: "fail",
    blocked: "blocked",
  };
  return glyph(map[state]);
}

const SGR_RESET = "\x1b[0m";

const ANSI_16_CODES: Record<string, number> = {
  whiteBright: 97,
  blackBright: 90,
  white: 37,
  gray: 90,
  blueBright: 94,
  cyanBright: 96,
  greenBright: 92,
  yellow: 93,
  redBright: 91,
  green: 32,
  red: 31,
  cyan: 36,
  blue: 34,
};

/** Wrap `text` in SGR foreground for stdout (log printer, not Ink). */
export function paintText(token: ThemeToken, text: string, opts?: { dim?: boolean }): string {
  const level = colorLevel();
  if (level === "none") {
    // Chrome collapses; state icons still print uncolored.
    return opts?.dim ? text : text;
  }

  let open = "";
  if (level === "truecolor") {
    const hex = HEX[token];
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    open = `\x1b[38;2;${r};${g};${b}m`;
  } else if (level === "256") {
    const index = INDEX_256[token];
    if (index == null) return text;
    open = `\x1b[38;5;${index}m`;
  } else {
    const name = ANSI_16[token];
    if (!name) return text;
    open = `\x1b[${ANSI_16_CODES[name] ?? 37}m`;
  }
  const dim = opts?.dim ? "\x1b[2m" : "";
  return `${open}${dim}${text}${SGR_RESET}`;
}

export function resetSgr(): string {
  return SGR_RESET;
}

// ── brand ────────────────────────────────────────────────────────────────────

/** Quiet wordmark text — never neon, never emoji. */
export const WORDMARK = "CLAI";

/** Barely-there credit, tucked into the context strip. */
export const CREDIT = "by team knull";

/**
 * Large half-block wordmark for the launch intro (3 rows × 4 letters).
 * Metallic chrome only — not a boxed splash.
 */
export const WORDMARK_LARGE: string[] = [
  " ███  █    ███  ███",
  "█     █   █  █   █ ",
  "█     █   ████   █ ",
  " ███  ███ █  █  ███",
];

/** Column ranges (inclusive start, exclusive end) per letter in WORDMARK_LARGE. */
export const WORDMARK_LARGE_COLS: Array<[number, number]> = [
  [0, 4],
  [5, 8],
  [9, 14],
  [15, 18],
];

/**
 * @deprecated Prefer WORDMARK / WORDMARK_LARGE.
 */
export const WORDMARK_LEFT: string[] = [];
/** @deprecated See WORDMARK_LEFT. */
export const WORDMARK_RIGHT: string[] = [];

export type WordmarkCell = {
  char: string;
  paint: "fg" | "shadowFg" | "shadowBg";
};

/** @deprecated Block wordmark expander — returns plain characters. */
export function expandWordmarkRow(row: string): WordmarkCell[] {
  return [...row].map((char) => ({ char, paint: "fg" as const }));
}

export function isChromeToken(token: ThemeToken): boolean {
  return CHROME_TOKENS.has(token);
}
