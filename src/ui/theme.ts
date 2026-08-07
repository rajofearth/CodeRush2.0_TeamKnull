/**
 * ui/theme — the CLAI visual language, as locked in assets/23-visual-language.md.
 *
 * One theme (`clai-dark`), semantic tokens over a 12-step neutral ramp, one
 * capability probe frozen at startup, one `resolve(token)` function. Components
 * never reference a hex or a ramp step directly and never branch on capability.
 */

import os from "node:os";

// ── capability ───────────────────────────────────────────────────────────────

export type ColorLevel = "truecolor" | "256" | "16" | "none";

export type ThemeEnv = Record<string, string | undefined>;

/**
 * Resolution order (first match wins):
 * NO_COLOR → CLAI_COLOR → FORCE_COLOR → non-TTY → COLORTERM → WT_SESSION /
 * Windows ≥ 15063 → TERM 256color → 16.
 */
export function detectColorLevel(
  env: ThemeEnv = process.env,
  isTTY: boolean = Boolean(process.stdout.isTTY),
): ColorLevel {
  if (env.NO_COLOR) return "none";

  const claiColor = env.CLAI_COLOR;
  if (claiColor === "truecolor" || claiColor === "256" || claiColor === "16" || claiColor === "none") {
    return claiColor;
  }

  const force = env.FORCE_COLOR;
  if (force === "3") return "truecolor";
  if (force === "2") return "256";
  if (force === "1") return "16";
  if (force === "0") return "none";

  if (!isTTY) return "none";

  const colorterm = env.COLORTERM;
  if (colorterm === "truecolor" || colorterm === "24bit") return "truecolor";

  if (process.platform === "win32") {
    if (env.WT_SESSION) return "truecolor";
    const build = Number(os.release().split(".")[2] ?? 0);
    if (build >= 15063) return "truecolor";
  }

  if (env.TERM?.includes("256color")) return "256";
  return "16";
}

// ── tokens ───────────────────────────────────────────────────────────────────

export type ThemeToken =
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

/** Truecolor hexes, straight from the spec (section 1.2). */
const HEX: Record<ThemeToken, string> = {
  "clai.background": "#0a0a0a",
  "clai.backgroundPanel": "#141414",
  "clai.backgroundElement": "#1e1e1e",
  "clai.backgroundElementHover": "#282828",
  "clai.backgroundElementActive": "#323232",
  "clai.text": "#eeeeee",
  "clai.textMuted": "#808080",
  "clai.textFaint": "#606060",
  "clai.accent": "#5c9cf5",
  "clai.accentHover": "#7fb3f8",
  "clai.border": "#484848",
  "clai.borderActive": "#606060",
  "clai.borderSubtle": "#3c3c3c",
  "clai.success": "#7fd88f",
  "clai.warning": "#f5a742",
  "clai.error": "#e06c75",
  "clai.info": "#56b6c2",
  "clai.diffAdded": "#4fd6be",
  "clai.diffRemoved": "#c53b53",
  "clai.diffContext": "#828bb8",
  "clai.diffHunkHeader": "#828bb8",
  "clai.diffAddedBg": "#20303b",
  "clai.diffRemovedBg": "#37222c",
  "clai.diffLineNumber": "#8f8f8f",
};

/** Hand-picked xterm-256 indices (spec 2.2). Missing = dropped at this level. */
const INDEX_256: Partial<Record<ThemeToken, number>> = {
  "clai.background": 232,
  "clai.backgroundPanel": 233,
  "clai.backgroundElement": 234,
  "clai.backgroundElementHover": 235,
  "clai.backgroundElementActive": 236,
  "clai.borderSubtle": 237,
  "clai.border": 238,
  "clai.borderActive": 240,
  "clai.textFaint": 241,
  "clai.textMuted": 244,
  "clai.text": 255,
  "clai.accent": 75,
  "clai.accentHover": 117,
  "clai.success": 114,
  "clai.warning": 215,
  "clai.error": 174,
  "clai.info": 73,
  "clai.diffAdded": 79,
  "clai.diffRemoved": 161,
  "clai.diffContext": 103,
  "clai.diffHunkHeader": 103,
  "clai.diffLineNumber": 244,
};

/**
 * 16-colour degradation (spec 2.3). Values are Ink/chalk colour names.
 * Backgrounds are not emitted at this level.
 */
const ANSI_16: Partial<Record<ThemeToken, string>> = {
  "clai.text": "whiteBright",
  "clai.textMuted": "blackBright",
  "clai.textFaint": "blackBright",
  "clai.accent": "blueBright",
  "clai.accentHover": "cyanBright",
  "clai.success": "greenBright",
  "clai.warning": "yellow",
  "clai.error": "redBright",
  "clai.info": "cyan",
  "clai.diffAdded": "green",
  "clai.diffRemoved": "red",
  "clai.diffContext": "white",
  "clai.diffHunkHeader": "white",
  "clai.diffLineNumber": "blackBright",
  "clai.border": "blackBright",
  "clai.borderSubtle": "blackBright",
  "clai.borderActive": "white",
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

/** xterm-256 index → hex, for the 22 indices the spec uses. */
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
 * Resolve a semantic token to a colour value Ink's `color` / `backgroundColor`
 * props accept, degraded to the frozen capability level. `undefined` means
 * "emit nothing" (dropped background, or level `none`).
 */
export function resolve(token: ThemeToken): string | undefined {
  const level = colorLevel();
  if (level === "none") return undefined;
  if (level === "truecolor") return HEX[token];
  if (level === "256") {
    const index = INDEX_256[token];
    return index == null ? undefined : xterm256ToHex(index);
  }
  // 16 colours: surfaces are abandoned entirely.
  if (BACKGROUND_TOKENS.has(token)) return undefined;
  return ANSI_16[token];
}

/** True when `clai.textFaint` should additionally carry the dim attribute. */
export function faintUsesDim(): boolean {
  return colorLevel() === "16";
}

/** Tint `hex` toward `toward` by `ratio` (0..1). Used for wordmark shadows. */
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

export type GlyphName =
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
  sigilDefault: "·",
  sigilRead: "→",
  sigilSearch: "✳",
  sigilTask: "◈",
  statusDot: "●",
  bullet: "•",
  treeBranch: "├",
  treeLast: "└",
  treeVertical: "│",
  discloseOpen: "▾",
  discloseClosed: "▸",
  agentMarker: "◼",
  leftRule: "▌",
  hRule: "─",
  progressFull: "█",
  progressIdle: "░",
  blockUpper: "▀",
  blockLower: "▄",
  blockFull: "█",
};

const ASCII_GLYPHS: Record<GlyphName, string> = {
  sigilDefault: "-",
  sigilRead: ">",
  sigilSearch: "*",
  sigilTask: "#",
  statusDot: "*",
  bullet: "-",
  treeBranch: "|",
  treeLast: "`",
  treeVertical: "|",
  discloseOpen: "v",
  discloseClosed: ">",
  agentMarker: "#",
  leftRule: "|",
  hRule: "-",
  progressFull: "#",
  progressIdle: ".",
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
 * Glyph selection (spec 4.3). `CLAI_ASCII=1` forces the full ASCII column.
 * On Windows Terminal (Cascadia Mono lacks Braille and U+2733) the spinner
 * and search sigil degrade to ASCII unless `CLAI_GLYPHS=unicode`.
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
    glyph: (name) =>
      wtDegrade && name === "sigilSearch"
        ? ASCII_GLYPHS.sigilSearch
        : UNICODE_GLYPHS[name],
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

const SGR_RESET = "\x1b[0m";

/** Wrap `text` in SGR foreground for stdout (log printer, not Ink). */
export function paintText(token: ThemeToken, text: string, opts?: { dim?: boolean }): string {
  const level = colorLevel();
  if (level === "none") return text;

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
    const code =
      name === "whiteBright"
        ? 97
        : name === "blackBright"
          ? 90
          : name === "blueBright"
            ? 94
            : name === "cyanBright"
              ? 96
              : name === "greenBright"
                ? 92
                : name === "yellow"
                  ? 93
                  : name === "redBright"
                    ? 91
                    : name === "green"
                      ? 32
                      : name === "red"
                        ? 31
                        : name === "cyan"
                          ? 36
                          : name === "white"
                            ? 37
                            : name === "blue"
                              ? 34
                              : 37;
    open = `\x1b[${code}m`;
  }
  const dim = opts?.dim ? "\x1b[2m" : "";
  return `${open}${dim}${text}${SGR_RESET}`;
}

export function resetSgr(): string {
  return SGR_RESET;
}

// ── wordmark ─────────────────────────────────────────────────────────────────

/**
 * Half-block wordmark art (spec 5.2). `_ ^ ~ ,` are marks, not literal glyphs:
 * `_` shadowed space, `^` shadowed `▀`, `~` shadow-fg `▀`, `,` shadow-fg `▄`.
 */
export const WORDMARK_LEFT = [
  "     ▄   ",
  "█▀▀▀ █   ",
  "█___ █   ",
  "▀▀▀▀ ▀▀▀▀",
];

export const WORDMARK_RIGHT = [
  "     ▄",
  "█▀▀█ █",
  "█^^█ █",
  "▀▀▀▀ ▀",
];

export type WordmarkCell = {
  char: string;
  /** "fg" normal, "shadowFg" shadow-coloured glyph, "shadowBg" fg glyph on shadow bg. */
  paint: "fg" | "shadowFg" | "shadowBg";
};

export function expandWordmarkRow(row: string): WordmarkCell[] {
  return [...row].map((char) => {
    switch (char) {
      case "_":
        return { char: " ", paint: "shadowBg" };
      case "^":
        return { char: glyph("blockUpper"), paint: "shadowBg" };
      case "~":
        return { char: glyph("blockUpper"), paint: "shadowFg" };
      case ",":
        return { char: glyph("blockLower"), paint: "shadowFg" };
      case "▄":
        return { char: glyph("blockLower"), paint: "fg" };
      case "▀":
        return { char: glyph("blockUpper"), paint: "fg" };
      case "█":
        return { char: glyph("blockFull"), paint: "fg" };
      default:
        return { char, paint: "fg" };
    }
  });
}
