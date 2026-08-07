/**
 * ui/session-log — append-only JSONL logger for the UiBus.
 *
 * Used by the Ink TUI so every event is persisted under the run trace dir
 * without touching stdout (Ink owns the alternate screen). Headless / chat
 * modes keep using attachLogPrinter / attachHeadless on stdout.
 */

import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { UiBus, UiEvent } from "./events.js";
import { formatHeadlessEvent } from "./headless.js";

export type SessionLogHandle = {
  path: string;
  close: () => Promise<void>;
  unsubscribe: () => void;
};

function lineFor(event: UiEvent): string {
  const pretty = formatHeadlessEvent(event);
  return JSON.stringify({
    ts: new Date().toISOString(),
    type: event.type,
    pretty: pretty ?? undefined,
    event,
  });
}

/**
 * Subscribe the bus to an append-only JSONL file. Creates parent dirs.
 * Returns a handle; call `close()` on session end.
 */
export async function attachSessionLog(
  bus: UiBus,
  logPath: string,
): Promise<SessionLogHandle> {
  await mkdir(path.dirname(logPath), { recursive: true });
  const stream: WriteStream = createWriteStream(logPath, { flags: "a" });

  const write = (event: UiEvent) => {
    if (!stream.writable) return;
    stream.write(`${lineFor(event)}\n`);
  };

  // Replay anything buffered before subscribers attached.
  for (const event of bus.buffered()) write(event);
  const unsubscribe = bus.subscribe(write);

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    await new Promise<void>((resolve) => {
      stream.end(() => resolve());
    });
  };

  return { path: logPath, close, unsubscribe };
}
