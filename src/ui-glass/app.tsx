/**
 * ui-glass — live ContextManager pipeline pane (sibling of the main CLAI TUI).
 * Reuses src/ui/theme.ts; does not touch UiBus / main ClaiApp.
 */

import React, { useEffect, useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";
import {
  CREDIT,
  WORDMARK,
  faintUsesDim,
  glyph,
  glyphs,
  resolve,
} from "../ui/theme.js";
import {
  emptyStages,
  initialGlassState,
  reduceGlassEvent,
  type GlassState,
  type StageRow,
  type StageRowState,
} from "./model.js";

const FRAME_MS = 1000 / 15; // ~15fps batching

function stageIcon(state: StageRowState, frame: number): string {
  const g = glyphs();
  if (state === "idle") return "○";
  if (state === "working") {
    return g.spinnerFrames[frame % g.spinnerFrames.length] ?? glyph("working");
  }
  if (state === "flagged") return glyph("warn");
  return glyph("pass");
}

function stageColor(state: StageRowState): string | undefined {
  if (state === "idle") return resolve("text.muted");
  if (state === "working") return resolve("state.working");
  if (state === "flagged") return resolve("state.repair");
  return resolve("state.pass");
}

function truncateEllipsis(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  if (max < 2 || one.length <= max) return one;
  return `${one.slice(0, max - 1)}…`;
}

function Tag({ label }: { label: string }) {
  return <Text color={resolve("brand.wordmark")}>[{label}]</Text>;
}

function PromptSynthesisPanel({
  row,
  frame,
  width,
}: {
  row: StageRow;
  frame: number;
  width: number;
}) {
  const color = stageColor(row.state);
  const icon = stageIcon(row.state, frame);
  const muted = resolve("text.muted");
  const primary = resolve("text.primary");
  const rawInput = String(row.detail.rawInput ?? "");
  const sq =
    row.detail.synthesizedQuery &&
    typeof row.detail.synthesizedQuery === "object"
      ? (row.detail.synthesizedQuery as Record<string, unknown>)
      : {};
  const agentRole = String(sq.agentRole ?? "");
  const freeText = String(sq.freeTextQuery ?? "");
  const fragments = Array.isArray(sq.targetFragments)
    ? (sq.targetFragments as string[])
    : [];
  const notes = Array.isArray(row.detail.extractionNotes)
    ? (row.detail.extractionNotes as string[]).slice(0, 3)
    : [];

  const dur =
    row.state === "pass" || row.state === "flagged"
      ? row.durationMs != null
        ? `${row.durationMs}ms`
        : ""
      : row.state === "working"
        ? "…"
        : "";

  // Approximate content width for truncation (icon + label + padding).
  const lineWidth = Math.max(24, width - 4);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Box width={2}>
          <Text color={color}>{icon}</Text>
        </Box>
        <Box width={22}>
          <Text
            color={row.state === "idle" ? muted : primary}
            dimColor={row.state === "idle" ? faintUsesDim() : false}
          >
            prompt_synthesis
          </Text>
        </Box>
        <Box flexGrow={1}>
          <Text color={muted} dimColor={faintUsesDim()}>
            stage 0 · raw → ContextRequest
          </Text>
        </Box>
        <Box width={7} justifyContent="flex-end">
          <Text color={muted} dimColor={faintUsesDim()}>
            {dur}
          </Text>
        </Box>
      </Box>

      {row.state === "idle" ? (
        <Box marginLeft={2}>
          <Text color={muted} dimColor={faintUsesDim()}>
            —
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginLeft={2}>
          <Text color={muted} dimColor={faintUsesDim()}>
            › {truncateEllipsis(rawInput || "…", lineWidth - 2)}
          </Text>
          {(row.state === "pass" ||
            row.state === "flagged" ||
            agentRole ||
            fragments.length > 0 ||
            freeText) && (
            <Box>
              {agentRole ? (
                <>
                  <Tag label={agentRole} />
                  <Text> </Text>
                </>
              ) : null}
              {fragments.map((f) => (
                <React.Fragment key={f}>
                  <Tag label={truncateEllipsis(f, 28)} />
                  <Text> </Text>
                </React.Fragment>
              ))}
              <Text color={primary}>
                {truncateEllipsis(
                  freeText || rawInput,
                  Math.max(
                    12,
                    lineWidth -
                      2 -
                      (agentRole ? agentRole.length + 3 : 0) -
                      fragments.reduce(
                        (n, f) => n + Math.min(f.length, 28) + 3,
                        0,
                      ),
                  ),
                )}
              </Text>
            </Box>
          )}
          {notes.map((note) => (
            <Text key={note} color={muted} dimColor={faintUsesDim()}>
              · {truncateEllipsis(note, lineWidth - 2)}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

function StageRowView({
  row,
  frame,
}: {
  row: StageRow;
  frame: number;
}) {
  const color = stageColor(row.state);
  const icon = stageIcon(row.state, frame);
  const dur =
    row.state === "pass" || row.state === "flagged"
      ? row.durationMs != null
        ? `${row.durationMs}ms`
        : ""
      : row.state === "working"
        ? "…"
        : "";
  const summary =
    row.state === "idle"
      ? "—"
      : row.summary || (row.state === "working" ? "running" : "");

  return (
    <Box>
      <Box width={2}>
        <Text color={color}>{icon}</Text>
      </Box>
      <Box width={22}>
        <Text
          color={
            row.state === "idle" ? resolve("text.muted") : resolve("text.primary")
          }
          dimColor={row.state === "idle" ? faintUsesDim() : false}
        >
          {row.stage}
        </Text>
      </Box>
      <Box flexGrow={1}>
        <Text color={resolve("text.muted")} dimColor={faintUsesDim()}>
          {summary}
        </Text>
      </Box>
      <Box width={7} justifyContent="flex-end">
        <Text color={resolve("text.muted")} dimColor={faintUsesDim()}>
          {dur}
        </Text>
      </Box>
    </Box>
  );
}

function GlassApp({
  getState,
}: {
  getState: () => GlassState;
}) {
  const { exit } = useApp();
  const [snap, setSnap] = useState<GlassState>(getState);
  const [frame, setFrame] = useState(0);
  const [cols, setCols] = useState(() => process.stdout.columns ?? 80);

  useInput((input, key) => {
    if (key.escape || input === "q" || (key.ctrl && input === "c")) {
      exit();
    }
  });

  useEffect(() => {
    const id = setInterval(() => {
      setSnap(getState());
      setFrame((f) => f + 1);
      setCols(process.stdout.columns ?? 80);
    }, FRAME_MS);
    return () => clearInterval(id);
  }, [getState]);

  const border = resolve("border");
  const muted = resolve("text.muted");
  const primary = resolve("text.primary");
  const brand = resolve("brand.wordmark");

  const synthesisRow = snap.stages.find((r) => r.stage === "prompt_synthesis");
  const pipelineRows = snap.stages.filter(
    (r) => r.stage !== "prompt_synthesis",
  );

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      <Box justifyContent="space-between">
        <Text bold color={brand}>
          {WORDMARK}
        </Text>
        <Text color={muted} dimColor={faintUsesDim()}>
          glass · context pipeline
        </Text>
      </Box>

      <Box
        borderStyle="single"
        borderColor={border}
        flexDirection="column"
        paddingX={1}
        marginTop={1}
      >
        <Box marginBottom={0}>
          <Text color={muted} dimColor={faintUsesDim()}>
            {snap.runId
              ? `run ${snap.runId}${snap.runComplete ? " · complete" : ""}`
              : snap.statusMessage}
          </Text>
        </Box>

        <Box
          marginY={0}
          flexDirection="column"
          borderStyle="single"
          borderColor={border}
          paddingX={1}
          marginTop={1}
        >
          <Text color={primary}>current request</Text>
          <Text color={muted} dimColor={faintUsesDim()}>
            {snap.requestId
              ? `id ${snap.requestId}${snap.agentRole ? ` · role ${snap.agentRole}` : ""}`
              : "—"}
          </Text>
          <Text color={primary}>
            {snap.trigger || "waiting for assemble()…"}
          </Text>
        </Box>

        <Box flexDirection="column" marginTop={1}>
          {synthesisRow ? (
            <PromptSynthesisPanel
              row={synthesisRow}
              frame={frame}
              width={cols}
            />
          ) : null}
          {pipelineRows.map((row) => (
            <StageRowView key={row.stage} row={row} frame={frame} />
          ))}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text color={muted} dimColor={faintUsesDim()}>
            session · requests {snap.stats.requestsProcessed} · stale
            invalidations {snap.stats.totalStaleInvalidations} · injection flags{" "}
            {snap.stats.totalInjectionFlags}
          </Text>
        </Box>
      </Box>

      <Box justifyContent="space-between" marginTop={1}>
        <Text color={muted} dimColor={faintUsesDim()}>
          q / esc quit · follow live trace
        </Text>
        <Text color={muted} dimColor={faintUsesDim()}>
          {CREDIT}
        </Text>
      </Box>
    </Box>
  );
}

export type RenderGlassOptions = {
  /** Mutable state holder polled at ~15fps. */
  stateRef: { current: GlassState };
};

export async function renderGlassPane(
  opts: RenderGlassOptions,
): Promise<{ waitUntilExit: () => Promise<void>; unmount: () => void }> {
  const getState = () => opts.stateRef.current;
  const instance = render(
    React.createElement(GlassApp, { getState }),
  );
  return {
    waitUntilExit: () => instance.waitUntilExit(),
    unmount: () => instance.unmount(),
  };
}

export { emptyStages, initialGlassState, reduceGlassEvent };
export type { GlassState };
