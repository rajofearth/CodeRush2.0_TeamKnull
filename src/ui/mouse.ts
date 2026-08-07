/**
 * ui/mouse — terminal mode + SGR mouse layer, per assets/22-renderer-decision.md.
 *
 * Owns the alternate screen buffer (?1049h/?1049l) and SGR mouse reporting
 * (?1002h?1006h), with teardown guaranteed on exit, SIGINT/SIGTERM, and
 * uncaught exceptions. The stdin filter strips mouse bytes before Ink's
 * useInput can see them, buffering fragmented sequences (ConPTY chops them).
 * Hit testing computes absolute boxes by walking stock Ink's yoga tree —
 * no fork needed. `CLAI_MOUSE=0` disables the whole layer; a terminal that
 * never sends mouse bytes simply never produces events.
 */

import type { DOMElement } from "ink";

// ── guaranteed terminal restore ──────────────────────────────────────────────

type Restorer = () => void;
const restorers = new Set<Restorer>();
let signalsHooked = false;

function runRestorers(): void {
  for (const restore of [...restorers]) {
    restorers.delete(restore);
    try {
      restore();
    } catch {
      // Restoring the terminal must never itself throw.
    }
  }
}

function hookProcessOnce(): void {
  if (signalsHooked) return;
  signalsHooked = true;
  process.on("exit", runRestorers);
  const bail = (code: number) => {
    runRestorers();
    process.exit(code);
  };
  process.on("SIGINT", () => bail(130));
  process.on("SIGTERM", () => bail(143));
  process.on("uncaughtException", (error) => {
    runRestorers();
    console.error(error);
    process.exit(1);
  });
}

/** Register a teardown that must run even on abnormal exit. */
export function registerRestore(restore: Restorer): () => void {
  hookProcessOnce();
  restorers.add(restore);
  return () => {
    restorers.delete(restore);
  };
}

// ── alternate screen buffer ──────────────────────────────────────────────────

/**
 * Switch to the alternate screen buffer; returns a dispose that restores the
 * main buffer. Restore is also registered globally for crash paths.
 */
export function enterAltScreen(stdout: NodeJS.WriteStream): () => void {
  stdout.write("\x1b[?1049h\x1b[H");
  let done = false;
  const restore = () => {
    if (done) return;
    done = true;
    stdout.write("\x1b[?1049l");
  };
  const unregister = registerRestore(restore);
  return () => {
    unregister();
    restore();
  };
}

// ── SGR mouse parsing ────────────────────────────────────────────────────────

export type MouseEventKind = "press" | "release" | "move" | "wheelUp" | "wheelDown";

export type MouseEvent = {
  kind: MouseEventKind;
  /** 0-based terminal column/row. */
  x: number;
  y: number;
  button: number;
  shift: boolean;
};

const ESC = 0x1b;

/**
 * Buffering parser for SGR mouse reports (`ESC [ < b ; x ; y M|m`).
 * `feed(chunk)` returns the bytes that were NOT mouse reports, so the caller
 * can forward them to Ink. Fragments that could still become a mouse report
 * are held until the next chunk decides; anything disproven is flushed.
 */
export function createSgrMouseParser(
  onEvent: (event: MouseEvent) => void,
): { feed: (chunk: Buffer) => Buffer } {
  let held = Buffer.alloc(0);

  // Matches a complete report at the start of the buffer.
  const complete = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
  // Matches a strict prefix of a report (could complete with more bytes).
  const prefix = /^\x1b(\[(<(\d+(;(\d+(;(\d+)?)?)?)?)?)?)?$/;

  return {
    feed(chunk: Buffer): Buffer {
      let data = held.length > 0 ? Buffer.concat([held, chunk]) : chunk;
      held = Buffer.alloc(0);
      const out: Buffer[] = [];
      let pos = 0;

      while (pos < data.length) {
        const escAt = data.indexOf(ESC, pos);
        if (escAt === -1) {
          out.push(data.subarray(pos));
          break;
        }
        if (escAt > pos) out.push(data.subarray(pos, escAt));

        const tail = data.subarray(escAt).toString("latin1");
        const match = complete.exec(tail);
        if (match) {
          const raw = Number(match[1]);
          const x = Number(match[2]) - 1;
          const y = Number(match[3]) - 1;
          const isRelease = match[4] === "m";
          const shift = (raw & 4) !== 0;
          const motion = (raw & 32) !== 0;
          const base = raw & ~(4 | 8 | 16); // strip shift/meta/ctrl modifiers
          let kind: MouseEventKind;
          if ((base & 64) !== 0) {
            kind = (base & 1) !== 0 ? "wheelDown" : "wheelUp";
          } else if (motion) {
            kind = "move";
          } else {
            kind = isRelease ? "release" : "press";
          }
          onEvent({ kind, x, y, button: base & 3, shift });
          pos = escAt + match[0].length;
          continue;
        }
        if (prefix.test(tail)) {
          // Possibly a fragmented mouse report — hold it for the next chunk.
          held = Buffer.from(data.subarray(escAt));
          break;
        }
        // Some other escape sequence: forward the ESC and move on.
        out.push(data.subarray(escAt, escAt + 1));
        pos = escAt + 1;
      }

      return Buffer.concat(out);
    },
  };
}

// ── geometry: yoga-walk absolute boxes ───────────────────────────────────────

export type Box = { x: number; y: number; width: number; height: number };

/**
 * Absolute bounding box of an Ink element, from stock Ink's public
 * `DOMElement`: walk `parentNode` summing `getComputedLeft/Top`.
 */
export function measureAbsolute(node: DOMElement | null | undefined): Box | null {
  if (!node?.yogaNode) return null;
  const width = node.yogaNode.getComputedWidth();
  const height = node.yogaNode.getComputedHeight();
  let x = 0;
  let y = 0;
  let current: DOMElement | undefined = node;
  while (current) {
    const yoga = current.yogaNode;
    if (yoga) {
      x += yoga.getComputedLeft();
      y += yoga.getComputedTop();
    }
    current = current.parentNode;
  }
  return { x, y, width, height };
}

export type HitRegistry = {
  register: (id: string, node: DOMElement | null, onClick: () => void) => void;
  unregister: (id: string) => void;
  /** Smallest registered box containing (x, y), or null. */
  hitTest: (x: number, y: number) => (() => void) | null;
};

export function createHitRegistry(): HitRegistry {
  const targets = new Map<string, { node: DOMElement | null; onClick: () => void }>();
  return {
    register(id, node, onClick) {
      targets.set(id, { node, onClick });
    },
    unregister(id) {
      targets.delete(id);
    },
    hitTest(x, y) {
      let best: { area: number; onClick: () => void } | null = null;
      for (const { node, onClick } of targets.values()) {
        const box = measureAbsolute(node);
        if (!box) continue;
        if (x < box.x || x >= box.x + box.width) continue;
        if (y < box.y || y >= box.y + box.height) continue;
        const area = box.width * box.height;
        if (best == null || area < best.area) best = { area, onClick };
      }
      return best?.onClick ?? null;
    },
  };
}

// ── the armed layer ──────────────────────────────────────────────────────────

export type MouseHandlers = {
  onWheel?: (direction: 1 | -1, x: number, y: number) => void;
  onClick?: (x: number, y: number) => void;
};

export function isMouseEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.CLAI_MOUSE !== "0";
}

/**
 * Arm SGR mouse reporting and filter mouse bytes out of stdin before Ink's
 * useInput sees them. Selection guard: a release that moved since its press
 * (a drag-select) never fires the click handler. Returns a dispose; teardown
 * is also registered on the crash paths.
 */
export function armMouse(options: {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  handlers: MouseHandlers;
}): () => void {
  const { stdin, stdout, handlers } = options;

  let pressAt: { x: number; y: number } | null = null;
  let dragged = false;

  const parser = createSgrMouseParser((event) => {
    switch (event.kind) {
      case "wheelUp":
        handlers.onWheel?.(-1, event.x, event.y);
        break;
      case "wheelDown":
        handlers.onWheel?.(1, event.x, event.y);
        break;
      case "press":
        pressAt = { x: event.x, y: event.y };
        dragged = false;
        break;
      case "move":
        if (pressAt && (event.x !== pressAt.x || event.y !== pressAt.y)) {
          dragged = true;
        }
        break;
      case "release": {
        const moved =
          dragged || (pressAt != null && (event.x !== pressAt.x || event.y !== pressAt.y));
        if (pressAt != null && !moved && event.button === 0) {
          handlers.onClick?.(event.x, event.y);
        }
        pressAt = null;
        dragged = false;
        break;
      }
    }
  });

  stdout.write("\x1b[?1002h\x1b[?1006h");

  const originalEmit = stdin.emit.bind(stdin);
  const filteredEmit: typeof stdin.emit = (event: string | symbol, ...args: unknown[]) => {
    if (event === "data") {
      const raw = args[0];
      const wasString = typeof raw === "string";
      const buf = wasString ? Buffer.from(raw as string, "utf8") : (raw as Buffer);
      const rest = parser.feed(buf);
      if (rest.length === 0) return true;
      return originalEmit("data", wasString ? rest.toString("utf8") : rest);
    }
    return originalEmit(event as string, ...(args as [unknown]));
  };
  // eslint-disable-next-line no-param-reassign
  (stdin as NodeJS.ReadStream & { emit: typeof stdin.emit }).emit = filteredEmit;

  let done = false;
  const restore = () => {
    if (done) return;
    done = true;
    stdout.write("\x1b[?1002l\x1b[?1006l");
    (stdin as NodeJS.ReadStream & { emit: typeof stdin.emit }).emit = originalEmit;
  };
  const unregister = registerRestore(() => {
    // On crash paths only the terminal mode matters; skip the emit swap.
    if (!done) stdout.write("\x1b[?1002l\x1b[?1006l");
  });

  return () => {
    unregister();
    restore();
  };
}
