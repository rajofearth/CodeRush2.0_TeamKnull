# The `clai <folder>` entry contract

Asset for [Define the clai &lt;folder&gt; entry contract](https://github.com/rajofearth/CodeRush2.0_TeamKnull/issues/24).

`pnpm clai <folder path>` now launches the interface with that folder as the workspace root. This document is the decided contract: the argument grammar, the tie-breakers, the exact error text, and what "workspace root" governs once it can be set this way.

## Argument grammar

```
clai [<folder>] [--cwd <path>]
clai run "<prompt>" [--cwd <path>]
clai demo [lsp|injection] [--fixture <path>] [--data-dir <path>]
clai intake [--cwd <path>]
clai memory list|get|set|delete|export [--data-dir <path>]
clai --help | -h
clai -- <folder>
```

The reserved bare words are `run`, `demo`, `intake`, `memory`, and `help`. The rule is deliberately narrow: **only `argv[0]`** is ever examined for a subcommand, and only when it is an exact match for one of those five words. Anything else in first position is a workspace folder path. A leading `-` or `--flag` means there is no positional at all, so `clai --cwd fixtures/lsp-ts` and `clai --fixture …` behave as before.

Subcommands keep their own argument shapes untouched. `run` still takes its optional prompt as `argv[1]`, and `demo lsp` / `demo injection` are still recognised by `argv[1]`. Subcommands do **not** accept a positional folder, because that position is already spoken for by the prompt; they take `--cwd` instead.

## Precedence and tie-breakers

Resolution order for the workspace root, highest first:

1. `--cwd <path>` — always wins, in every mode including the bare launch.
2. The positional `<folder>`.
3. The invocation directory (`process.cwd()`, or `CLAI_INVOCATION_CWD` when the `bin/clai.js` shim re-execs from the package root).

The ambiguous case is a directory whose name collides with a subcommand, e.g. a folder literally called `demo` or `run`. Bare `clai demo` is the subcommand — that reading is stable and will not change. Two documented escape hatches open the folder instead:

- `clai -- demo` — everything after the `--` separator is a path and is never treated as a subcommand. The separator is stripped before flag lookup, so flags placed before it still work.
- `clai --cwd demo` — the explicit flag, which also works when the path is more convenient to pass as an option.

A path that is not a bare word never collides in the first place: `clai ./demo`, `clai .\demo`, `clai demo/`, and `clai P:\work\demo` are all unambiguously paths, since a subcommand is always a single bare word with no separator or `.` prefix.

Relative paths resolve against the invocation directory, not the package root. Because `pnpm run` executes scripts from the package root, `pnpm clai fixtures/tiny-edit` resolves inside the repository; an installed `clai` binary resolves against wherever the user is standing, which is why the shim forwards `CLAI_INVOCATION_CWD`.

## Argument-less and error cases

| Input | Behaviour |
|---|---|
| `clai` (no args) | Workspace root is the current directory. Launches the interface (previously this printed help). |
| `clai --help` / `-h` / `clai help` | Prints help, exit 0. Help is now the only way to get the help text. |
| Path does not exist | Error, exit 1. |
| Path is a file | Error, exit 1. |
| Path exists but is unreadable | Error, exit 1, with the underlying errno code. |
| Path is a directory but not a git repository | **Not** an error. One note on stderr, then the session starts. |

Exact messages, both written to stderr as two lines (message, then indented hint):

```
clai: workspace folder does not exist: <absolute path>
  Pass an existing directory, or run `clai --help` for the subcommand list.
```

```
clai: workspace path is a file, not a folder: <absolute path>
  Pass the containing folder instead: clai <parent directory>
```

```
clai: cannot open workspace folder <absolute path> (<errno code>)
  Check the path and your permissions on it.
```

```
clai: note — <absolute path> is not a git repository — git-aware intake and diff review stay off.
```

All of these are raised as a `WorkspaceError` carrying a `hint`, caught once in `src/cli.tsx`; no stack trace reaches the user. Notes and errors go to stderr so that stdout stays machine-readable for `intake` and the headless summary.

Git absence is a note rather than a failure on purpose. Scratch directories, extracted archives, and fixture folders are legitimate workspaces; only the git-aware slices of intake and future diff review degrade.

## What "workspace root" means

`Workspace` (`src/workspace.ts`) is the single resolved value threaded through the entry path, replacing the scattered `path.resolve(flagValue("--cwd") ?? process.cwd())` calls:

```ts
type Workspace = {
  root: string;        // absolute, validated directory
  dataDir: string;     // <root>/.clai, or CLAI_DATA_DIR when set
  tracesDir: string;   // <dataDir>/traces
  isGitRepo: boolean;
  source: "--cwd" | "argument" | "cwd";
  notes: string[];
};
```

The root governs four things:

- **Tool execution cwd.** `ctx.workspaceRoot` and `createSandbox({ workspaceRoot })` both take `workspace.root`, so read/edit/write/bash/grep/glob and the sandbox jail are rooted there.
- **Trace output.** `createTraceWriter` now accepts `tracesDir`, and traces land in `<root>/.clai/traces/<runId>/events.jsonl`.
- **Memory storage.** `runMemoryCli` takes the workspace `dataDir` as its default, so memory lives in `<root>/.clai`. An explicit `--data-dir` still wins, and `CLAI_DATA_DIR` still overrides `dataDir` globally.
- **Repo intake.** `scanIntakeMap(workspace.root)` and `probeLspAvailability(workspace.root)`.

Deliberately out of scope: the process `cwd` itself is never mutated, and `.env` loading still happens relative to the package. The demo commands keep their own `--fixture` root, since a fixture is a fixed workspace by definition, not a user-chosen one.

## Headless and the subcommands

`isTuiEnabled()` is unchanged: `CLAI_NO_TUI=1` or a non-TTY stdout selects the plain-line printer, and every existing headless path prints exactly as before with the same folder-root semantics. `clai demo`, `clai demo lsp`, `clai intake`, and `clai run "<prompt>"` are byte-for-byte compatible.

The one new question is what a bare `clai <folder>` means headlessly, since there is no interactive input to launch. Rather than fail with an API-key error or hang, it prints the resolved contract as JSON and exits 0:

```json
{
  "root": "P:\\Projects\\clai\\fixtures\\tiny-edit",
  "rootSource": "argument",
  "dataDir": "P:\\Projects\\clai\\fixtures\\tiny-edit\\.clai",
  "tracesDir": "P:\\Projects\\clai\\fixtures\\tiny-edit\\.clai\\traces",
  "gitRepo": false,
  "tui": false,
  "hint": "headless has no interactive input — use clai run \"<prompt>\" here"
}
```

This makes the entry contract testable in CI without a provider key and without burning a model call, and it keeps the failure mode informative for anyone who pipes `clai <folder>` into a script by mistake. On a TTY the same branch mounts the interactive Ink shell with no initial prompt, which is the intended launch behaviour.
