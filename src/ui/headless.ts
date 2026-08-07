/**
 * ui/headless — plain-text rendering of the same event stream, for non-TTY
 * stdout or `CLAI_NO_TUI=1`. Keeps CI logs and the Ink pane telling one story.
 */

import type { UiBus, UiEvent } from "./events.js";

export function isTuiEnabled(stream: NodeJS.WriteStream = process.stdout): boolean {
  if (process.env.CLAI_NO_TUI === "1") return false;
  return Boolean(stream.isTTY);
}

function mark(ok: boolean | undefined): string {
  if (ok === true) return "ok";
  if (ok === false) return "fail";
  return "··";
}

export function formatHeadlessEvent(event: UiEvent): string | null {
  switch (event.type) {
    case "user":
      return `> ${event.text}`;
    case "assistant":
      return event.text.trim() ? event.text.trimEnd() : null;
    case "tool_call":
      return `[··] ${event.tool}${event.target ? `  ${event.target}` : ""}`;
    case "tool_result":
      return `[${mark(event.ok)}] ${event.tool ?? "tool"}${
        event.detail ? `  ${event.detail}` : ""
      }${event.durationMs != null ? `  ${event.durationMs}ms` : ""}`;
    case "plan":
    case "todo":
      return [
        `[--] ${event.title ?? event.type}`,
        ...event.steps.map(
          (step) => `       ${step.state ?? "pending"}  ${step.label}`,
        ),
      ].join("\n");
    case "approval":
      return `[${event.decision ?? "gate"}] approval  ${event.tool}: ${event.request}`;
    case "verify":
      return `[${mark(event.ok)}] verify  ${event.label}${
        event.detail ? `  ${event.detail}` : ""
      }`;
    case "status":
      return event.sticky
        ? `[${event.level === "error" ? "fail" : "··"}] ${event.label}${
            event.detail ? `  ${event.detail}` : ""
          }`
        : null;
    default:
      return null;
  }
}

/**
 * Stateful line printer. Plan/todo snapshots are re-emitted on every step
 * transition, so after the first full listing we print only what changed —
 * otherwise the log is mostly repeated checklists.
 */
export function createHeadlessPrinter(
  write: (line: string) => void = (line) => console.log(line),
): (event: UiEvent) => void {
  const planSteps = new Map<string, string[]>();

  return (event) => {
    if (event.type === "plan" || event.type === "todo") {
      const id = event.id ?? event.type;
      const states = event.steps.map((step) => step.state ?? "pending");
      const previous = planSteps.get(id);
      planSteps.set(id, states);

      if (!previous) {
        const line = formatHeadlessEvent(event);
        if (line != null) write(line);
        return;
      }
      event.steps.forEach((step, index) => {
        if (previous[index] !== states[index]) {
          write(`[--] ${event.title ?? event.type}  ${step.label} → ${states[index]}`);
        }
      });
      return;
    }

    const line = formatHeadlessEvent(event);
    if (line != null) write(line);
  };
}

/** Print events as they arrive. Returns an unsubscribe function. */
export function attachHeadless(
  bus: UiBus,
  write: (line: string) => void = (line) => console.log(line),
): () => void {
  return bus.subscribe(createHeadlessPrinter(write));
}
