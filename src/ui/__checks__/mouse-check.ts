/**
 * Quick regression checks for mouse CSI scrubbing / parsing.
 * Run: pnpm exec tsx src/ui/__checks__/mouse-check.ts
 */
import {
  createSgrMouseParser,
  scrubMouseJunk,
  type MouseEvent,
} from "../mouse.js";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL ${msg}`);
  } else {
    console.log(`ok   ${msg}`);
  }
}

// Scrub leaked fragments (what the user saw in the prompt).
assert(
  scrubMouseJunk("hello[<0;54;50M[<0;54;50mworld") === "helloworld",
  "scrub bare SGR fragments",
);
assert(scrubMouseJunk("keep me") === "keep me", "scrub leaves normal text");

// Complete SGR must not leak into rest.
{
  const events: MouseEvent[] = [];
  const parser = createSgrMouseParser((e) => events.push(e));
  const rest = parser.feed(Buffer.from("\x1b[<0;54;50M", "latin1"));
  assert(rest.length === 0, "complete SGR → empty rest");
  assert(events.length === 1 && events[0]!.kind === "press", "press event");
}

// Fragmented SGR must not forward ESC alone.
{
  const events: MouseEvent[] = [];
  const parser = createSgrMouseParser((e) => events.push(e));
  const a = parser.feed(Buffer.from("\x1b[<0;54", "latin1"));
  assert(a.length === 0, "partial SGR held (no ESC leak)");
  const b = parser.feed(Buffer.from(";50Mhi", "latin1"));
  assert(b.toString("latin1") === "hi", "after complete, text passes");
  assert(events.length === 1, "one event after reassembly");
}

// Typing mixed with mouse.
{
  const events: MouseEvent[] = [];
  const parser = createSgrMouseParser((e) => events.push(e));
  const rest = parser.feed(Buffer.from("ab\x1b[<64;10;10Mcd", "latin1"));
  assert(rest.toString("latin1") === "abcd", "typing survives around wheel");
  assert(events[0]?.kind === "wheelUp", "wheel up");
}

// PageUp / PageDown / arrows must forward intact (not swallowed as non-mouse CSI).
{
  const events: MouseEvent[] = [];
  const parser = createSgrMouseParser((e) => events.push(e));
  const rest = parser.feed(Buffer.from("\x1b[5~", "latin1"));
  assert(rest.toString("latin1") === "\x1b[5~", "PageUp CSI forwarded intact");
  assert(events.length === 0, "PageUp produces no mouse events");
}
{
  const events: MouseEvent[] = [];
  const parser = createSgrMouseParser((e) => events.push(e));
  const rest = parser.feed(Buffer.from("\x1b[6~", "latin1"));
  assert(rest.toString("latin1") === "\x1b[6~", "PageDown CSI forwarded intact");
  assert(events.length === 0, "PageDown produces no mouse events");
}
{
  const events: MouseEvent[] = [];
  const parser = createSgrMouseParser((e) => events.push(e));
  const rest = parser.feed(Buffer.from("\x1b[A", "latin1"));
  assert(rest.toString("latin1") === "\x1b[A", "arrow-up CSI forwarded intact");
  assert(events.length === 0, "arrow-up produces no mouse events");
}
{
  const events: MouseEvent[] = [];
  const parser = createSgrMouseParser((e) => events.push(e));
  const rest = parser.feed(Buffer.from("\x1b[<64;10;10M", "latin1"));
  assert(rest.length === 0, "wheel SGR → empty rest");
  assert(events.length === 1 && events[0]!.kind === "wheelUp", "wheel SGR still stripped");
}
{
  const events: MouseEvent[] = [];
  const parser = createSgrMouseParser((e) => events.push(e));
  const rest = parser.feed(Buffer.from("hi\x1b[5~", "latin1"));
  assert(rest.toString("latin1") === "hi\x1b[5~", "text + PageUp forwarded intact");
  assert(events.length === 0, "mixed PageUp produces no mouse events");
}

// PageUp bare fragment must not be scrubbed as mouse junk.
assert(scrubMouseJunk("[5~") === "[5~", "scrub leaves PageUp bare fragment");
assert(scrubMouseJunk("\x1b[5~") === "\x1b[5~", "scrub leaves PageUp CSI");

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall mouse checks passed");
