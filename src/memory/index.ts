import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export type MemoryTier =
  | "task" | "convention" | "evidence" | "preference"
  | "episodic" | "procedure" | "working";
export type TtlClass = "session" | "task" | "durable" | "permanent";

export interface MemoryItem {
  id: string;
  tier: MemoryTier;
  content: unknown;
  citePath?: string;
  citeStart?: number;
  citeEnd?: number;
  citeHash?: string;
  createdAt: number;
  createdBy: string;
  source: string;
  confidence: number;
  ttlClass: TtlClass;
  invalidatedAt?: number;
  invalidatedBy?: string;
  supersededBy?: string;
}

export type NewMemoryItem = Omit<MemoryItem, "id" | "createdAt">;
export interface MemoryQuery {
  tiers?: MemoryTier[];
  citePath?: string;
  includeInvalidated?: boolean;
  limit?: number;
}
export interface MemoryStore {
  readonly backend: "sqlite" | "json";
  readonly location: string;
  write(item: NewMemoryItem): MemoryItem;
  get(id: string): MemoryItem | undefined;
  query(opts?: MemoryQuery): MemoryItem[];
  invalidate(id: string, reason: string): void;
  supersede(oldId: string, newId: string): void;
  delete(id: string): boolean;
  close(): void;
}

const REAL_TIERS = new Set<MemoryTier>(["task", "convention", "evidence", "preference"]);
const ALL_TIERS: MemoryTier[] = ["task", "convention", "evidence", "preference", "episodic", "procedure", "working"];

export function assertWritableTier(tier: MemoryTier): void {
  if (!REAL_TIERS.has(tier)) {
    throw new Error(`Tier '${tier}' is reserved; working memory belongs in session JSONL.`);
  }
}

export function hashFile(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function defaultTtl(tier: MemoryTier): TtlClass {
  return tier === "task" ? "task" : tier === "convention" ? "durable" : "permanent";
}

function normalized(item: NewMemoryItem): MemoryItem {
  assertWritableTier(item.tier);
  return { ...item, id: randomUUID(), createdAt: Date.now() };
}

class JsonMemoryStore implements MemoryStore {
  readonly backend = "json" as const;
  constructor(readonly location: string) {
    mkdirSync(path.dirname(location), { recursive: true });
  }
  private load(): MemoryItem[] {
    try {
      const value = JSON.parse(readFileSync(this.location, "utf8")) as unknown;
      if (!Array.isArray(value)) throw new Error("root must be an array");
      return value as MemoryItem[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error(`Cannot read memory fallback ${this.location}: ${(error as Error).message}`);
    }
  }
  private save(items: MemoryItem[]): void {
    const temp = `${this.location}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(items, null, 2)}\n`);
    renameSync(temp, this.location);
  }
  write(input: NewMemoryItem): MemoryItem {
    const item = normalized(input);
    const items = this.load();
    items.push(item);
    this.save(items);
    return item;
  }
  get(id: string): MemoryItem | undefined { return this.load().find((item) => item.id === id); }
  query(opts: MemoryQuery = {}): MemoryItem[] {
    let items = this.load().filter((item) =>
      (opts.includeInvalidated || (!item.invalidatedAt && !item.supersededBy))
      && (!opts.tiers?.length || opts.tiers.includes(item.tier))
      && (!opts.citePath || item.citePath === opts.citePath));
    items.sort((a, b) => b.createdAt - a.createdAt);
    if (opts.limit !== undefined) items = items.slice(0, opts.limit);
    return items;
  }
  invalidate(id: string, reason: string): void {
    const items = this.load();
    const item = items.find((entry) => entry.id === id);
    if (!item) throw new Error(`Memory item not found: ${id}`);
    item.invalidatedAt = Date.now();
    item.invalidatedBy = reason;
    this.save(items);
  }
  supersede(oldId: string, newId: string): void {
    const items = this.load();
    const old = items.find((entry) => entry.id === oldId);
    if (!old || !items.some((entry) => entry.id === newId)) throw new Error("Supersede requires two existing items.");
    old.supersededBy = newId;
    old.invalidatedAt = Date.now();
    old.invalidatedBy = "superseded";
    this.save(items);
  }
  delete(id: string): boolean {
    const items = this.load();
    const filtered = items.filter((item) => item.id !== id);
    if (filtered.length === items.length) return false;
    this.save(filtered);
    return true;
  }
  close(): void {}
}

type Database = import("better-sqlite3").Database;
class SqliteMemoryStore implements MemoryStore {
  readonly backend = "sqlite" as const;
  constructor(readonly location: string, private readonly db: Database) {
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_item (
        id TEXT PRIMARY KEY, tier TEXT NOT NULL, content TEXT NOT NULL,
        cite_path TEXT, cite_start INTEGER, cite_end INTEGER, cite_hash TEXT,
        created_at INTEGER NOT NULL, created_by TEXT NOT NULL, source TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 1.0, ttl_class TEXT NOT NULL,
        invalidated_at INTEGER, invalidated_by TEXT, superseded_by TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_memory_tier_active ON memory_item(tier) WHERE invalidated_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_memory_cite ON memory_item(cite_path) WHERE cite_path IS NOT NULL;
    `);
  }
  private decode(row: Record<string, unknown> | undefined): MemoryItem | undefined {
    if (!row) return undefined;
    return {
      id: String(row.id), tier: String(row.tier) as MemoryTier,
      content: JSON.parse(String(row.content)), citePath: row.cite_path == null ? undefined : String(row.cite_path),
      citeStart: row.cite_start == null ? undefined : Number(row.cite_start),
      citeEnd: row.cite_end == null ? undefined : Number(row.cite_end),
      citeHash: row.cite_hash == null ? undefined : String(row.cite_hash),
      createdAt: Number(row.created_at), createdBy: String(row.created_by), source: String(row.source),
      confidence: Number(row.confidence), ttlClass: String(row.ttl_class) as TtlClass,
      invalidatedAt: row.invalidated_at == null ? undefined : Number(row.invalidated_at),
      invalidatedBy: row.invalidated_by == null ? undefined : String(row.invalidated_by),
      supersededBy: row.superseded_by == null ? undefined : String(row.superseded_by),
    };
  }
  write(input: NewMemoryItem): MemoryItem {
    const item = normalized(input);
    this.db.prepare(`INSERT INTO memory_item VALUES
      (@id,@tier,@content,@citePath,@citeStart,@citeEnd,@citeHash,@createdAt,@createdBy,@source,
       @confidence,@ttlClass,@invalidatedAt,@invalidatedBy,@supersededBy)`).run({
      ...item, content: JSON.stringify(item.content), citePath: item.citePath ?? null,
      citeStart: item.citeStart ?? null, citeEnd: item.citeEnd ?? null, citeHash: item.citeHash ?? null,
      invalidatedAt: item.invalidatedAt ?? null, invalidatedBy: item.invalidatedBy ?? null,
      supersededBy: item.supersededBy ?? null,
    });
    return item;
  }
  get(id: string): MemoryItem | undefined {
    return this.decode(this.db.prepare("SELECT * FROM memory_item WHERE id = ?").get(id) as Record<string, unknown> | undefined);
  }
  query(opts: MemoryQuery = {}): MemoryItem[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (!opts.includeInvalidated) where.push("invalidated_at IS NULL AND superseded_by IS NULL");
    if (opts.tiers?.length) {
      where.push(`tier IN (${opts.tiers.map(() => "?").join(",")})`);
      params.push(...opts.tiers);
    }
    if (opts.citePath) { where.push("cite_path = ?"); params.push(opts.citePath); }
    let sql = `SELECT * FROM memory_item${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC`;
    if (opts.limit !== undefined) { sql += " LIMIT ?"; params.push(opts.limit); }
    return (this.db.prepare(sql).all(...params) as Record<string, unknown>[]).map((row) => this.decode(row)!);
  }
  invalidate(id: string, reason: string): void {
    const result = this.db.prepare("UPDATE memory_item SET invalidated_at=?, invalidated_by=? WHERE id=?").run(Date.now(), reason, id);
    if (!result.changes) throw new Error(`Memory item not found: ${id}`);
  }
  supersede(oldId: string, newId: string): void {
    if (!this.get(newId)) throw new Error(`Memory item not found: ${newId}`);
    const result = this.db.prepare("UPDATE memory_item SET superseded_by=?, invalidated_at=?, invalidated_by='superseded' WHERE id=?")
      .run(newId, Date.now(), oldId);
    if (!result.changes) throw new Error(`Memory item not found: ${oldId}`);
  }
  delete(id: string): boolean { return this.db.prepare("DELETE FROM memory_item WHERE id=?").run(id).changes > 0; }
  close(): void { this.db.close(); }
}

export interface OpenMemoryOptions { directory?: string; forceJson?: boolean }
export async function openMemoryStore(options: OpenMemoryOptions = {}): Promise<MemoryStore> {
  const directory = path.resolve(options.directory ?? process.env.CLAI_DATA_DIR ?? ".clai");
  mkdirSync(directory, { recursive: true });
  if (!options.forceJson && process.env.CLAI_MEMORY_BACKEND !== "json") {
    try {
      const module = await import("better-sqlite3");
      return new SqliteMemoryStore(path.join(directory, "memory.sqlite"), new module.default(path.join(directory, "memory.sqlite")));
    } catch {
      // Native optional dependency may be unavailable (notably Windows ARM64).
    }
  }
  return new JsonMemoryStore(path.join(directory, "memory.json"));
}

export const memoryTiers = ALL_TIERS;
