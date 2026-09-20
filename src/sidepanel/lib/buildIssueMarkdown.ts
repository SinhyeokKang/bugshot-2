import { t, withLocale } from "@/i18n";
import type { LocaleMode } from "@/i18n/locales";
import { escapeTableCell as escapeCell } from "./markdownCell";
import type { IssueSection } from "@/store/settings-ui-store";
import { bodyBlocks } from "./bodyBlocks";
import {
  buildStyleDiff,
  type StyleDiffRow,
} from "@/sidepanel/components/StyleChangesTable";
import { segmentsToMarkdown, type StyleDiffSegment } from "./classDiff";
import { sameElementKey } from "@/lib/element-key";
import type { BufferedElement, EditorStyleEdits } from "@/store/editor-store";
import { networkErrorCount } from "./buildLogSummary";
import type { NetworkLogSummary, ConsoleLogSummary } from "./buildLogSummary";
import { filterEnvironmentRows, type EnvironmentRow } from "./environmentRows";
import { formatTimestamp } from "./formatTimestamp";
import { renderMarkdown } from "./renderMarkdown";
import { escapeHtml } from "@/lib/escape-html";
import { emitMarkdownLogSummary, footerMarkdown, listItems, sectionLabel } from "./issueBodyShared";
import { placeholderSectionImages } from "./resolveInlineImages";

// mergeStyleElements가 현재 element에서 실제로 읽는 필드만(EditorSelection의 구조적 부분집합).
// PreviewPanel/buildMarkdownContext가 EditorSelection 전체 없이도 호출 가능.
export interface MergeCurrentSelection {
  selector: string;
  // 프레임 구분(0=top) — 다른 프레임의 동일 selector와 dedup 충돌 방지. 구버전 폴백 ?? 0.
  frameId?: number;
  tagName: string;
  classList: string[];
  computedStyles: Record<string, string>;
  specifiedStyles: Record<string, string>;
  text: string | null;
}

export interface MarkdownContext {
  // 이미 해석된 값 — "auto"가 여기까지 오지 않는다. required라 생산지 누락을 컴파일러가 잡는다.
  bodyLocale: LocaleMode;
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
  // 클립보드 복사본이면 true. 호출부는 2곳뿐이고(PreviewPanel=복사 / buildReportData=logs.html)
  // 제출 본문은 플랫폼별 빌더가 따로 만든다. 복사본엔 첨부가 없어 "첨부 파일 참조" 문구가
  // 거짓이 되고, 인라인 이미지의 data: URI 하나가 Notion·Slack·Jira의 붙여넣기를 통째로
  // 거부시킨다. optional 유지가 필수 — 부재 = 기존 동작(logs.html 경로 무회귀).
  forClipboard?: boolean;
  // 제출이지만 로그 파일이 동봉되지 않는 경로(webhook json 템플릿 모드). LogSummaryContext와
  // 같은 축이고 여기선 emitMarkdownLogSummary로 그대로 흘러간다.
  logsNotAttached?: boolean;
}

// 한 element의 본문 직렬화 컨텍스트. beforeFilename/afterFilename은 머지·dedup 후 최종
// 배열 인덱스로 부여(before-${i}.webp). before/after Image는 CaptureFiles 파생용(본문 무시).
export interface StyleElementContext {
  selector: string;
  frameId?: number;
  tagName: string;
  classListBefore: string[];
  classListAfter: string[];
  specifiedStyles: Record<string, string>;
  diffs: StyleDiffRow[];
  beforeFilename?: string;
  afterFilename?: string;
  beforeImage?: string | null;
  afterImage?: string | null;
  // diff table 주석본. 여기서 접지 않는다 — 표시 쪽이 "주석이 있는가"를 알아야 [주석 제거]를
  // 낼 수 있다. 접는 지점은 소비처(제출·AI·미리보기)다.
  beforeAnnotated?: string | null;
  afterAnnotated?: string | null;
}

type ResolvedElement = Omit<StyleElementContext, "beforeFilename" | "afterFilename">;

function bufferedToResolved(b: BufferedElement): ResolvedElement {
  return {
    selector: b.selector,
    frameId: b.frameId ?? 0,
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
    beforeAnnotated: b.beforeAnnotated,
    afterAnnotated: b.afterAnnotated,
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
    beforeAnnotated?: string | null;
    afterAnnotated?: string | null;
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
        frameId: current.selection.frameId ?? 0,
        tagName: current.selection.tagName,
        classListBefore: current.selection.classList,
        classListAfter: current.styleEdits.classList,
        specifiedStyles: current.selection.specifiedStyles,
        diffs,
        beforeImage: current.before,
        afterImage: current.after,
        beforeAnnotated: current.beforeAnnotated,
        afterAnnotated: current.afterAnnotated,
      };
    }
  }

  let merged = resolved;
  if (curResolved) {
    merged = resolved.filter((r) => !sameElementKey(r, curResolved!));
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

// 재현 환경 섹션의 행 전체 — 파생 행(OS·Browser·Page·DOM·Viewport·Captured) 뒤에 사용자·
// 자동 커스텀 행. **본문(복사·제출)과 webhook payload의 단일 출처다**: 파생 행을 마크다운
// 안에만 두면 payload.environment는 커스텀 행만 담아, 계약 문서가 약속한 OS·Browser가 수신
// 서버에 영영 안 간다(그 상태로 릴리스됐다). 이름을 environmentRows로 두지 않는 건 같은
// 디렉터리의 environmentRows.ts 모듈과 부딪혀 grep·이동이 어긋나기 때문이다.
// wrap은 DOM 줄 selector 표기 차이만 흡수한다(본문은 인라인 코드).
// 0×0·1970 가드는 logs.html 파생(buildReportData)에 이미 있던 것을 맞춘 것이다 —
// buildEditorCapture가 비-element 폴백으로 viewport {0,0}·capturedAt 0을 만들고, 그 값이
// payload.environment로 나가면 수신 서버가 쓰레기 행을 계약으로 받는다.
// 번역 문자열은 없지만 formatTimestamp가 로케일을 타므로 **스스로 감싼다** — 호출부에 맡기면
// 빌더 밖의 새 소비처(payload 같은)가 잊는 자리가 된다. 이미 감싼 구간 안에서 다시 불려도
// withLocale이 이전 값을 복원하므로 중첩은 무해하다.
export function issueEnvironmentRows(
  ctx: MarkdownContext,
  wrap?: (selector: string) => string,
): EnvironmentRow[] {
  return withLocale(ctx.bodyLocale, () => issueEnvironmentRowsInner(ctx, wrap));
}

function issueEnvironmentRowsInner(
  ctx: MarkdownContext,
  wrap?: (selector: string) => string,
): EnvironmentRow[] {
  const rows: EnvironmentRow[] = [];
  if (ctx.os) rows.push({ label: "OS", value: ctx.os });
  if (ctx.browser) rows.push({ label: "Browser", value: ctx.browser });
  rows.push({ label: "Page", value: ctx.url });
  const domLabel = styleDomLabel(ctx, wrap);
  if (domLabel) rows.push({ label: "DOM", value: domLabel });
  if (ctx.viewport && ctx.viewport.width > 0 && ctx.viewport.height > 0) {
    rows.push({ label: "Viewport", value: `${ctx.viewport.width}×${ctx.viewport.height}` });
  }
  if (ctx.capturedAt) {
    rows.push({ label: "Captured", value: formatTimestamp(ctx.capturedAt) });
  }
  return [...rows, ...filterEnvironmentRows(ctx.environment)];
}

// 래핑은 호출부가 아니라 진입점에 둔다 — 새 어댑터가 감싸는 걸 잊어도 위임 대상이 감싸져 있고,
// 잊을 자리가 생기면 builderLocaleWrap.test.ts가 red로 잡는다.
export function buildIssueMarkdown(ctx: MarkdownContext): string {
  return withLocale(ctx.bodyLocale, () => buildIssueMarkdownInner(forClipboardSections(ctx)));
}

// 인라인 이미지 치환을 진입점(withLocale 안)에서 하는 이유는 **본문 언어 축**이다 — 호출부의
// 훅 기반 번역기로 문구를 만들면 화면 언어가 박혀 bodyLocale과 갈린다. 래퍼 안에서 번역하면
// 본문 언어를 따라간다. 축이 꺼져 있으면 ctx를 그대로 돌려줘 logs.html 경로가 data: 이미지를
// 유지한다(단일 파일이라 그게 유일한 렌더 수단이다).
// 주석에 번역 호출 표기를 쓰지 않는다 — builderLocaleWrap 스캔이 앞 세그먼트의 누출로 읽는다.
function forClipboardSections(ctx: MarkdownContext): MarkdownContext {
  if (!ctx.forClipboard) return ctx;
  return {
    ...ctx,
    sections: placeholderSectionImages(
      ctx.sections,
      ctx.sectionConfig,
      t("md.inlineImageNotCopied"),
    ),
  };
}

function buildIssueMarkdownInner(ctx: MarkdownContext): string {
  const lines: string[] = [];

  lines.push(buildMetaComment(ctx));
  lines.push("");
  lines.push(`# ${ctx.title}`);
  lines.push("");

  lines.push(`## ${t("md.section.env")}`);
  lines.push("");
  for (const row of issueEnvironmentRows(ctx, mdInlineCode)) {
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
      lines.push(ctx.forClipboard ? t("md.videoNotCopied") : t("md.videoAttached"));
      lines.push("");
    } else if (ctx.captureMode === "screenshot") {
      lines.push(`## ${t("md.section.media")}`);
      lines.push("");
      lines.push(ctx.forClipboard ? t("md.imageNotCopied") : t("md.imageAttached"));
      lines.push("");
    } else {
      // element 모드: styleElements를 반복(단수도 1개짜리). media 폴백 없음(no-diff 폐지).
      for (const el of resolveStyleElements(ctx)) {
        lines.push(`## ${t("md.section.styleChanges")} (${el.selector})`);
        lines.push("");
        lines.push(
          `| ${t("md.column.property")} | ${t("styleTable.asIs")} | ${t("styleTable.toBe")} |`,
        );
        lines.push("| --- | --- | --- |");
        for (const d of el.diffs) {
          const asIs = d.asIsSegments ? segmentsToMarkdown(d.asIsSegments) : escapeCell(d.asIs);
          const toBe = d.toBeSegments ? segmentsToMarkdown(d.toBeSegments) : escapeCell(d.toBe);
          lines.push(`| ${escapeCell(d.prop)} | ${asIs} | ${toBe} |`);
        }
        lines.push("");
      }
    }
    emitMarkdownLogSummary(lines, ctx);
  };

  for (const block of bodyBlocks(ctx.sectionConfig)) {
    if (block.kind === "meta") {
      emitMedia();
      continue;
    }
    const section = block.section;
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

  // media 엔트리가 없는 레거시 sectionConfig 방어 — 있으면 이미 emit돼 no-op.
  emitMedia();

  lines.push("---");
  lines.push("");
  lines.push(footerMarkdown());
  lines.push("");

  return lines.join("\n");
}

export function buildIssueHtml(ctx: MarkdownContext): string {
  return withLocale(ctx.bodyLocale, () => buildIssueHtmlInner(forClipboardSections(ctx)));
}

function buildIssueHtmlInner(ctx: MarkdownContext): string {
  const parts: string[] = [];

  parts.push(buildMetaComment(ctx));
  parts.push(`<h1>${escapeHtml(ctx.title)}</h1>`);

  parts.push(`<h2>${t("md.section.env")}</h2>`);
  parts.push(`<ul>`);
  // 마크다운 flavor와 같은 출처 — 복사는 text/plain과 text/html을 **한 번에** 얹으므로
  // 두 벌이면 같은 복사본 안에서 환경 행이 갈린다. DOM 줄만 표기가 다르다(<code>).
  for (const row of issueEnvironmentRows(ctx, (sel) => `<code>${escapeHtml(sel)}</code>`)) {
    // DOM 값은 wrap이 이미 이스케이프했다 — 다시 escapeHtml하면 <code>가 문자로 보인다.
    const value = row.label === "DOM" ? row.value : escapeHtml(row.value);
    parts.push(`<li><strong>${escapeHtml(row.label)}</strong>: ${value}</li>`);
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
      parts.push(`<p>${ctx.forClipboard ? t("md.videoNotCopied") : t("md.videoAttached")}</p>`);
    } else if (ctx.captureMode === "screenshot") {
      parts.push(`<h2>${t("md.section.media")}</h2>`);
      parts.push(`<p>${ctx.forClipboard ? t("md.imageNotCopied") : t("md.imageAttached")}</p>`);
    } else {
      for (const el of resolveStyleElements(ctx)) {
        parts.push(`<h2>${t("md.section.styleChanges")} (${escapeHtml(el.selector)})</h2>`);
        parts.push(
          `<table><thead><tr><th>${t("md.column.property")}</th><th>${t("styleTable.asIs")}</th><th>${t("styleTable.toBe")}</th></tr></thead><tbody>`,
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

  for (const block of bodyBlocks(ctx.sectionConfig)) {
    if (block.kind === "meta") {
      emitMedia();
      continue;
    }
    const section = block.section;
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

  // media 엔트리가 없는 레거시 sectionConfig 방어 — 있으면 이미 emit돼 no-op.
  emitMedia();

  parts.push("<hr>");
  parts.push(footerHtml());

  return parts.join("\n");
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
  // 게이트 2단. ① freeform은 모드 자체로 제외 — 자유 서술이라 직전 element 세션의 잔여
  // selector가 ctx에 남아도 실으면 안 된다(기존 계약). ② 나머지 모드는 **element 데이터가
  // 실제로 있을 때만** — video·screenshot이 빈 selector/cssChanges/tokens를 싣던 것이
  // LLM 프롬프트 잡음이었고 "요소를 골랐는데 셀렉터가 비었다"로 오독된다. 데이터 조건을
  // AND로 얹어 "어느 모드가 style edit을 실을 수 있나"라는 전제를 새로 세우지 않는다.
  const els = resolveStyleElements(ctx);
  if (ctx.captureMode !== "freeform" && (els.length > 0 || ctx.selector)) {
    // top-level 단일 필드는 실제 본문에 emit되는 첫 element(els[0]) 기준 — 현재 요소가
    // no-diff여도 본문은 버퍼 element만 보여주므로, ctx(현재) 고정 시 selector·cssChanges가
    // 본문/DOM 줄과 어긋난다. els 비면 ctx로 폴백.
    const head = els[0];
    meta.selector = head?.selector ?? ctx.selector;
    meta.tagName = head?.tagName ?? ctx.tagName;
    meta.classListBefore = head?.classListBefore ?? ctx.classListBefore;
    meta.classListAfter = head?.classListAfter ?? ctx.classListAfter;
    meta.specifiedStyles = head?.specifiedStyles ?? ctx.specifiedStyles;
    meta.cssChanges = toCssChanges(head?.diffs ?? ctx.diffs);
    if (ctx.tokens.length > 0) meta.tokens = ctx.tokens;
    // 1개 초과면 전체 element의 selector·변경사항을 elements 배열로도 직렬화(AI가 전부 파악).
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

// class 토큰 세그먼트 → HTML 셀(changed 토큰만 <strong>).
function segmentsToHtmlCell(segs: StyleDiffSegment[]): string {
  return segs
    .map((s) => (s.changed ? `<strong>${escapeHtml(s.text)}</strong>` : escapeHtml(s.text)))
    .join(" ");
}

function emitLogSummaryHtml(parts: string[], ctx: MarkdownContext): void {
  const { networkLogSummary: net, consoleLogSummary: con, actionLogCaptured: act } = ctx;
  if (!net && !con && !act) return;
  parts.push(`<h2>${escapeHtml(t("logSummary.title"))}</h2>`);
  parts.push(
    ctx.forClipboard
      ? `<p><strong>${escapeHtml(t("logSummary.logs.notCopied"))}</strong></p>`
      : `<p><strong>${escapeHtml(t("logSummary.logs.lead"))}</strong> ${escapeHtml(t("logSummary.logs.detail", { file: "logs.html" }))}</p>`,
  );
  parts.push("<ul>");
  if (net) {
    const line = networkErrorCount(net) > 0
      ? t("logSummary.network.line", { n: net.captured, errors: networkErrorCount(net) })
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
}
