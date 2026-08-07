/**
 * ui/mouse — terminal mode + SGR mouse layer, per assets/22-renderer-decision.md.
 *
 * Owns the alternate screen buffer (?1049h/?1049l) and SGR mouse reporting
 * (?1002h?1006h), with teardown guaranteed on exit, SIGINT/SIGTERM, and
 * uncaught exceptions. Mouse bytes are stripped from stdin before Ink's
 * useInput can see them. ConPTY often fragments sequences and sometimes
 * surfaces them as strings — both shapes are handled. `CLAI_MOUSE=0`
 * disables the whole layer.
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
 * Strip leaked mouse CSI junk that already made it into a text field
 * (e.g. `[<0;54;50M` after ESC was eaten). Safe to run on every keystroke.
 */
export function scrubMouseJunk(text: string): string {
  return text
    .replace(/\x1b\[<\d+;\d+;\d+[Mm]/g, "")
    .replace(/\[<\d+;\d+;\d+[Mm]/g, "")
    .replace(/\x1b\[M[\s\S]{0,3}/g, "");
}

/**
 * Buffering parser for SGR (`ESC [ < b ; x ; y M|m`) and X11
 * (`ESC [ M Cb Cx Cy`) mouse reports. `feed` returns the bytes that were NOT
 * mouse reports. Incomplete mouse CSI is held — never forwarded as ESC alone,
 * which is what previously leaked `[<0;54;50M` into the prompt.
 */
export function createSgrMouseParser(
  onEvent: (event: MouseEvent) => void,
): { feed: (chunk: Buffer) => Buffer } {
  let held = Buffer.alloc(0);

  const sgrComplete = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
  // Hold any ESC [ < … that has not yet seen its terminating M/m.
  const sgrHold = /^\x1b\[</;
  // X11: ESC [ M + 3 bytes
  const x11Complete = /^\x1b\[M([\s\S]{3})/;
  const x11Hold = /^\x1b(\[M?)?$/;
  // Generic CSI that is clearly NOT mouse — forward once we see a final byte,
  // but if it starts with ESC [ < treat as mouse-hold forever until M/m/discard.

  function emitSgr(raw: number, x: number, y: number, isRelease: boolean): void {
    const shift = (raw & 4) !== 0;
    const motion = (raw & 32) !== 0;
    const base = raw & ~(4 | 8 | 16);
    let kind: MouseEventKind;
    if ((base & 64) !== 0) {
      kind = (base & 1) !== 0 ? "wheelDown" : "wheelUp";
    } else if (motion) {
      kind = "move";
    } else {
      kind = isRelease ? "release" : "press";
    }
    onEvent({ kind, x, y, button: base & 3, shift });
  }

  return {
    feed(chunk: Buffer): Buffer {
      let data = held.length > 0 ? Buffer.concat([held, chunk]) : chunk;
      held = Buffer.alloc(0);
      const out: Buffer[] = [];
      let pos = 0;

      while (pos < data.length) {
        const escAt = data.indexOf(ESC, pos);
        if (escAt === -1) {
          // Also scrub bare `[<b;x;yM` fragments (ESC already lost upstream).
          const rest = data.subarray(pos);
          const scrubbed = Buffer.from(
            scrubMouseJunk(rest.toString("latin1")),
            "latin1",
          );
          if (scrubbed.length) out.push(scrubbed);
          break;
        }
        if (escAt > pos) {
          const mid = data.subarray(pos, escAt);
          const scrubbed = Buffer.from(
            scrubMouseJunk(mid.toString("latin1")),
            "latin1",
          );
          if (scrubbed.length) out.push(scrubbed);
        }

        const tail = data.subarray(escAt).toString("latin1");

        const sgr = sgrComplete.exec(tail);
        if (sgr) {
          emitSgr(
            Number(sgr[1]),
            Number(sgr[2]) - 1,
            Number(sgr[3]) - 1,
            sgr[4] === "m",
          );
          pos = escAt + sgr[0].length;
          continue;
        }

        const x11 = x11Complete.exec(tail);
        if (x11) {
          // X11 button/coords are encoded as byte = value + 32.
          const cb = x11[1]!.charCodeAt(0) - 32;
          const cx = x11[1]!.charCodeAt(1) - 32 - 1;
          const cy = x11[1]!.charCodeAt(2) - 32 - 1;
          emitSgr(cb, cx, cy, false);
          pos = escAt + 6; // ESC [ M + 3
          continue;
        }

        // Incomplete mouse report — hold, do NOT forward ESC alone.
        if (sgrHold.test(tail) || x11Hold.test(tail) || /^\x1b\[?$/.test(tail)) {
          // Cap hold size so a stuck sequence cannot grow forever; if it looks
          // abandoned (no progress toward M/m and too long), drop it.
          if (tail.length > 64 && !sgrHold.test(tail.slice(0, 4))) {
            pos = escAt + 1;
            continue;
          }
          if (tail.length > 96) {
            // Drop the stuck ESC and keep scanning — never leak it.
            pos = escAt + 1;
            continue;
          }
          held = Buffer.from(data.subarray(escAt));
          break;
        }

        // Some other escape: if it is CSI ending in a letter, skip the whole
        // CSI so we do not drip it into the prompt. Otherwise forward ESC.
        const csi = /^\x1b\[[0-9;?]*([A-Za-z])/.exec(tail);
        if (csi) {
          pos = escAt + csi[0].length;
          continue;
        }
        if (/^\x1b\[[0-9;?]*$/.test(tail)) {
          held = Buffer.from(data.subarray(escAt));
          break;
        }

        // Unknown ESC — drop the ESC byte (safer than leaking into the prompt).
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

  // Button-event tracking + SGR coords. Avoid 1003 (all-motion) — noisy and
  // more likely to fragment under ConPTY.
  stdout.write("\x1b[?1000h\x1b[?1002h\x1b[?1006h");

  // Intercept every data emit (string or Buffer). Never forward ESC alone —
  // that is what previously leaked `[<0;54;50M` into the prompt.
  const originalEmit = stdin.emit.bind(stdin);
  const filteredEmit: typeof stdin.emit = (event: string | symbol, ...args: unknown[]) => {
    if (event === "data") {
      const raw = args[0];
      const buf = typeof raw === "string"
        ? Buffer.from(raw, "latin1")
        : Buffer.isBuffer(raw)
          ? raw
          : Buffer.from(String(raw), "latin1");
      const rest = parser.feed(buf);
      if (rest.length === 0) return true;
      return originalEmit("data", rest);
    }
    return originalEmit(event as string, ...(args as [unknown]));
  };
  (stdin as NodeJS.ReadStream & { emit: typeof stdin.emit }).emit = filteredEmit;

  let done = false;
  const restore = () => {
    if (done) return;
    done = true;
    stdout.write("\x1b[?1006l\x1b[?1002l\x1b[?1000l");
    (stdin as NodeJS.ReadStream & { emit: typeof stdin.emit }).emit = originalEmit;
  };
  const unregister = registerRestore(() => {
    if (!done) stdout.write("\x1b[?1006l\x1b[?1002l\x1b[?1000l");
  });

  return () => {
    unregister();
    restore();
  };
}
