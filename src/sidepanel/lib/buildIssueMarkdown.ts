import { t } from "@/i18n";
import {
  POST_MEDIA_SECTION_IDS,
  sectionMdLabelKey,
  type IssueSection,
} from "@/store/settings-ui-store";
import {
  buildStyleDiff,
  type StyleDiffRow,
} from "@/sidepanel/components/StyleChangesTable";
import { segmentsToMarkdown, type StyleDiffSegment } from "./classDiff";
import type { BufferedElement, EditorStyleEdits } from "@/store/editor-store";
import type { NetworkLogSummary, ConsoleLogSummary } from "./buildLogSummary";
import { filterEnvironmentRows, type EnvironmentRow } from "./environmentRows";
import { formatTimestamp } from "./formatTimestamp";
import { renderMarkdown } from "./renderMarkdown";

// mergeStyleElements가 현재 element에서 실제로 읽는 필드만(EditorSelection의 구조적 부분집합).
// PreviewPanel/buildMarkdownContext가 EditorSelection 전체 없이도 호출 가능.
export interface MergeCurrentSelection {
  selector: string;
  tagName: string;
  classList: string[];
  computedStyles: Record<string, string>;
  specifiedStyles: Record<string, string>;
  text: string | null;
}

export interface MarkdownContext {
  os?: string | null;
  browser?: string | null;
  captureMode?: "element" | "screenshot" | "video" | "freeform";
  title: string;
  sections: Record<string, string>;
  sectionConfig: IssueSection[];
  url: string;
  selector: string;
  tagName: string;
  classListBefore: string[];
  classListAfter: string[];
  specifiedStyles: Record<string, string>;
  tokens: { name: string; value: string }[];
  viewport: { width: number; height: number } | null;
  capturedAt: number;
  diffs: StyleDiffRow[];
  environment: EnvironmentRow[];
  networkLogSummary?: NetworkLogSummary;
  consoleLogSummary?: ConsoleLogSummary;
  // 액션 로그(video 전용)는 본문 요약에 캡처 건수만 노출 — net/con과 달리 에러 분류 없음.
  actionLogCaptured?: number;
  // 복수 element 직렬화. 채워지면 element 모드 본문은 이 배열을 반복(단수도 1개짜리).
  styleElements?: StyleElementContext[];
}

// 한 element의 본문 직렬화 컨텍스트. beforeFilename/afterFilename은 머지·dedup 후 최종
// 배열 인덱스로 부여(before-${i}.webp). before/after Image는 CaptureFiles 파생용(본문 무시).
export interface StyleElementContext {
  selector: string;
  tagName: string;
  classListBefore: string[];
  classListAfter: string[];
  specifiedStyles: Record<string, string>;
  diffs: StyleDiffRow[];
  beforeFilename?: string;
  afterFilename?: string;
  beforeImage?: string | null;
  afterImage?: string | null;
}

type ResolvedElement = Omit<StyleElementContext, "beforeFilename" | "afterFilename">;

function bufferedToResolved(b: BufferedElement): ResolvedElement {
  return {
    selector: b.selector,
    tagName: b.tagName,
    classListBefore: b.selectionSnapshot.classList,
    classListAfter: b.styleEdits.classList,
    specifiedStyles: b.selectionSnapshot.specifiedStyles,
    diffs: buildStyleDiff(
      {
        classList: b.selectionSnapshot.classList,
        specifiedStyles: b.selectionSnapshot.specifiedStyles,
        computedStyles: b.selectionSnapshot.computedStyles,
        text: b.selectionSnapshot.text,
      },
      b.styleEdits,
    ),
    beforeImage: b.beforeImage,
    afterImage: b.afterImage,
  };
}

// 버퍼 + 현재 element를 selector dedup(현재 우선) 머지 → 최종 배열 인덱스로 파일명 부여.
// diff 0 항목은 제외(안전장치 — 가드로 현재 element는 항상 diff). 순수 함수.
export function mergeStyleElements(
  buffered: BufferedElement[],
  current: {
    selection: MergeCurrentSelection;
    styleEdits: EditorStyleEdits;
    before: string | null;
    after: string | null;
  } | null,
): StyleElementContext[] {
  const resolved: ResolvedElement[] = buffered
    .map(bufferedToResolved)
    .filter((r) => r.diffs.length > 0);

  let curResolved: ResolvedElement | null = null;
  if (current) {
    const diffs = buildStyleDiff(
      {
        classList: current.selection.classList,
        specifiedStyles: current.selection.specifiedStyles,
        computedStyles: current.selection.computedStyles,
        text: current.selection.text,
      },
      current.styleEdits,
    );
    if (diffs.length > 0) {
      curResolved = {
        selector: current.selection.selector,
        tagName: current.selection.tagName,
        classListBefore: current.selection.classList,
        classListAfter: current.styleEdits.classList,
        specifiedStyles: current.selection.specifiedStyles,
        diffs,
        beforeImage: current.before,
        afterImage: current.after,
      };
    }
  }

  let merged = resolved;
  if (curResolved) {
    merged = resolved.filter((r) => r.selector !== curResolved!.selector);
    merged.push(curResolved);
  }

  return merged.map((m, i) => ({
    ...m,
    beforeFilename: `before-${i}.webp`,
    afterFilename: `after-${i}.webp`,
  }));
}

// 빌더·범용 본문의 단일 진입점: styleElements가 채워졌으면 그대로, 아니면 레거시 단일
// 필드(diffs/selector)에서 1개짜리 배열로 정규화(diff 0이면 빈 배열 — media 폴백 없음).
export function resolveStyleElements(ctx: MarkdownContext): StyleElementContext[] {
  if (ctx.styleElements && ctx.styleElements.length > 0) return ctx.styleElements;
  if (ctx.diffs.length > 0) {
    return [
      {
        selector: ctx.selector,
        tagName: ctx.tagName,
        classListBefore: ctx.classListBefore,
        classListAfter: ctx.classListAfter,
        specifiedStyles: ctx.specifiedStyles,
        diffs: ctx.diffs,
        beforeFilename: "before-0.webp",
        afterFilename: "after-0.webp",
      },
    ];
  }
  return [];
}

// styleElements가 있으면 selector를 쉼표로 나열, 없으면 fallback(단일 selector). 순수 함수 —
// 마크다운 본문과 drafting/preview/detail UI의 DOM 줄이 같은 결과를 내도록 단일 출처.
// wrap은 각 selector를 감싸는 변환(예: 본문 DOM 줄의 인라인 코드). UI 호출은 생략 → 원문 그대로.
export function joinStyleSelectors(
  styleElements: Pick<StyleElementContext, "selector">[] | undefined,
  fallback: string | null | undefined,
  wrap: (selector: string) => string = (s) => s,
): string {
  if (styleElements && styleElements.length > 0) {
    return styleElements.map((e) => wrap(e.selector)).join(", ");
  }
  return fallback ? wrap(fallback) : "";
}

// element 모드 본문의 DOM 환경 줄(selector 쉼표 나열). styleElements 없으면 ctx.selector.
export function styleDomLabel(
  ctx: MarkdownContext,
  wrap?: (selector: string) => string,
): string {
  return joinStyleSelectors(ctx.styleElements, ctx.selector, wrap);
}

// DOM 줄 selector 목록(빈 값 제외) — Notion rich text·ADF code mark처럼 selector를
// 개별 노드로 감싸야 하는 빌더용. joinStyleSelectors와 같은 우선순위(styleElements → ctx.selector).
export function styleSelectorList(ctx: MarkdownContext): string[] {
  if (ctx.styleElements && ctx.styleElements.length > 0) {
    return ctx.styleElements.map((e) => e.selector);
  }
  return ctx.selector ? [ctx.selector] : [];
}

// 마크다운 본문 DOM 줄에서 selector를 인라인 코드로 감싸는 wrap (md 계열 빌더 공용).
export const mdInlineCode = (selector: string): string => `\`${selector}\``;

// 링크 텍스트에 들어가는 사용자 입력(파일명 등)의 구조 문자 이스케이프.
// `]`/`[`가 링크를 조기 종료하거나 깨지 않게(GitHub·GitLab 본문 공용).
export const escapeMdLinkText = (text: string): string =>
  text.replace(/[\\[\]]/g, "\\$&");

function sectionLabel(section: IssueSection): string {
  return section.labelOverride?.trim() || t(sectionMdLabelKey(section.id));
}

function listItems(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function buildIssueMarkdown(ctx: MarkdownContext): string {
  const lines: string[] = [];

  lines.push(buildMetaComment(ctx));
  lines.push("");
  lines.push(`# ${ctx.title}`);
  lines.push("");

  lines.push(`## ${t("md.section.env")}`);
  lines.push("");
  if (ctx.os) {
    lines.push(`- **OS**: ${ctx.os}`);
  }
  if (ctx.browser) {
    lines.push(`- **Browser**: ${ctx.browser}`);
  }
  lines.push(`- **Page**: ${ctx.url}`);
  const domLabel = styleDomLabel(ctx, mdInlineCode);
  if (domLabel) {
    lines.push(`- **DOM**: ${domLabel}`);
  }
  if (ctx.viewport) {
    lines.push(`- **Viewport**: ${ctx.viewport.width}×${ctx.viewport.height}`);
  }
  lines.push(`- **Captured**: ${formatTimestamp(ctx.capturedAt)}`);
  for (const row of filterEnvironmentRows(ctx.environment)) {
    lines.push(`- **${row.label}**: ${row.value}`);
  }
  lines.push("");

  let mediaEmitted = false;
  const emitMedia = () => {
    if (mediaEmitted) return;
    mediaEmitted = true;
    if (ctx.captureMode === "freeform") {
      // no media section
    } else if (ctx.captureMode === "video") {
      lines.push(`## ${t("md.section.media")}`);
      lines.push("");
      lines.push(t("md.videoAttached"));
      lines.push("");
    } else if (ctx.captureMode === "screenshot") {
      lines.push(`## ${t("md.section.media")}`);
      lines.push("");
      lines.push(t("md.imageAttached"));
      lines.push("");
    } else {
      // element 모드: styleElements를 반복(단수도 1개짜리). media 폴백 없음(no-diff 폐지).
      for (const el of resolveStyleElements(ctx)) {
        lines.push(`## ${t("md.section.styleChanges")} (${el.selector})`);
        lines.push("");
        lines.push(`| ${t("md.column.property")} | As is | To be |`);
        lines.push("| --- | --- | --- |");
        for (const d of el.diffs) {
          const asIs = d.asIsSegments ? segmentsToMarkdown(d.asIsSegments) : escapeCell(d.asIs);
          const toBe = d.toBeSegments ? segmentsToMarkdown(d.toBeSegments) : escapeCell(d.toBe);
          lines.push(`| ${escapeCell(d.prop)} | ${asIs} | ${toBe} |`);
        }
        lines.push("");
      }
    }
    emitLogSummaryMd(lines, ctx);
  };

  for (const section of ctx.sectionConfig) {
    if (!section.enabled) continue;
    if (POST_MEDIA_SECTION_IDS.has(section.id)) {
      emitMedia();
    }
    const content = ctx.sections[section.id] ?? "";
    lines.push(`## ${sectionLabel(section)}`);
    lines.push("");
    if (section.renderAs === "orderedList") {
      const items = listItems(content);
      if (items.length === 0) {
        lines.push(t("md.noValue"));
      } else {
        items.forEach((it, idx) => lines.push(`${idx + 1}. ${it}`));
      }
    } else {
      lines.push(content.trim() ? content : t("md.noValue"));
    }
    lines.push("");
  }

  emitMedia();

  lines.push("---");
  lines.push("");
  lines.push(footerMarkdown());
  lines.push("");

  return lines.join("\n");
}

export function buildIssueHtml(ctx: MarkdownContext): string {
  const parts: string[] = [];

  parts.push(buildMetaComment(ctx));
  parts.push(`<h1>${escapeHtml(ctx.title)}</h1>`);

  parts.push(`<h2>${t("md.section.env")}</h2>`);
  parts.push(`<ul>`);
  if (ctx.os) {
    parts.push(`<li><strong>OS</strong>: ${escapeHtml(ctx.os)}</li>`);
  }
  if (ctx.browser) {
    parts.push(`<li><strong>Browser</strong>: ${escapeHtml(ctx.browser)}</li>`);
  }
  parts.push(`<li><strong>Page</strong>: ${escapeHtml(ctx.url)}</li>`);
  const domLabel = styleDomLabel(ctx, (s) => `<code>${escapeHtml(s)}</code>`);
  if (domLabel) {
    parts.push(`<li><strong>DOM</strong>: ${domLabel}</li>`);
  }
  if (ctx.viewport) {
    parts.push(
      `<li><strong>Viewport</strong>: ${ctx.viewport.width}×${ctx.viewport.height}</li>`,
    );
  }
  parts.push(
    `<li><strong>Captured</strong>: ${escapeHtml(formatTimestamp(ctx.capturedAt))}</li>`,
  );
  for (const row of filterEnvironmentRows(ctx.environment)) {
    parts.push(
      `<li><strong>${escapeHtml(row.label)}</strong>: ${escapeHtml(row.value)}</li>`,
    );
  }
  parts.push(`</ul>`);

  let mediaEmitted = false;
  const emitMedia = () => {
    if (mediaEmitted) return;
    mediaEmitted = true;
    if (ctx.captureMode === "freeform") {
      // no media section
    } else if (ctx.captureMode === "video") {
      parts.push(`<h2>${t("md.section.media")}</h2>`);
      parts.push(`<p>${t("md.videoAttached")}</p>`);
    } else if (ctx.captureMode === "screenshot") {
      parts.push(`<h2>${t("md.section.media")}</h2>`);
      parts.push(`<p>${t("md.imageAttached")}</p>`);
    } else {
      for (const el of resolveStyleElements(ctx)) {
        parts.push(`<h2>${t("md.section.styleChanges")} (${escapeHtml(el.selector)})</h2>`);
        parts.push(
          `<table><thead><tr><th>${t("md.column.property")}</th><th>As is</th><th>To be</th></tr></thead><tbody>`,
        );
        for (const d of el.diffs) {
          const asIs = d.asIsSegments ? segmentsToHtmlCell(d.asIsSegments) : escapeHtml(d.asIs);
          const toBe = d.toBeSegments ? segmentsToHtmlCell(d.toBeSegments) : escapeHtml(d.toBe);
          parts.push(
            `<tr><td>${escapeHtml(d.prop)}</td><td>${asIs}</td><td>${toBe}</td></tr>`,
          );
        }
        parts.push(`</tbody></table>`);
      }
    }
    emitLogSummaryHtml(parts, ctx);
  };

  for (const section of ctx.sectionConfig) {
    if (!section.enabled) continue;
    if (POST_MEDIA_SECTION_IDS.has(section.id)) {
      emitMedia();
    }
    const content = ctx.sections[section.id] ?? "";
    parts.push(`<h2>${escapeHtml(sectionLabel(section))}</h2>`);
    if (section.renderAs === "orderedList") {
      const items = listItems(content);
      if (items.length === 0) {
        parts.push(`<p>${escapeHtml(t("md.noValue"))}</p>`);
      } else {
        parts.push(
          `<ol>${items.map((it) => `<li>${escapeHtml(it)}</li>`).join("")}</ol>`,
        );
      }
    } else {
      parts.push(
        content.trim()
          ? renderMarkdown(content)
          : `<p>${escapeHtml(t("md.noValue"))}</p>`,
      );
    }
  }

  emitMedia();

  parts.push("<hr>");
  parts.push(footerHtml());

  return parts.join("\n");
}

function footerMarkdown(): string {
  return `_Reported via [BugShot](https://bug-shot.com)_`;
}

function footerHtml(): string {
  return `<p><em>Reported via <a href="https://bug-shot.com">BugShot</a></em></p>`;
}

function buildMetaComment(ctx: MarkdownContext): string {
  const meta: Record<string, unknown> = {
    version: 1,
    captureMode: ctx.captureMode ?? "element",
    url: ctx.url,
    capturedAt: ctx.capturedAt,
  };
  if (ctx.os) meta.os = ctx.os;
  if (ctx.browser) meta.browser = ctx.browser;
  if (ctx.viewport) meta.viewport = ctx.viewport;
  const envRows = filterEnvironmentRows(ctx.environment);
  if (envRows.length > 0) {
    meta.environment = Object.fromEntries(envRows.map((r) => [r.label, r.value]));
  }
  if (ctx.captureMode !== "freeform") {
    meta.selector = ctx.selector;
    meta.tagName = ctx.tagName;
    meta.classListBefore = ctx.classListBefore;
    meta.classListAfter = ctx.classListAfter;
    meta.specifiedStyles = ctx.specifiedStyles;
    meta.cssChanges = toCssChanges(ctx.diffs);
    meta.tokens = ctx.tokens;
    // 복수 element(multi-element buffer): top-level 단일 필드는 현재 element를 유지하되,
    // 전체 element의 selector·변경사항을 elements 배열로 직렬화(AI가 모든 element를 파악).
    const els = resolveStyleElements(ctx);
    if (els.length > 1) {
      meta.elements = els.map((e) => ({
        selector: e.selector,
        tagName: e.tagName,
        classListBefore: e.classListBefore,
        classListAfter: e.classListAfter,
        specifiedStyles: e.specifiedStyles,
        cssChanges: toCssChanges(e.diffs),
      }));
    }
  }
  return `<!-- bugshot-meta-for-ai\n${JSON.stringify(meta, null, 2)}\n-->`;
}

function toCssChanges(diffs: StyleDiffRow[]): {
  property: string;
  from: string;
  to: string;
}[] {
  return diffs.map((d) => ({ property: d.prop, from: d.asIs, to: d.toBe }));
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

// class 토큰 세그먼트 → HTML 셀(changed 토큰만 <strong>).
function segmentsToHtmlCell(segs: StyleDiffSegment[]): string {
  return segs
    .map((s) => (s.changed ? `<strong>${escapeHtml(s.text)}</strong>` : escapeHtml(s.text)))
    .join(" ");
}

function emitLogSummaryMd(lines: string[], ctx: MarkdownContext): void {
  const { networkLogSummary: net, consoleLogSummary: con, actionLogCaptured: act } = ctx;
  if (!net && !con && !act) return;
  lines.push(`## ${t("logSummary.title")}`);
  lines.push("");
  if (net) {
    lines.push(
      net.errors.length > 0
        ? `- ${t("logSummary.network.line", { n: net.captured, errors: net.errors.length })}`
        : `- ${t("logSummary.network.lineNoError", { n: net.captured })}`,
    );
  }
  if (con) {
    lines.push(
      con.errorCount > 0 || con.warnCount > 0
        ? `- ${t("logSummary.console.line", { n: con.captured, errors: con.errorCount, warns: con.warnCount })}`
        : `- ${t("logSummary.console.lineNoError", { n: con.captured })}`,
    );
  }
  if (act) {
    lines.push(`- ${t("logSummary.action.line", { n: act })}`);
  }
  lines.push("");
  lines.push(`_${t("logSummary.logs.detail", { file: "logs.html" })}_`);
  lines.push("");
}

function emitLogSummaryHtml(parts: string[], ctx: MarkdownContext): void {
  const { networkLogSummary: net, consoleLogSummary: con, actionLogCaptured: act } = ctx;
  if (!net && !con && !act) return;
  parts.push(`<h2>${escapeHtml(t("logSummary.title"))}</h2>`);
  parts.push("<ul>");
  if (net) {
    const line = net.errors.length > 0
      ? t("logSummary.network.line", { n: net.captured, errors: net.errors.length })
      : t("logSummary.network.lineNoError", { n: net.captured });
    parts.push(`<li>${escapeHtml(line)}</li>`);
  }
  if (con) {
    const line = con.errorCount > 0 || con.warnCount > 0
      ? t("logSummary.console.line", { n: con.captured, errors: con.errorCount, warns: con.warnCount })
      : t("logSummary.console.lineNoError", { n: con.captured });
    parts.push(`<li>${escapeHtml(line)}</li>`);
  }
  if (act) {
    parts.push(`<li>${escapeHtml(t("logSummary.action.line", { n: act }))}</li>`);
  }
  parts.push("</ul>");
  parts.push(`<p><em>${escapeHtml(t("logSummary.logs.detail", { file: "logs.html" }))}</em></p>`);
}
