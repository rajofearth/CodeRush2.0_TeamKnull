/**
 * workspace — the one resolved root a clai session runs against.
 *
 * `clai <folder>` launches the interface with that folder as the workspace root;
 * everything the harness writes or reads by convention (tool cwd, `.clai/traces`,
 * `.clai` memory, repo intake) hangs off `Workspace.root` instead of a scattered
 * `process.cwd()`. Entry parsing lives here too so the subcommand-vs-path
 * tie-breaker is stated once.
 */

import { stat } from "node:fs/promises";
import path from "node:path";

/** Reserved bare words. A bare `clai demo` is a subcommand, `clai ./demo` is a path. */
export const SUBCOMMANDS = [
  "run",
  "chat",
  "demo",
  "intake",
  "memory",
  "bench",
  "glass",
  "help",
] as const;

export type Subcommand = (typeof SUBCOMMANDS)[number];

export type EntryPlan = {
  /** Set when argv[0] is a reserved bare word. */
  subcommand?: Subcommand;
  /** Positional folder path, when argv[0] is not a reserved bare word. */
  workspaceInput?: string;
  /** argv with the `--` separator removed, so flag lookups keep working. */
  args: string[];
};

export class WorkspaceError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
    this.name = "WorkspaceError";
  }
}

export type Workspace = {
  /** Absolute, resolved workspace root. */
  root: string;
  /** `.clai` under the root, unless CLAI_DATA_DIR overrides it. */
  dataDir: string;
  /** `<dataDir>/traces` — per-run subdirectories are created by the trace writer. */
  tracesDir: string;
  isGitRepo: boolean;
  /** How the root was chosen: explicit flag, positional path, or the default cwd. */
  source: "--cwd" | "argument" | "cwd";
  /** Non-fatal notes worth showing the user (e.g. "not a git repository"). */
  notes: string[];
};

/**
 * Directory the user typed the command in. `bin/clai.js` re-execs with its own
 * cwd so tsx resolves, and forwards the original through this variable.
 */
export function invocationCwd(): string {
  const forwarded = process.env.CLAI_INVOCATION_CWD;
  return forwarded && forwarded.trim() ? forwarded : process.cwd();
}

function isSubcommandWord(word: string): word is Subcommand {
  return (SUBCOMMANDS as readonly string[]).includes(word);
}

/**
 * Decide whether the first token is a subcommand or a workspace folder.
 *
 * Precedence: `--` separator (everything after it is a path, never a command) >
 * reserved bare word > positional path. `--cwd <path>` overrides the positional
 * either way and is resolved by the caller.
 */
export function parseEntry(argv: string[]): EntryPlan {
  const separator = argv.indexOf("--");
  const head = separator >= 0 ? argv.slice(0, separator) : argv;
  const tail = separator >= 0 ? argv.slice(separator + 1) : [];
  const args = [...head, ...tail];
  const first = head[0];

  if (first && !first.startsWith("-")) {
    return isSubcommandWord(first)
      ? { subcommand: first, args }
      : { workspaceInput: first, args };
  }
  if (tail[0]) return { workspaceInput: tail[0], args };
  return { args };
}

/**
 * Resolve and validate the workspace root. Throws `WorkspaceError` with an
 * actionable hint rather than letting an ENOENT stack trace escape.
 */
export async function openWorkspace(
  input?: string,
  source: Workspace["source"] = input ? "argument" : "cwd",
): Promise<Workspace> {
  const base = invocationCwd();
  const root = path.resolve(base, input ?? ".");

  let info;
  try {
    info = await stat(root);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new WorkspaceError(
        `clai: workspace folder does not exist: ${root}`,
        "Pass an existing directory, or run `clai --help` for the subcommand list.",
      );
    }
    throw new WorkspaceError(
      `clai: cannot open workspace folder ${root} (${code ?? "unknown error"})`,
      "Check the path and your permissions on it.",
    );
  }

  if (!info.isDirectory()) {
    throw new WorkspaceError(
      `clai: workspace path is a file, not a folder: ${root}`,
      `Pass the containing folder instead: clai ${path.dirname(root)}`,
    );
  }

  const isGitRepo = await pathExists(path.join(root, ".git"));
  const dataDir = process.env.CLAI_DATA_DIR
    ? path.resolve(base, process.env.CLAI_DATA_DIR)
    : path.join(root, ".clai");

  return {
    root,
    dataDir,
    tracesDir: path.join(dataDir, "traces"),
    isGitRepo,
    source,
    notes: isGitRepo
      ? []
      : [
          `${root} is not a git repository — git-aware intake and diff review stay off.`,
        ],
  };
}

/** Resolve from parsed argv: `--cwd` wins over the positional folder. */
export async function openWorkspaceFromEntry(
  entry: EntryPlan,
  cwdFlag?: string,
): Promise<Workspace> {
  if (cwdFlag) return openWorkspace(cwdFlag, "--cwd");
  return openWorkspace(entry.workspaceInput);
}

/** Print non-fatal workspace notes to stderr so stdout stays machine-readable. */
export function printWorkspaceNotes(workspace: Workspace): void {
  for (const note of workspace.notes) console.error(`clai: note — ${note}`);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}
