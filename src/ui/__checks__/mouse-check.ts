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

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall mouse checks passed");
