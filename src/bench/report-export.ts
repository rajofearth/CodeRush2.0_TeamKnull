/**
 * bench/report-export — automated PDF + DOCX from a BenchReport.
 *
 * Layout, section order, score tables, and bar charts are fixed templates.
 * LLM analysis text is filled into those slots.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import PDFDocument from "pdfkit";
import type { BenchReport } from "./report.js";
import {
  computeReportFigures,
  type ReportComposite,
  type ReportHarnessMetrics,
} from "./report-figures.js";

export type ReportExportPaths = {
  pdf: string;
  docx: string;
};

const MARGIN = 54; // 0.75"
const PAGE_WIDTH = 612;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const HARNESS_COLOR: Record<string, string> = {
  clai: "#2F6FED",
  pi: "#0F8A8A",
  codex: "#8B5CF6",
};

function fmtPct(rate: number): string {
  return `${Math.round((rate || 0) * 100)}%`;
}

function fmtMs(ms: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(4)}`;
}

function fmtTok(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

/** Horizontal grouped averages chart (time / tokens / cost) — same idea as the dashboard. */
function drawAveragesChart(
  doc: PDFKit.PDFDocument,
  metrics: ReportHarnessMetrics[],
  x: number,
  y: number,
  w: number,
): number {
  if (!metrics.length) return y;
  const groups: Array<{
    label: string;
    values: Array<number | null>;
    fmt: (v: number | null) => string;
  }> = [
    {
      label: "avg time",
      values: metrics.map((m) => (m.avgWallMs > 0 ? m.avgWallMs / 1000 : null)),
      fmt: (v) => (v == null ? "—" : `${v.toFixed(1)}s`),
    },
    {
      label: "avg tokens",
      values: metrics.map((m) => m.avgTokens),
      fmt: (v) => fmtTok(v),
    },
    {
      label: "avg cost",
      values: metrics.map((m) => m.avgCost),
      fmt: (v) => fmtUsd(v),
    },
  ];

  // Legend
  let lx = x;
  for (const m of metrics) {
    doc
      .fillColor(HARNESS_COLOR[m.harness] || "#555")
      .font("Helvetica-Bold")
      .fontSize(8)
      .text(m.harness.toUpperCase(), lx, y, { continued: false });
    lx += 48;
  }
  y += 16;

  const barMax = w - 100;
  const rowH = 12 + metrics.length * 12;
  for (const g of groups) {
    if (y > 700) {
      doc.addPage();
      y = MARGIN;
    }
    const positives = g.values.filter((v): v is number => v != null && v > 0);
    const max = Math.max(1e-9, ...positives);
    doc
      .fillColor("#555555")
      .font("Helvetica")
      .fontSize(9)
      .text(g.label, x, y + 2, { width: 70 });
    metrics.forEach((m, i) => {
      const v = g.values[i] ?? null;
      const bw = v != null && v > 0 ? (barMax * v) / max : 0;
      const by = y + i * 12;
      doc
        .rect(x + 78, by, Math.max(bw, 0), 9)
        .fillColor(HARNESS_COLOR[m.harness] || "#555")
        .fill();
      doc
        .fillColor("#333333")
        .font("Helvetica")
        .fontSize(8)
        .text(g.fmt(v), x + 82 + bw, by, { width: 80 });
    });
    y += rowH + 6;
  }
  return y + 4;
}

/** Composite score cards drawn as compact columns. */
function drawCompositeCards(
  doc: PDFKit.PDFDocument,
  metrics: ReportHarnessMetrics[],
  composites: ReportComposite[],
  winner: string | undefined,
  y: number,
): number {
  if (!metrics.length) return y;
  const n = metrics.length;
  const gap = 10;
  const cardW = (CONTENT_WIDTH - gap * (n - 1)) / n;
  let maxBottom = y;

  metrics.forEach((m, i) => {
    const c = composites.find((x) => x.harness === m.harness);
    const x = MARGIN + i * (cardW + gap);
    const isWin = winner === m.harness;
    doc
      .rect(x, y, cardW, 88)
      .strokeColor(isWin ? "#2F9E44" : "#CCCCCC")
      .lineWidth(isWin ? 1.4 : 0.7)
      .stroke();
    doc
      .fillColor(HARNESS_COLOR[m.harness] || "#333")
      .font("Helvetica-Bold")
      .fontSize(8)
      .text(`${m.harness.toUpperCase()} COMPOSITE / 100`, x + 8, y + 8, {
        width: cardW - 16,
      });
    doc
      .fillColor("#111111")
      .font("Helvetica-Bold")
      .fontSize(20)
      .text((c?.total ?? 0).toFixed(1), x + 8, y + 22, { width: cardW - 16 });
    doc
      .fillColor("#444444")
      .font("Helvetica")
      .fontSize(8)
      .text(
        `pass ${m.pass}/${m.n} (${fmtPct(m.passRate)})\n` +
          `avg time ${fmtMs(m.avgWallMs)}\n` +
          `avg tokens ${fmtTok(m.avgTokens)}\n` +
          `avg cost ${fmtUsd(m.avgCost)}`,
        x + 8,
        y + 46,
        { width: cardW - 16, lineGap: 1 },
      );
    maxBottom = Math.max(maxBottom, y + 96);
  });
  return maxBottom;
}

function sectionHeading(doc: PDFKit.PDFDocument, title: string, y: number): number {
  if (y > 700) {
    doc.addPage();
    y = MARGIN;
  }
  doc
    .fillColor("#1a1a1a")
    .font("Helvetica-Bold")
    .fontSize(11)
    .text(title.toUpperCase(), MARGIN, y, { characterSpacing: 0.6 });
  y = doc.y + 4;
  doc
    .moveTo(MARGIN, y)
    .lineTo(MARGIN + CONTENT_WIDTH, y)
    .strokeColor("#DDDDDD")
    .lineWidth(0.8)
    .stroke();
  return y + 10;
}

function bodyParagraph(
  doc: PDFKit.PDFDocument,
  text: string,
  y: number,
  opts?: { italic?: boolean; indent?: boolean },
): number {
  if (y > 720) {
    doc.addPage();
    y = MARGIN;
  }
  doc
    .fillColor("#222222")
    .font(opts?.italic ? "Helvetica-Oblique" : "Helvetica")
    .fontSize(10)
    .text(text || "—", MARGIN + (opts?.indent ? 12 : 0), y, {
      width: CONTENT_WIDTH - (opts?.indent ? 12 : 0),
      align: "left",
      lineGap: 2,
    });
  return doc.y + 8;
}

function bulletList(
  doc: PDFKit.PDFDocument,
  items: string[],
  y: number,
): number {
  for (const item of items) {
    if (y > 720) {
      doc.addPage();
      y = MARGIN;
    }
    doc
      .fillColor("#222222")
      .font("Helvetica")
      .fontSize(10)
      .text(`•  ${item}`, MARGIN + 4, y, {
        width: CONTENT_WIDTH - 4,
        lineGap: 2,
      });
    y = doc.y + 4;
  }
  return y + 4;
}

function scoreTable(
  doc: PDFKit.PDFDocument,
  metrics: ReportHarnessMetrics[],
  composites: ReportComposite[],
  y: number,
): number {
  if (!metrics.length) return y;
  const cols = [
    { label: "Harness", w: 60 },
    { label: "Composite", w: 70 },
    { label: "Pass", w: 50 },
    { label: "Avg wall", w: 70 },
    { label: "Avg tok", w: 70 },
    { label: "Avg cost", w: 70 },
  ];
  const rowH = 18;
  let x = MARGIN;
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#555555");
  for (const c of cols) {
    doc.text(c.label, x, y, { width: c.w });
    x += c.w;
  }
  y += 14;
  doc
    .moveTo(MARGIN, y)
    .lineTo(MARGIN + CONTENT_WIDTH, y)
    .strokeColor("#CCCCCC")
    .stroke();
  y += 4;
  doc.font("Helvetica").fontSize(9).fillColor("#111111");
  for (const m of metrics) {
    if (y > 720) {
      doc.addPage();
      y = MARGIN;
    }
    const comp = composites.find((c) => c.harness === m.harness);
    x = MARGIN;
    const vals = [
      m.harness,
      (comp?.total ?? 0).toFixed(1),
      `${m.pass}/${m.n}`,
      fmtMs(m.avgWallMs),
      fmtTok(m.avgTokens),
      fmtUsd(m.avgCost),
    ];
    vals.forEach((v, i) => {
      doc.text(v, x, y, { width: cols[i]!.w });
      x += cols[i]!.w;
    });
    y += rowH;
  }
  return y + 8;
}

/** Build a print-ready PDF buffer from a finished BenchReport. */
export async function buildReportPdf(report: BenchReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      info: {
        Title: report.analysis.title,
        Author: "CLAI bench",
        Subject: "Harness evaluation report",
        Creator: "clai bench report-export",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const a = report.analysis;
    const ev = report.evidence;
    let y = MARGIN;

    doc
      .fillColor("#2F6FED")
      .font("Helvetica-Bold")
      .fontSize(9)
      .text("CLAI BENCH  ·  RESEARCH REPORT", MARGIN, y);
    y = doc.y + 10;

    doc
      .fillColor("#111111")
      .font("Helvetica-Bold")
      .fontSize(16)
      .text(a.title, MARGIN, y, { width: CONTENT_WIDTH });
    y = doc.y + 8;

    doc
      .fillColor("#666666")
      .font("Helvetica")
      .fontSize(9)
      .text(
        `${report.provider}/${report.model}  ·  ${report.finishedAt}` +
          (ev.source.compareId ? `  ·  ${ev.source.compareId}` : "") +
          (ev.source.runId ? `  ·  ${ev.source.runId}` : ""),
        MARGIN,
        y,
        { width: CONTENT_WIDTH },
      );
    y = doc.y + 14;

    // Models line
    const modelBits = [
      ev.models.clai && `CLAI ${ev.models.clai}`,
      ev.models.pi && `pi ${ev.models.pi}`,
      ev.models.codex && `codex ${ev.models.codex}`,
    ].filter(Boolean);
    if (modelBits.length) {
      doc
        .fillColor("#333333")
        .font("Helvetica-Oblique")
        .fontSize(9)
        .text(modelBits.join("  ·  "), MARGIN, y, { width: CONTENT_WIDTH });
      y = doc.y + 12;
    }

    y = sectionHeading(doc, "Abstract", y);
    y = bodyParagraph(doc, a.abstract, y, { italic: true });

    y = sectionHeading(doc, "Executive summary", y);
    y = bodyParagraph(doc, a.executiveSummary, y);

    const figures = computeReportFigures(ev.charts.series || []);

    y = sectionHeading(doc, "Figures — averages (per task)", y);
    y = drawAveragesChart(
      doc,
      figures.metrics,
      MARGIN,
      y,
      CONTENT_WIDTH,
    );

    y = sectionHeading(doc, "Composite scores", y);
    if (figures.winner) {
      y = bodyParagraph(
        doc,
        `${figures.winner.toUpperCase()} leads on composite (pass + speed + tokens + cost).`,
        y,
        { italic: true },
      );
    }
    y = drawCompositeCards(
      doc,
      figures.metrics,
      figures.composites,
      figures.winner,
      y,
    );

    y = sectionHeading(doc, "Scorecard", y);
    y = scoreTable(doc, figures.metrics, figures.composites, y);

    y = sectionHeading(doc, "Methodology", y);
    y = bodyParagraph(doc, a.methodologyNotes, y);

    y = sectionHeading(doc, "Harness comparison", y);
    y = bodyParagraph(doc, a.harnessComparison, y);

    y = sectionHeading(doc, "Insights", y);
    y = bulletList(doc, a.insights || [], y);

    y = sectionHeading(doc, "Interesting finds", y);
    for (const f of a.interestingFinds || []) {
      if (y > 700) {
        doc.addPage();
        y = MARGIN;
      }
      doc
        .fillColor("#111111")
        .font("Helvetica-Bold")
        .fontSize(10)
        .text(f.title, MARGIN, y, { width: CONTENT_WIDTH });
      y = doc.y + 2;
      y = bodyParagraph(doc, f.detail, y);
      y = bodyParagraph(doc, f.significance, y, { italic: true });
    }

    y = sectionHeading(doc, "Case studies", y);
    for (const c of a.caseStudies || []) {
      if (y > 700) {
        doc.addPage();
        y = MARGIN;
      }
      doc
        .fillColor("#111111")
        .font("Helvetica-Bold")
        .fontSize(10)
        .text(`${c.taskId}  ·  ${c.harness}  ·  ${c.verdict}`, MARGIN, y);
      y = doc.y + 2;
      y = bodyParagraph(doc, c.narrative, y);
    }

    if (ev.digests?.length) {
      y = sectionHeading(doc, "Trajectory digests", y);
      for (const d of ev.digests.slice(0, 8)) {
        if (y > 680) {
          doc.addPage();
          y = MARGIN;
        }
        doc
          .fillColor("#111111")
          .font("Helvetica-Bold")
          .fontSize(9)
          .text(
            `${d.harness}/${d.taskId} · ${d.status}` +
              (d.wallMs ? ` · ${fmtMs(d.wallMs)}` : ""),
            MARGIN,
            y,
          );
        y = doc.y + 2;
        const beats = (d.timeline || [])
          .slice(0, 8)
          .map((b) => b.summary)
          .join(" → ");
        y = bodyParagraph(doc, beats || d.error || "—", y, { indent: true });
      }
    }

    y = sectionHeading(doc, "Limitations", y);
    y = bodyParagraph(doc, a.limitations, y);

    y = sectionHeading(doc, "Conclusion", y);
    y = bodyParagraph(doc, a.conclusion, y);

    y = sectionHeading(doc, "Recommendations", y);
    y = bulletList(doc, a.recommendations || [], y);

    // Footer note
    if (y > 740) {
      doc.addPage();
      y = MARGIN;
    }
    doc
      .fillColor("#999999")
      .font("Helvetica")
      .fontSize(8)
      .text(
        `Generated by CLAI bench · ${report.reportId} · layout automated, narrative from ${report.provider}/${report.model}`,
        MARGIN,
        740,
        { width: CONTENT_WIDTH, align: "center" },
      );

    doc.end();
  });
}

function p(text: string, opts?: { bold?: boolean; italics?: boolean; size?: number; color?: string }): Paragraph {
  return new Paragraph({
    spacing: { after: 120 },
    children: [
      new TextRun({
        text: text || "—",
        bold: opts?.bold,
        italics: opts?.italics,
        size: opts?.size ?? 20, // half-points
        font: "Calibri",
        color: opts?.color ?? "222222",
      }),
    ],
  });
}

function h(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1): Paragraph {
  return new Paragraph({
    heading: level,
    spacing: { before: 240, after: 120 },
    children: [
      new TextRun({
        text,
        bold: true,
        size: level === HeadingLevel.TITLE ? 32 : 24,
        font: "Calibri",
        color: "111111",
      }),
    ],
  });
}

function bullets(items: string[]): Paragraph[] {
  return items.map(
    (item) =>
      new Paragraph({
        spacing: { after: 80 },
        indent: { left: 360 },
        children: [
          new TextRun({
            text: `•  ${item}`,
            size: 20,
            font: "Calibri",
          }),
        ],
      }),
  );
}

function cell(text: string, opts?: { bold?: boolean; width?: number }): TableCell {
  return new TableCell({
    width: { size: opts?.width ?? 1500, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" },
      left: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" },
      right: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" },
    },
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text,
            bold: opts?.bold,
            size: 18,
            font: "Calibri",
          }),
        ],
      }),
    ],
  });
}

/** Build a Word (.docx) buffer from a finished BenchReport. */
export async function buildReportDocx(report: BenchReport): Promise<Buffer> {
  const a = report.analysis;
  const ev = report.evidence;
  const figures = computeReportFigures(ev.charts.series || []);
  const { metrics, composites, winner } = figures;

  const scoreRows = [
    new TableRow({
      children: [
        cell("Harness", { bold: true, width: 1200 }),
        cell("Composite", { bold: true, width: 1200 }),
        cell("Pass", { bold: true, width: 1100 }),
        cell("Avg wall", { bold: true, width: 1400 }),
        cell("Avg tokens", { bold: true, width: 1400 }),
        cell("Avg cost", { bold: true, width: 1400 }),
      ],
    }),
    ...metrics.map((m) => {
      const c = composites.find((x) => x.harness === m.harness);
      return new TableRow({
        children: [
          cell(m.harness, { width: 1200 }),
          cell((c?.total ?? 0).toFixed(1), { width: 1200 }),
          cell(`${m.pass}/${m.n} (${fmtPct(m.passRate)})`, { width: 1100 }),
          cell(fmtMs(m.avgWallMs), { width: 1400 }),
          cell(fmtTok(m.avgTokens), { width: 1400 }),
          cell(fmtUsd(m.avgCost), { width: 1400 }),
        ],
      });
    }),
  ];

  const children: (Paragraph | Table)[] = [
    p("CLAI BENCH  ·  RESEARCH REPORT", { bold: true, size: 18, color: "2F6FED" }),
    h(a.title, HeadingLevel.TITLE),
    p(
      `${report.provider}/${report.model}  ·  ${report.finishedAt}` +
        (ev.source.compareId ? `  ·  ${ev.source.compareId}` : ""),
      { size: 18, color: "666666", italics: true },
    ),
    p(
      [
        ev.models.clai && `CLAI ${ev.models.clai}`,
        ev.models.pi && `pi ${ev.models.pi}`,
        ev.models.codex && `codex ${ev.models.codex}`,
      ]
        .filter(Boolean)
        .join("  ·  "),
      { size: 18, italics: true },
    ),
    h("Abstract", HeadingLevel.HEADING_1),
    p(a.abstract, { italics: true }),
    h("Executive summary", HeadingLevel.HEADING_1),
    p(a.executiveSummary),
    h("Averages (per task)", HeadingLevel.HEADING_1),
    ...metrics.map((m) =>
      p(
        `${m.harness}: time ${fmtMs(m.avgWallMs)} · tokens ${fmtTok(m.avgTokens)} · cost ${fmtUsd(m.avgCost)}`,
      ),
    ),
    h("Composite scores", HeadingLevel.HEADING_1),
    ...(winner
      ? [
          p(
            `${winner.toUpperCase()} leads on composite (pass + speed + tokens + cost).`,
            { italics: true },
          ),
        ]
      : []),
    ...metrics.map((m) => {
      const c = composites.find((x) => x.harness === m.harness);
      return p(
        `${m.harness.toUpperCase()}  ${(c?.total ?? 0).toFixed(1)}/100  ·  pass ${m.pass}/${m.n}  ·  avg ${fmtMs(m.avgWallMs)} / ${fmtTok(m.avgTokens)} tok / ${fmtUsd(m.avgCost)}`,
        { bold: winner === m.harness },
      );
    }),
    h("Scorecard", HeadingLevel.HEADING_1),
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      rows: scoreRows,
    }),
    p(""),
    h("Methodology", HeadingLevel.HEADING_1),
    p(a.methodologyNotes),
    h("Harness comparison", HeadingLevel.HEADING_1),
    p(a.harnessComparison),
    h("Insights", HeadingLevel.HEADING_1),
    ...bullets(a.insights || []),
    h("Interesting finds", HeadingLevel.HEADING_1),
  ];

  for (const f of a.interestingFinds || []) {
    children.push(p(f.title, { bold: true }));
    children.push(p(f.detail));
    children.push(p(f.significance, { italics: true, color: "555555" }));
  }

  children.push(h("Case studies", HeadingLevel.HEADING_1));
  for (const c of a.caseStudies || []) {
    children.push(
      p(`${c.taskId}  ·  ${c.harness}  ·  ${c.verdict}`, { bold: true }),
    );
    children.push(p(c.narrative));
  }

  if (ev.digests?.length) {
    children.push(h("Trajectory digests", HeadingLevel.HEADING_1));
    for (const d of ev.digests.slice(0, 8)) {
      children.push(
        p(
          `${d.harness}/${d.taskId} · ${d.status}` +
            (d.wallMs ? ` · ${fmtMs(d.wallMs)}` : ""),
          { bold: true },
        ),
      );
      const beats = (d.timeline || [])
        .slice(0, 10)
        .map((b) => b.summary)
        .join(" → ");
      children.push(p(beats || d.error || "—", { size: 18, color: "444444" }));
    }
  }

  children.push(h("Limitations", HeadingLevel.HEADING_1));
  children.push(p(a.limitations));
  children.push(h("Conclusion", HeadingLevel.HEADING_1));
  children.push(p(a.conclusion));
  children.push(h("Recommendations", HeadingLevel.HEADING_1));
  children.push(...bullets(a.recommendations || []));
  children.push(
    p(
      `Generated by CLAI bench · ${report.reportId} · layout automated, narrative from ${report.provider}/${report.model}`,
      { size: 16, color: "999999", italics: true },
    ),
  );

  const document = new Document({
    creator: "CLAI bench",
    title: a.title,
    description: "Harness evaluation research report",
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 720,
              bottom: 720,
              left: 720,
              right: 720,
            },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(document);
}

/** Write PDF + DOCX next to the report JSON. */
export async function exportReportDocuments(
  report: BenchReport,
  reportsDir: string,
): Promise<ReportExportPaths> {
  await mkdir(reportsDir, { recursive: true });
  const pdfPath = path.join(reportsDir, `${report.reportId}.pdf`);
  const docxPath = path.join(reportsDir, `${report.reportId}.docx`);

  const [pdfBuf, docxBuf] = await Promise.all([
    buildReportPdf(report),
    buildReportDocx(report),
  ]);

  await Promise.all([
    writeFile(pdfPath, pdfBuf),
    writeFile(docxPath, docxBuf),
  ]);

  return { pdf: pdfPath, docx: docxPath };
}
