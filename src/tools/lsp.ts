/**
 * lsp — Eval-oriented language intelligence: definition, references, diagnostics.
 *
 * TS/JS: TypeScript Language Service (no external binary; works on Windows).
 * Python: spawn pyright-langserver / basedpyright when on PATH; stub otherwise.
 * Missing servers return structured stubs (ok:false, stub:true) — never throw hard.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import type { ToolContext, ToolResult } from "./common.js";
import { emitToolEvent, resolveInWorkspace } from "./common.js";

export type LspLocation = {
  path: string;
  line: number;
  character: number;
  endLine?: number;
  endCharacter?: number;
};

export type LspDiagnostic = {
  path: string;
  line: number;
  character: number;
  endLine?: number;
  endCharacter?: number;
  severity: "error" | "warning" | "info" | "hint" | "unknown";
  message: string;
  source?: string;
  code?: string | number;
};

export type LspAvailability = {
  language: string;
  engine: string;
  available: boolean;
  reason?: string;
};

type PositionArgs = {
  path: string;
  line: number;
  character?: number;
};

async function emit(
  ctx: ToolContext,
  phase: "tool_call" | "tool_result",
  toolName: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await emitToolEvent(ctx, phase, toolName, payload);
}

function languageForPath(filePath: string): "typescript" | "python" | "unknown" {
  const ext = path.extname(filePath).toLowerCase();
  if ([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"].includes(ext)) {
    return "typescript";
  }
  if (ext === ".py" || ext === ".pyi") return "python";
  return "unknown";
}

function toOneBased(line: number): number {
  return line < 1 ? 1 : line;
}

function stubResult(
  tool: string,
  reason: string,
  extra: Record<string, unknown> = {},
): ToolResult {
  return {
    ok: false,
    tool,
    stub: true,
    reason,
    ...extra,
  };
}

/* -------------------------------------------------------------------------- */
/* TypeScript Language Service                                                */
/* -------------------------------------------------------------------------- */

type TsModule = typeof import("typescript");

type TsSession = {
  language: "typescript";
  engine: "typescript-ls";
  service: import("typescript").LanguageService;
  hostFiles: Map<string, { version: number; content: string }>;
  root: string;
  ts: TsModule;
};

const tsSessions = new Map<string, TsSession>();

async function loadTypescript(): Promise<TsModule | null> {
  try {
    const require = createRequire(import.meta.url);
    return require("typescript") as TsModule;
  } catch {
    try {
      return (await import("typescript")) as TsModule;
    } catch {
      return null;
    }
  }
}

async function collectTsRoots(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 4 || out.length > 200) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name === "node_modules" || ent.name === ".git" || ent.name === ".clai") continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(abs, depth + 1);
      } else if (/\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/i.test(ent.name)) {
        out.push(abs);
      }
    }
  }
  await walk(root, 0);
  return out;
}

async function getTsSession(root: string): Promise<TsSession | { stub: true; reason: string }> {
  const key = path.resolve(root);
  const existing = tsSessions.get(key);
  if (existing) return existing;

  const ts = await loadTypescript();
  if (!ts) {
    return {
      stub: true,
      reason: "typescript package not available (install typescript for TS/JS LSP)",
    };
  }

  const hostFiles = new Map<string, { version: number; content: string }>();
  const files = await collectTsRoots(key);
  for (const abs of files) {
    try {
      const content = await readFile(abs, "utf8");
      hostFiles.set(normalizeFsPath(abs), { version: 1, content });
    } catch {
      /* skip unreadable */
    }
  }

  const compilerOptions: import("typescript").CompilerOptions = {
    allowJs: true,
    checkJs: false,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    resolveJsonModule: true,
  };

  // Prefer fixture/local tsconfig when present.
  const configPath = ts.findConfigFile(key, ts.sys.fileExists, "tsconfig.json");
  if (configPath) {
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (!read.error) {
      const parsed = ts.parseJsonConfigFileContent(
        read.config,
        ts.sys,
        path.dirname(configPath),
      );
      Object.assign(compilerOptions, parsed.options);
      for (const f of parsed.fileNames) {
        const norm = normalizeFsPath(f);
        if (!hostFiles.has(norm)) {
          try {
            hostFiles.set(norm, {
              version: 1,
              content: await readFile(f, "utf8"),
            });
          } catch {
            /* skip */
          }
        }
      }
    }
  }

  const service = ts.createLanguageService({
    getCompilationSettings: () => compilerOptions,
    getScriptFileNames: () => [...hostFiles.keys()],
    getScriptVersion: (fileName) =>
      String(hostFiles.get(normalizeFsPath(fileName))?.version ?? 0),
    getScriptSnapshot: (fileName) => {
      const entry = hostFiles.get(normalizeFsPath(fileName));
      if (!entry) {
        if (ts.sys.fileExists(fileName)) {
          const text = ts.sys.readFile(fileName) ?? "";
          return ts.ScriptSnapshot.fromString(text);
        }
        return undefined;
      }
      return ts.ScriptSnapshot.fromString(entry.content);
    },
    getCurrentDirectory: () => key,
    getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  });

  const session: TsSession = {
    language: "typescript",
    engine: "typescript-ls",
    service,
    hostFiles,
    root: key,
    ts,
  };
  tsSessions.set(key, session);
  return session;
}

function normalizeFsPath(p: string): string {
  // TypeScript on Windows often uses forward slashes in script names.
  return path.resolve(p).replace(/\\/g, "/");
}

async function refreshTsFile(session: TsSession, abs: string): Promise<void> {
  const norm = normalizeFsPath(abs);
  const content = await readFile(abs, "utf8");
  const prev = session.hostFiles.get(norm);
  session.hostFiles.set(norm, {
    version: (prev?.version ?? 0) + 1,
    content,
  });
}

function mapTsDiagSeverity(
  ts: TsModule,
  category: import("typescript").DiagnosticCategory,
): LspDiagnostic["severity"] {
  if (category === ts.DiagnosticCategory.Error) return "error";
  if (category === ts.DiagnosticCategory.Warning) return "warning";
  if (category === ts.DiagnosticCategory.Suggestion) return "hint";
  if (category === ts.DiagnosticCategory.Message) return "info";
  return "unknown";
}

function tsDiagToLsp(
  session: TsSession,
  d: import("typescript").Diagnostic,
): LspDiagnostic | null {
  if (!d.file || d.start === undefined) return null;
  const start = d.file.getLineAndCharacterOfPosition(d.start);
  const endPos = d.file.getLineAndCharacterOfPosition(d.start + (d.length ?? 0));
  const message = session.ts.flattenDiagnosticMessageText(d.messageText, "\n");
  return {
    path: path.relative(session.root, d.file.fileName),
    line: start.line + 1,
    character: start.character,
    endLine: endPos.line + 1,
    endCharacter: endPos.character,
    severity: mapTsDiagSeverity(session.ts, d.category),
    message,
    source: "typescript",
    code: d.code,
  };
}

function locationFromTs(
  session: TsSession,
  fileName: string,
  pos: number,
): LspLocation {
  const sf = session.service.getProgram()?.getSourceFile(fileName);
  const loc = sf?.getLineAndCharacterOfPosition(pos) ?? { line: 0, character: 0 };
  return {
    path: path.relative(session.root, fileName),
    line: loc.line + 1,
    character: loc.character,
  };
}

async function tsDefinition(
  session: TsSession,
  abs: string,
  line: number,
  character: number,
): Promise<LspLocation[]> {
  await refreshTsFile(session, abs);
  const fileName = normalizeFsPath(abs);
  const sf = session.service.getProgram()?.getSourceFile(fileName);
  if (!sf) return [];
  const pos = sf.getPositionOfLineAndCharacter(
    Math.max(0, line - 1),
    Math.max(0, character),
  );
  const defs =
    session.service.getDefinitionAtPosition(fileName, pos) ??
    session.service.getTypeDefinitionAtPosition(fileName, pos) ??
    [];
  return defs.map((d) => {
    const start = locationFromTs(session, d.fileName, d.textSpan.start);
    const end = locationFromTs(
      session,
      d.fileName,
      d.textSpan.start + d.textSpan.length,
    );
    return {
      ...start,
      endLine: end.line,
      endCharacter: end.character,
    };
  });
}

async function tsReferences(
  session: TsSession,
  abs: string,
  line: number,
  character: number,
): Promise<LspLocation[]> {
  await refreshTsFile(session, abs);
  const fileName = normalizeFsPath(abs);
  const sf = session.service.getProgram()?.getSourceFile(fileName);
  if (!sf) return [];
  const pos = sf.getPositionOfLineAndCharacter(
    Math.max(0, line - 1),
    Math.max(0, character),
  );
  const refs = session.service.findReferences(fileName, pos) ?? [];
  const out: LspLocation[] = [];
  for (const group of refs) {
    for (const ref of group.references) {
      const start = locationFromTs(session, ref.fileName, ref.textSpan.start);
      const end = locationFromTs(
        session,
        ref.fileName,
        ref.textSpan.start + ref.textSpan.length,
      );
      out.push({
        ...start,
        endLine: end.line,
        endCharacter: end.character,
      });
    }
  }
  return out;
}

async function tsDiagnostics(
  session: TsSession,
  abs?: string,
): Promise<LspDiagnostic[]> {
  if (abs) await refreshTsFile(session, abs);
  const files = abs
    ? [normalizeFsPath(abs)]
    : [...session.hostFiles.keys()].filter((f) =>
        f.replace(/\\/g, "/").startsWith(session.root.replace(/\\/g, "/")),
      );

  const out: LspDiagnostic[] = [];
  for (const fileName of files) {
    const syntactic = session.service.getSyntacticDiagnostics(fileName);
    const semantic = session.service.getSemanticDiagnostics(fileName);
    for (const d of [...syntactic, ...semantic]) {
      const mapped = tsDiagToLsp(session, d);
      if (mapped) out.push(mapped);
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Thin JSON-RPC LSP client (Python / optional external servers)              */
/* -------------------------------------------------------------------------- */

type JsonRpcId = number;
type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

class JsonRpcLspClient {
  private proc: ChildProcessWithoutNullStreams;
  private buf = Buffer.alloc(0);
  private nextId = 1;
  private pending = new Map<JsonRpcId, Pending>();
  private diagnostics = new Map<string, LspDiagnostic[]>();
  readonly engine: string;
  readonly root: string;
  alive = true;

  constructor(
    proc: ChildProcessWithoutNullStreams,
    engine: string,
    root: string,
  ) {
    this.proc = proc;
    this.engine = engine;
    this.root = root;
    proc.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    proc.stderr.on("data", () => {
      /* ignore server logs */
    });
    proc.on("exit", () => {
      this.alive = false;
      for (const [, p] of this.pending) {
        p.reject(new Error("LSP server exited"));
      }
      this.pending.clear();
    });
  }

  private onData(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (true) {
      const headerEnd = this.buf.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buf.subarray(0, headerEnd).toString("utf8");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buf = this.buf.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buf.length < bodyStart + length) return;
      const body = this.buf.subarray(bodyStart, bodyStart + length).toString("utf8");
      this.buf = this.buf.subarray(bodyStart + length);
      try {
        this.handleMessage(JSON.parse(body) as Record<string, unknown>);
      } catch {
        /* skip bad frames */
      }
    }
  }

  private handleMessage(msg: Record<string, unknown>): void {
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const id = Number(msg.id);
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (msg.error) {
        pending.reject(
          new Error(
            typeof msg.error === "object" && msg.error && "message" in msg.error
              ? String((msg.error as { message: unknown }).message)
              : "LSP error",
          ),
        );
      } else {
        pending.resolve(msg.result);
      }
      return;
    }
    if (msg.method === "textDocument/publishDiagnostics") {
      const params = msg.params as {
        uri: string;
        diagnostics: Array<{
          range: {
            start: { line: number; character: number };
            end: { line: number; character: number };
          };
          severity?: number;
          message: string;
          source?: string;
          code?: string | number;
        }>;
      };
      const filePath = uriToPath(params.uri);
      const rel = path.relative(this.root, filePath);
      this.diagnostics.set(
        normalizeFsPath(filePath),
        params.diagnostics.map((d) => ({
          path: rel,
          line: d.range.start.line + 1,
          character: d.range.start.character,
          endLine: d.range.end.line + 1,
          endCharacter: d.range.end.character,
          severity: severityFromLsp(d.severity),
          message: d.message,
          source: d.source ?? this.engine,
          code: d.code,
        })),
      );
    }
  }

  sendNotification(method: string, params: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  request(method: string, params: unknown, timeoutMs = 12_000): Promise<unknown> {
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.write(payload);
    });
  }

  private write(msg: unknown): void {
    const body = JSON.stringify(msg);
    const frame = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
    this.proc.stdin.write(frame);
  }

  getDiagnostics(abs?: string): LspDiagnostic[] {
    if (abs) {
      return this.diagnostics.get(normalizeFsPath(abs)) ?? [];
    }
    return [...this.diagnostics.values()].flat();
  }

  async openDocument(abs: string, languageId: string): Promise<void> {
    const text = await readFile(abs, "utf8");
    this.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: pathToUri(abs),
        languageId,
        version: 1,
        text,
      },
    });
  }

  async changeDocument(abs: string, version: number): Promise<void> {
    const text = await readFile(abs, "utf8");
    this.sendNotification("textDocument/didChange", {
      textDocument: { uri: pathToUri(abs), version },
      contentChanges: [{ text }],
    });
  }

  dispose(): void {
    try {
      this.proc.kill();
    } catch {
      /* ignore */
    }
    this.alive = false;
  }
}

function severityFromLsp(n?: number): LspDiagnostic["severity"] {
  if (n === 1) return "error";
  if (n === 2) return "warning";
  if (n === 3) return "info";
  if (n === 4) return "hint";
  return "unknown";
}

function pathToUri(abs: string): string {
  return pathToFileURL(path.resolve(abs)).href;
}

function uriToPath(uri: string): string {
  try {
    return fileURLToPath(uri);
  } catch {
    return uri.replace(/^file:\/\//, "");
  }
}

type PySession = {
  language: "python";
  engine: string;
  client: JsonRpcLspClient;
  versions: Map<string, number>;
};

const pySessions = new Map<string, PySession | { stub: true; reason: string }>();

async function whichCommand(cmd: string): Promise<string | null> {
  const pathEnv = process.env.PATH ?? process.env.Path ?? "";
  const parts = pathEnv.split(path.delimiter).filter(Boolean);
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
      : [""];
  const names =
    process.platform === "win32"
      ? exts.map((ext) =>
          cmd.toLowerCase().endsWith(ext.toLowerCase()) ? cmd : `${cmd}${ext}`,
        )
      : [cmd];

  for (const dir of parts) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        const st = await stat(candidate);
        if (st.isFile()) return candidate;
      } catch {
        /* continue */
      }
    }
  }
  return null;
}

async function resolvePythonLspCommand(): Promise<{
  command: string;
  args: string[];
  engine: string;
} | null> {
  const override = process.env.CLAI_LSP_PY;
  if (override) {
    return { command: override, args: ["--stdio"], engine: "env:CLAI_LSP_PY" };
  }
  for (const candidate of [
    "pyright-langserver",
    "basedpyright-langserver",
    "pyright",
  ]) {
    const found = await whichCommand(candidate);
    if (found) {
      const args =
        candidate === "pyright" ? ["--langserver"] : ["--stdio"];
      // pyright CLI uses --langserver on some versions; prefer langserver binaries.
      if (candidate === "pyright") {
        const ls = await whichCommand("pyright-langserver");
        if (ls) return { command: ls, args: ["--stdio"], engine: "pyright-langserver" };
      }
      return {
        command: found,
        args: candidate === "pyright" ? ["--stdio"] : args,
        engine: candidate,
      };
    }
  }
  return null;
}

async function getPySession(
  root: string,
): Promise<PySession | { stub: true; reason: string }> {
  const key = path.resolve(root);
  const cached = pySessions.get(key);
  if (cached) return cached;

  const cmd = await resolvePythonLspCommand();
  if (!cmd) {
    const stub = {
      stub: true as const,
      reason:
        "Python LSP not found (install pyright / basedpyright, or set CLAI_LSP_PY)",
    };
    pySessions.set(key, stub);
    return stub;
  }

  try {
    const proc = spawn(cmd.command, cmd.args, {
      cwd: key,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env },
    }) as ChildProcessWithoutNullStreams;

    const client = new JsonRpcLspClient(proc, cmd.engine, key);
    await client.request("initialize", {
      processId: process.pid,
      rootUri: pathToUri(key),
      rootPath: key,
      capabilities: {
        textDocument: {
          publishDiagnostics: {},
          definition: { linkSupport: false },
          references: {},
        },
      },
      workspaceFolders: [{ uri: pathToUri(key), name: path.basename(key) }],
    });
    client.sendNotification("initialized", {});

    const session: PySession = {
      language: "python",
      engine: cmd.engine,
      client,
      versions: new Map(),
    };
    pySessions.set(key, session);
    return session;
  } catch (err) {
    const stub = {
      stub: true as const,
      reason: err instanceof Error ? err.message : String(err),
    };
    pySessions.set(key, stub);
    return stub;
  }
}

async function ensurePyDoc(session: PySession, abs: string): Promise<void> {
  const norm = normalizeFsPath(abs);
  const version = (session.versions.get(norm) ?? 0) + 1;
  session.versions.set(norm, version);
  if (version === 1) {
    await session.client.openDocument(abs, "python");
  } else {
    await session.client.changeDocument(abs, version);
  }
  // Give publishDiagnostics a brief window.
  await sleep(250);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function mapLspLocations(
  root: string,
  result: unknown,
): LspLocation[] {
  if (!result) return [];
  const items = Array.isArray(result) ? result : [result];
  const out: LspLocation[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const loc = item as {
      uri?: string;
      targetUri?: string;
      range?: { start: { line: number; character: number }; end: { line: number; character: number } };
      targetRange?: {
        start: { line: number; character: number };
        end: { line: number; character: number };
      };
    };
    const uri = loc.targetUri ?? loc.uri;
    const range = loc.targetRange ?? loc.range;
    if (!uri || !range) continue;
    out.push({
      path: path.relative(root, uriToPath(uri)),
      line: range.start.line + 1,
      character: range.start.character,
      endLine: range.end.line + 1,
      endCharacter: range.end.character,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Public tool API                                                            */
/* -------------------------------------------------------------------------- */

export async function probeLspAvailability(
  workspaceRoot: string,
): Promise<LspAvailability[]> {
  const ts = await getTsSession(workspaceRoot);
  const py = await getPySession(workspaceRoot);
  return [
    {
      language: "typescript",
      engine: "stub" in ts ? "none" : ts.engine,
      available: !("stub" in ts),
      reason: "stub" in ts ? ts.reason : undefined,
    },
    {
      language: "python",
      engine: "stub" in py ? "none" : py.engine,
      available: !("stub" in py),
      reason: "stub" in py ? py.reason : undefined,
    },
  ];
}

export async function lspDefinitionTool(
  ctx: ToolContext,
  args: PositionArgs,
): Promise<ToolResult> {
  const started = Date.now();
  const abs = resolveInWorkspace(ctx.workspaceRoot, args.path);
  const line = toOneBased(args.line);
  const character = args.character ?? 0;
  await emit(ctx, "tool_call", "lsp_definition", {
    target: args.path,
    input: { path: args.path, line, character },
  });

  const lang = languageForPath(abs);
  try {
    if (lang === "typescript") {
      const session = await getTsSession(ctx.workspaceRoot);
      if ("stub" in session) {
        const out = stubResult("lsp_definition", session.reason, {
          path: args.path,
          durationMs: Date.now() - started,
        });
        await emit(ctx, "tool_result", "lsp_definition", {
          target: args.path,
          ok: false,
          durationMs: out.durationMs as number,
          detail: session.reason,
          output: { stub: true },
        });
        return out;
      }
      const locations = await tsDefinition(session, abs, line, character);
      const out = {
        ok: true,
        tool: "lsp_definition",
        engine: session.engine,
        path: args.path,
        line,
        character,
        locations,
        count: locations.length,
        durationMs: Date.now() - started,
      };
      await emit(ctx, "tool_result", "lsp_definition", {
        target: args.path,
        ok: true,
        durationMs: out.durationMs,
        output: { count: locations.length, engine: session.engine },
      });
      return out;
    }

    if (lang === "python") {
      const session = await getPySession(ctx.workspaceRoot);
      if ("stub" in session) {
        const out = stubResult("lsp_definition", session.reason, {
          path: args.path,
          durationMs: Date.now() - started,
        });
        await emit(ctx, "tool_result", "lsp_definition", {
          target: args.path,
          ok: false,
          durationMs: out.durationMs as number,
          detail: session.reason,
          output: { stub: true },
        });
        return out;
      }
      await ensurePyDoc(session, abs);
      const result = await session.client.request("textDocument/definition", {
        textDocument: { uri: pathToUri(abs) },
        position: { line: line - 1, character },
      });
      const locations = mapLspLocations(ctx.workspaceRoot, result);
      const out = {
        ok: true,
        tool: "lsp_definition",
        engine: session.engine,
        path: args.path,
        line,
        character,
        locations,
        count: locations.length,
        durationMs: Date.now() - started,
      };
      await emit(ctx, "tool_result", "lsp_definition", {
        target: args.path,
        ok: true,
        durationMs: out.durationMs,
        output: { count: locations.length, engine: session.engine },
      });
      return out;
    }

    const out = stubResult(
      "lsp_definition",
      `unsupported language for ${path.extname(abs) || "(no ext)"}`,
      { path: args.path, durationMs: Date.now() - started },
    );
    await emit(ctx, "tool_result", "lsp_definition", {
      target: args.path,
      ok: false,
      durationMs: out.durationMs as number,
      detail: String(out.reason),
      output: { stub: true },
    });
    return out;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const out = stubResult("lsp_definition", reason, {
      path: args.path,
      durationMs: Date.now() - started,
    });
    await emit(ctx, "tool_result", "lsp_definition", {
      target: args.path,
      ok: false,
      durationMs: out.durationMs as number,
      detail: reason,
    });
    return out;
  }
}

export async function lspReferencesTool(
  ctx: ToolContext,
  args: PositionArgs,
): Promise<ToolResult> {
  const started = Date.now();
  const abs = resolveInWorkspace(ctx.workspaceRoot, args.path);
  const line = toOneBased(args.line);
  const character = args.character ?? 0;
  await emit(ctx, "tool_call", "lsp_references", {
    target: args.path,
    input: { path: args.path, line, character },
  });

  const lang = languageForPath(abs);
  try {
    if (lang === "typescript") {
      const session = await getTsSession(ctx.workspaceRoot);
      if ("stub" in session) {
        const out = stubResult("lsp_references", session.reason, {
          path: args.path,
          durationMs: Date.now() - started,
        });
        await emit(ctx, "tool_result", "lsp_references", {
          target: args.path,
          ok: false,
          durationMs: out.durationMs as number,
          detail: session.reason,
          output: { stub: true },
        });
        return out;
      }
      const locations = await tsReferences(session, abs, line, character);
      const out = {
        ok: true,
        tool: "lsp_references",
        engine: session.engine,
        path: args.path,
        line,
        character,
        locations,
        count: locations.length,
        durationMs: Date.now() - started,
      };
      await emit(ctx, "tool_result", "lsp_references", {
        target: args.path,
        ok: true,
        durationMs: out.durationMs,
        output: { count: locations.length, engine: session.engine },
      });
      return out;
    }

    if (lang === "python") {
      const session = await getPySession(ctx.workspaceRoot);
      if ("stub" in session) {
        const out = stubResult("lsp_references", session.reason, {
          path: args.path,
          durationMs: Date.now() - started,
        });
        await emit(ctx, "tool_result", "lsp_references", {
          target: args.path,
          ok: false,
          durationMs: out.durationMs as number,
          detail: session.reason,
          output: { stub: true },
        });
        return out;
      }
      await ensurePyDoc(session, abs);
      const result = await session.client.request("textDocument/references", {
        textDocument: { uri: pathToUri(abs) },
        position: { line: line - 1, character },
        context: { includeDeclaration: true },
      });
      const locations = mapLspLocations(ctx.workspaceRoot, result);
      const out = {
        ok: true,
        tool: "lsp_references",
        engine: session.engine,
        path: args.path,
        line,
        character,
        locations,
        count: locations.length,
        durationMs: Date.now() - started,
      };
      await emit(ctx, "tool_result", "lsp_references", {
        target: args.path,
        ok: true,
        durationMs: out.durationMs,
        output: { count: locations.length, engine: session.engine },
      });
      return out;
    }

    const out = stubResult(
      "lsp_references",
      `unsupported language for ${path.extname(abs) || "(no ext)"}`,
      { path: args.path, durationMs: Date.now() - started },
    );
    await emit(ctx, "tool_result", "lsp_references", {
      target: args.path,
      ok: false,
      durationMs: out.durationMs as number,
      detail: String(out.reason),
      output: { stub: true },
    });
    return out;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const out = stubResult("lsp_references", reason, {
      path: args.path,
      durationMs: Date.now() - started,
    });
    await emit(ctx, "tool_result", "lsp_references", {
      target: args.path,
      ok: false,
      durationMs: out.durationMs as number,
      detail: reason,
    });
    return out;
  }
}

export async function lspDiagnosticsTool(
  ctx: ToolContext,
  args: { path?: string } = {},
): Promise<ToolResult> {
  const started = Date.now();
  const target = args.path ?? ".";
  await emit(ctx, "tool_call", "lsp_diagnostics", {
    target,
    input: args,
  });

  try {
    const abs = args.path
      ? resolveInWorkspace(ctx.workspaceRoot, args.path)
      : undefined;
    const lang = abs ? languageForPath(abs) : "typescript";

    // Workspace-wide: prefer TS engine when available; merge Python if path is py.
    if (!abs || lang === "typescript" || lang === "unknown") {
      const session = await getTsSession(ctx.workspaceRoot);
      if (!("stub" in session) && (!abs || lang === "typescript")) {
        const diagnostics = await tsDiagnostics(session, abs);
        const out = {
          ok: true,
          tool: "lsp_diagnostics",
          engine: session.engine,
          path: args.path,
          diagnostics,
          count: diagnostics.length,
          errors: diagnostics.filter((d) => d.severity === "error").length,
          durationMs: Date.now() - started,
        };
        await emit(ctx, "tool_result", "lsp_diagnostics", {
          target,
          ok: true,
          durationMs: out.durationMs,
          output: {
            count: out.count,
            errors: out.errors,
            engine: session.engine,
          },
        });
        return out;
      }
      if (abs && lang === "typescript" && "stub" in session) {
        const out = stubResult("lsp_diagnostics", session.reason, {
          path: args.path,
          durationMs: Date.now() - started,
        });
        await emit(ctx, "tool_result", "lsp_diagnostics", {
          target,
          ok: false,
          durationMs: out.durationMs as number,
          detail: session.reason,
          output: { stub: true },
        });
        return out;
      }
    }

    if (abs && lang === "python") {
      const session = await getPySession(ctx.workspaceRoot);
      if ("stub" in session) {
        const out = stubResult("lsp_diagnostics", session.reason, {
          path: args.path,
          durationMs: Date.now() - started,
        });
        await emit(ctx, "tool_result", "lsp_diagnostics", {
          target,
          ok: false,
          durationMs: out.durationMs as number,
          detail: session.reason,
          output: { stub: true },
        });
        return out;
      }
      await ensurePyDoc(session, abs);
      await sleep(400);
      const diagnostics = session.client.getDiagnostics(abs);
      const out = {
        ok: true,
        tool: "lsp_diagnostics",
        engine: session.engine,
        path: args.path,
        diagnostics,
        count: diagnostics.length,
        errors: diagnostics.filter((d) => d.severity === "error").length,
        durationMs: Date.now() - started,
      };
      await emit(ctx, "tool_result", "lsp_diagnostics", {
        target,
        ok: true,
        durationMs: out.durationMs,
        output: {
          count: out.count,
          errors: out.errors,
          engine: session.engine,
        },
      });
      return out;
    }

    // No path + no TS session → try probe message
    const ts = await getTsSession(ctx.workspaceRoot);
    if ("stub" in ts) {
      const out = stubResult("lsp_diagnostics", ts.reason, {
        durationMs: Date.now() - started,
      });
      await emit(ctx, "tool_result", "lsp_diagnostics", {
        target,
        ok: false,
        durationMs: out.durationMs as number,
        detail: ts.reason,
        output: { stub: true },
      });
      return out;
    }
    const diagnostics = await tsDiagnostics(ts);
    const out = {
      ok: true,
      tool: "lsp_diagnostics",
      engine: ts.engine,
      diagnostics,
      count: diagnostics.length,
      errors: diagnostics.filter((d) => d.severity === "error").length,
      durationMs: Date.now() - started,
    };
    await emit(ctx, "tool_result", "lsp_diagnostics", {
      target,
      ok: true,
      durationMs: out.durationMs,
      output: { count: out.count, errors: out.errors, engine: ts.engine },
    });
    return out;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const out = stubResult("lsp_diagnostics", reason, {
      path: args.path,
      durationMs: Date.now() - started,
    });
    await emit(ctx, "tool_result", "lsp_diagnostics", {
      target,
      ok: false,
      durationMs: out.durationMs as number,
      detail: reason,
    });
    return out;
  }
}

/** Dispose cached LSP sessions (tests / process shutdown). */
export function disposeLspSessions(): void {
  for (const session of pySessions.values()) {
    if (!("stub" in session)) session.client.dispose();
  }
  pySessions.clear();
  for (const session of tsSessions.values()) {
    try {
      session.service.dispose();
    } catch {
      /* ignore */
    }
  }
  tsSessions.clear();
}
