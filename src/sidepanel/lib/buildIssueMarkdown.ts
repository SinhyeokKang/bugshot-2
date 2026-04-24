import type { StyleDiffRow } from "../components/StyleChangesTable";
import { formatTimestamp } from "./formatTimestamp";

export interface MarkdownContext {
  captureMode?: "element" | "screenshot" | "video";
  title: string;
  body: string;
  expectedResult: string;
  url: string;
  selector: string;
  tagName: string;
  classListBefore: string[];
  classListAfter: string[];
  specifiedStyles: Record<string, string>;
  tokens: { name: string; value: string }[];
  viewport: { width: number; height: number };
  capturedAt: number;
  diffs: StyleDiffRow[];
}

export function buildIssueMarkdown(ctx: MarkdownContext): string {
  const lines: string[] = [];

  lines.push(buildMetaComment(ctx));
  lines.push("");
  lines.push(`# ${ctx.title}`);
  lines.push("");

  lines.push("## 재현 환경");
  lines.push("");
  lines.push(`- **Page**: ${ctx.url}`);
  lines.push(`- **DOM**: ${ctx.selector}`);
  lines.push(`- **Viewport**: ${ctx.viewport.width}×${ctx.viewport.height}`);
  lines.push(`- **Captured**: ${formatTimestamp(ctx.capturedAt)}`);
  lines.push("");

  lines.push("## 발생 현상");
  lines.push("");
  lines.push(ctx.body);
  lines.push("");

  lines.push("## 스타일 변경사항");
  lines.push("");
  if (ctx.diffs.length > 0) {
    lines.push("| 속성 | As is | To be |");
    lines.push("| --- | --- | --- |");
    for (const d of ctx.diffs) {
      lines.push(
        `| ${escapeCell(d.prop)} | ${escapeCell(d.asIs)} | ${escapeCell(d.toBe)} |`,
      );
    }
    lines.push("");
  }

  lines.push("## 기대 결과");
  lines.push("");
  lines.push(ctx.expectedResult);
  lines.push("");

  return lines.join("\n");
}

export function buildIssueHtml(ctx: MarkdownContext): string {
  const parts: string[] = [];

  parts.push(buildMetaComment(ctx));
  parts.push(`<h1>${escapeHtml(ctx.title)}</h1>`);

  parts.push(`<h2>재현 환경</h2>`);
  parts.push(`<ul>`);
  parts.push(`<li><strong>Page</strong>: ${escapeHtml(ctx.url)}</li>`);
  parts.push(`<li><strong>DOM</strong>: ${escapeHtml(ctx.selector)}</li>`);
  parts.push(
    `<li><strong>Viewport</strong>: ${ctx.viewport.width}×${ctx.viewport.height}</li>`,
  );
  parts.push(
    `<li><strong>Captured</strong>: ${escapeHtml(formatTimestamp(ctx.capturedAt))}</li>`,
  );
  parts.push(`</ul>`);

  parts.push(`<h2>발생 현상</h2>`);
  parts.push(paragraphize(ctx.body));

  parts.push(`<h2>스타일 변경사항</h2>`);
  if (ctx.diffs.length > 0) {
    parts.push(
      `<table><thead><tr><th>속성</th><th>As is</th><th>To be</th></tr></thead><tbody>`,
    );
    for (const d of ctx.diffs) {
      parts.push(
        `<tr><td>${escapeHtml(d.prop)}</td><td>${escapeHtml(d.asIs)}</td><td>${escapeHtml(d.toBe)}</td></tr>`,
      );
    }
    parts.push(`</tbody></table>`);
  }

  parts.push(`<h2>기대 결과</h2>`);
  parts.push(paragraphize(ctx.expectedResult));

  return parts.join("\n");
}

function buildMetaComment(ctx: MarkdownContext): string {
  const meta = {
    version: 1,
    url: ctx.url,
    selector: ctx.selector,
    tagName: ctx.tagName,
    viewport: ctx.viewport,
    capturedAt: ctx.capturedAt,
    classListBefore: ctx.classListBefore,
    classListAfter: ctx.classListAfter,
    specifiedStyles: ctx.specifiedStyles,
    cssChanges: ctx.diffs.map((d) => ({
      property: d.prop,
      from: d.asIs,
      to: d.toBe,
    })),
    tokens: ctx.tokens,
  };
  return `<!-- bugshot-meta-for-ai\n${JSON.stringify(meta, null, 2)}\n-->`;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function paragraphize(text: string): string {
  if (!text.trim()) return "<p></p>";
  return text
    .split(/\n\s*\n/)
    .map((p) => {
      const lines = p.split(/\n/).map(escapeHtml).join("<br>");
      return `<p>${lines}</p>`;
    })
    .join("\n");
}

