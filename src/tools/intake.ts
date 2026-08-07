/**
 * intake — Thin repository scan for plan/intake nodes.
 * Languages, entrypoints, config files, test-command hints — not a global AST DB.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { ToolContext, ToolResult } from "./common.js";
import { emitToolEvent, pathExists, resolveInWorkspace } from "./common.js";

export type IntakeLanguage = {
  id: string;
  files: number;
  extensions: string[];
};

export type IntakeEntrypoint = {
  path: string;
  kind: "bin" | "main" | "module" | "script" | "app";
  reason: string;
};

export type IntakeTestHint = {
  command: string;
  source: string;
};

export type IntakeTreeNode = {
  path: string;
  type: "dir" | "file";
};

export type IntakeGitSummary = {
  available: boolean;
  branch?: string;
  dirty?: boolean;
  shortStatus?: string;
  reason?: string;
};

export type IntakeMap = {
  root: string;
  scannedAt: string;
  languages: IntakeLanguage[];
  entrypoints: IntakeEntrypoint[];
  configFiles: string[];
  testHints: IntakeTestHint[];
  packageManagers: string[];
  tree: IntakeTreeNode[];
  git: IntakeGitSummary;
  /** Bounded issue prompt for plan/intake demo / coordinator seed. */
  issuePrompt: string;
  stats: {
    filesScanned: number;
    truncated: boolean;
  };
};

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".clai",
  "dist",
  "build",
  ".next",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  "target",
  ".turbo",
]);

const EXT_LANG: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
  ".md": "markdown",
  ".json": "json",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".toml": "toml",
  ".sh": "shell",
  ".ps1": "powershell",
};

const CONFIG_NAMES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "tsconfig.json",
  "jsconfig.json",
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "requirements.txt",
  "Pipfile",
  "Cargo.toml",
  "go.mod",
  "go.sum",
  "Makefile",
  "makefile",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "pytest.ini",
  "tox.ini",
  "Cargo.lock",
  "composer.json",
  "Gemfile",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  ".editorconfig",
  "README.md",
  "readme.md",
]);

async function walkShallow(
  root: string,
  maxFiles = 800,
  maxDepth = 3,
): Promise<{ files: string[]; dirs: string[]; truncated: boolean }> {
  const files: string[] = [];
  const dirs: string[] = [];
  let truncated = false;

  async function walk(dir: string, depth: number): Promise<void> {
    if (truncated) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (truncated) return;
      if (IGNORE_DIRS.has(ent.name)) continue;
      if (ent.name.startsWith(".") && ent.name !== ".env.example") continue;
      const abs = path.join(dir, ent.name);
      const rel = path.relative(root, abs).replace(/\\/g, "/");
      if (ent.isDirectory()) {
        dirs.push(rel);
        if (depth < maxDepth) await walk(abs, depth + 1);
      } else if (ent.isFile()) {
        files.push(rel);
        if (files.length >= maxFiles) truncated = true;
      }
    }
  }

  await walk(root, 0);
  return { files, dirs, truncated };
}

function detectLanguages(files: string[]): IntakeLanguage[] {
  const counts = new Map<string, { files: number; extensions: Set<string> }>();
  for (const rel of files) {
    const ext = path.extname(rel).toLowerCase();
    const lang = EXT_LANG[ext];
    if (!lang || lang === "markdown" || lang === "json" || lang === "yaml" || lang === "toml") {
      continue;
    }
    const entry = counts.get(lang) ?? { files: 0, extensions: new Set() };
    entry.files += 1;
    if (ext) entry.extensions.add(ext);
    counts.set(lang, entry);
  }
  return [...counts.entries()]
    .map(([id, v]) => ({
      id,
      files: v.files,
      extensions: [...v.extensions].sort(),
    }))
    .sort((a, b) => b.files - a.files || a.id.localeCompare(b.id));
}

async function readJson(abs: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(abs, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function collectFromPackageJson(
  root: string,
  rel: string,
  entrypoints: IntakeEntrypoint[],
  testHints: IntakeTestHint[],
  packageManagers: Set<string>,
): Promise<void> {
  packageManagers.add("npm");
  const pkg = await readJson(path.join(root, rel));
  if (!pkg) return;
  const dir = path.posix.dirname(rel) === "." ? "" : `${path.posix.dirname(rel)}/`;

  if (typeof pkg.main === "string") {
    entrypoints.push({
      path: `${dir}${pkg.main}`.replace(/^\.\//, ""),
      kind: "main",
      reason: `${rel}#main`,
    });
  }
  if (pkg.bin) {
    if (typeof pkg.bin === "string") {
      entrypoints.push({
        path: `${dir}${pkg.bin}`.replace(/^\.\//, ""),
        kind: "bin",
        reason: `${rel}#bin`,
      });
    } else if (typeof pkg.bin === "object" && pkg.bin) {
      for (const [name, p] of Object.entries(pkg.bin as Record<string, string>)) {
        entrypoints.push({
          path: `${dir}${p}`.replace(/^\.\//, ""),
          kind: "bin",
          reason: `${rel}#bin.${name}`,
        });
      }
    }
  }
  const scripts = pkg.scripts as Record<string, string> | undefined;
  if (scripts) {
    for (const key of ["test", "check", "lint", "typecheck", "verify"]) {
      if (scripts[key]) {
        const prefix =
          (await pathExists(path.join(root, "pnpm-lock.yaml")))
            ? "pnpm"
            : (await pathExists(path.join(root, "yarn.lock")))
              ? "yarn"
              : "npm";
        const run =
          prefix === "pnpm"
            ? `pnpm ${key}`
            : prefix === "yarn"
              ? `yarn ${key}`
              : `npm run ${key}`;
        testHints.push({ command: run, source: `${rel}#scripts.${key}` });
      }
    }
  }
}

function pushUniqueEntrypoint(
  list: IntakeEntrypoint[],
  item: IntakeEntrypoint,
): void {
  if (list.some((e) => e.path === item.path && e.kind === item.kind)) return;
  list.push(item);
}

async function detectGit(root: string): Promise<IntakeGitSummary> {
  try {
    const { execa } = await import("execa");
    const branch = await execa("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: root,
      reject: false,
      timeout: 3_000,
      windowsHide: true,
    });
    if (branch.exitCode !== 0) {
      return { available: false, reason: "not a git repository" };
    }
    const status = await execa("git", ["status", "--porcelain", "-b"], {
      cwd: root,
      reject: false,
      timeout: 3_000,
      windowsHide: true,
    });
    const lines = (status.stdout ?? "").split(/\r?\n/).filter(Boolean);
    const header = lines[0] ?? "";
    const dirty = lines.length > 1;
    return {
      available: true,
      branch: (branch.stdout ?? "").trim(),
      dirty,
      shortStatus: header.slice(0, 120),
    };
  } catch (err) {
    return {
      available: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

function buildIssuePrompt(map: IntakeMap): string {
  const topLang = map.languages[0]?.id ?? "unknown";
  const entry =
    map.entrypoints[0]?.path ??
    map.configFiles.find((c) => /readme/i.test(c)) ??
    map.tree.find((t) => t.type === "file")?.path ??
    ".";
  const test =
    map.testHints[0]?.command ??
    (topLang === "python"
      ? "pytest -q"
      : topLang === "typescript" || topLang === "javascript"
        ? "pnpm test"
        : "run project checks");
  const configs = map.configFiles.slice(0, 4).join(", ") || "none";
  return [
    `Bounded intake issue (${topLang}):`,
    `Inspect ${entry} and related sources; confirm project shape from configs (${configs}).`,
    `Propose one small, verifiable fix or clarification, then run: ${test}.`,
    `Stay inside the workspace; prefer read/grep/LSP before edits.`,
  ].join(" ");
}

export async function scanIntakeMap(
  workspaceRoot: string,
): Promise<IntakeMap> {
  const root = path.resolve(workspaceRoot);
  const { files, dirs, truncated } = await walkShallow(root);
  const languages = detectLanguages(files);
  const configFiles = files.filter((f) => {
    const base = path.posix.basename(f);
    return CONFIG_NAMES.has(base) || base.endsWith(".config.js") || base.endsWith(".config.ts");
  });

  const entrypoints: IntakeEntrypoint[] = [];
  const testHints: IntakeTestHint[] = [];
  const packageManagers = new Set<string>();

  for (const rel of files) {
    const base = path.posix.basename(rel);
    if (base === "package.json") {
      await collectFromPackageJson(
        root,
        rel,
        entrypoints,
        testHints,
        packageManagers,
      );
    }
    if (base === "pnpm-lock.yaml") packageManagers.add("pnpm");
    if (base === "yarn.lock") packageManagers.add("yarn");
    if (base === "package-lock.json") packageManagers.add("npm");
    if (base === "pyproject.toml" || base === "pytest.ini") {
      testHints.push({ command: "pytest -q", source: rel });
    }
    if (base === "requirements.txt" || base === "setup.py") {
      packageManagers.add("pip");
    }
    if (base === "Cargo.toml") {
      packageManagers.add("cargo");
      testHints.push({ command: "cargo test", source: rel });
    }
    if (base === "go.mod") {
      packageManagers.add("go");
      testHints.push({ command: "go test ./...", source: rel });
    }
    if (base === "Makefile" || base === "makefile") {
      testHints.push({ command: "make test", source: rel });
    }
    if (base === "check.mjs" || base === "check.js") {
      pushUniqueEntrypoint(entrypoints, {
        path: rel,
        kind: "script",
        reason: "verification script",
      });
      testHints.push({ command: `node ${rel}`, source: rel });
    }
  }

  // Heuristic source entrypoints
  for (const candidate of [
    "src/index.ts",
    "src/index.tsx",
    "src/index.js",
    "src/main.ts",
    "src/main.py",
    "index.ts",
    "index.js",
    "main.ts",
    "main.py",
    "app.py",
    "src/cli.tsx",
    "src/cli.ts",
  ]) {
    if (files.includes(candidate)) {
      pushUniqueEntrypoint(entrypoints, {
        path: candidate,
        kind: candidate.includes("cli") ? "bin" : "module",
        reason: "conventional entry path",
      });
    }
  }

  // Dedupe test hints by command
  const seenCmds = new Set<string>();
  const uniqueHints = testHints.filter((h) => {
    if (seenCmds.has(h.command)) return false;
    seenCmds.add(h.command);
    return true;
  });

  const tree: IntakeTreeNode[] = [
    ...dirs
      .filter((d) => !d.includes("/"))
      .slice(0, 40)
      .map((p) => ({ path: p, type: "dir" as const })),
    ...files
      .filter((f) => !f.includes("/"))
      .slice(0, 40)
      .map((p) => ({ path: p, type: "file" as const })),
  ];

  const git = await detectGit(root);
  const map: IntakeMap = {
    root,
    scannedAt: new Date().toISOString(),
    languages,
    entrypoints: entrypoints.slice(0, 24),
    configFiles: configFiles.slice(0, 40),
    testHints: uniqueHints.slice(0, 16),
    packageManagers: [...packageManagers].sort(),
    tree,
    git,
    issuePrompt: "",
    stats: { filesScanned: files.length, truncated },
  };
  map.issuePrompt = buildIssuePrompt(map);
  return map;
}

export async function intakeTool(
  ctx: ToolContext,
  args: { path?: string } = {},
): Promise<ToolResult> {
  const started = Date.now();
  const target = args.path ?? ".";
  const abs = args.path
    ? resolveInWorkspace(ctx.workspaceRoot, args.path)
    : ctx.workspaceRoot;

  // If path is a file, scan its directory; if dir, scan it.
  let scanRoot = abs;
  try {
    const st = await stat(abs);
    if (st.isFile()) scanRoot = path.dirname(abs);
  } catch {
    scanRoot = ctx.workspaceRoot;
  }

  await emitToolEvent(ctx, "tool_call", "repo_intake", {
    target,
    input: args,
  });

  try {
    const map = await scanIntakeMap(scanRoot);
    const out = {
      ok: true,
      tool: "repo_intake",
      map,
      durationMs: Date.now() - started,
    };
    await emitToolEvent(ctx, "tool_result", "repo_intake", {
      target,
      ok: true,
      durationMs: out.durationMs,
      output: {
        languages: map.languages.map((l) => l.id),
        entrypoints: map.entrypoints.length,
        testHints: map.testHints.length,
      },
    });
    // Also a structured intake event for plan nodes / reviewers.
    await ctx.trace?.append("info", {
      message: "intake_map",
      intake: {
        languages: map.languages,
        entrypoints: map.entrypoints,
        testHints: map.testHints,
        issuePrompt: map.issuePrompt,
        configFiles: map.configFiles,
        packageManagers: map.packageManagers,
        git: map.git,
      },
    });
    return out;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const out = {
      ok: false,
      tool: "repo_intake",
      error: reason,
      durationMs: Date.now() - started,
    };
    await emitToolEvent(ctx, "tool_result", "repo_intake", {
      target,
      ok: false,
      durationMs: out.durationMs,
      detail: reason,
    });
    return out;
  }
}
