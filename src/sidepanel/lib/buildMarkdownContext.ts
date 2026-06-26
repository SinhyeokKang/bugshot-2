import type { IssueSection } from "@/store/settings-ui-store";
import type { StyleDiffRow } from "@/sidepanel/components/StyleChangesTable";
import type { BufferedElement, EditorStyleEdits } from "@/store/editor-store";
import {
  mergeStyleElements,
  type MarkdownContext,
  type MergeCurrentSelection,
} from "./buildIssueMarkdown";
import type { EnvironmentRow } from "./environmentRows";
import type { NetworkLogSummary, ConsoleLogSummary } from "./buildLogSummary";

export interface MarkdownContextSelection {
  selector: string;
  tagName: string;
  classList: string[];
  specifiedStyles: Record<string, string>;
  viewport: { width: number; height: number };
  capturedAt: number;
}

export interface BuildMarkdownContextArgs {
  captureMode: "element" | "screenshot" | "video" | "freeform";
  title: string;
  resolvedSections: Record<string, string>;
  sectionConfig: IssueSection[];
  os: string | null;
  browser: string | null;
  url: string;
  environment: EnvironmentRow[];
  // element 모드 전용
  selection?: MarkdownContextSelection | null;
  styleEditsClassList?: string[];
  tokens?: { name: string; value: string }[];
  diffs?: StyleDiffRow[];
  // 복수 element 버퍼 + 현재 element 머지 입력(마크다운 복사 등). 채워지면 styleElements 주입.
  bufferedElements?: BufferedElement[];
  mergeCurrent?: { selection: MergeCurrentSelection; styleEdits: EditorStyleEdits };
  // 비-element 캡처 메타 (호출처가 `?? Date.now()` 등 폴백 적용 후 주입)
  viewport?: { width: number; height: number } | null;
  capturedAt?: number;
  // 요소 캡처(screenshot + shotSelector) selector 노출
  selector?: string;
  tagName?: string;
  // freeform/video 한정 로그 요약
  networkLogSummary?: NetworkLogSummary;
  consoleLogSummary?: ConsoleLogSummary;
  // video 한정 액션 로그 캡처 건수 (본문 요약 노출용)
  actionLogCaptured?: number;
}

export function buildMarkdownContext(args: BuildMarkdownContextArgs): MarkdownContext {
  const base = {
    os: args.os,
    browser: args.browser,
    title: args.title,
    sections: args.resolvedSections,
    sectionConfig: args.sectionConfig,
    url: args.url,
    environment: args.environment,
  };

  if (args.captureMode === "element") {
    if (!args.selection) {
      throw new Error("buildMarkdownContext: element capture mode requires selection");
    }
    const { selection } = args;
    const diffs = args.diffs ?? [];
    const changedProps = new Set(diffs.map((d) => d.prop));
    const relevantValues = Object.entries(selection.specifiedStyles)
      .filter(([k]) => changedProps.has(k))
      .map(([, v]) => v);
    const relevantTokens = (args.tokens ?? [])
      .filter((tk) => relevantValues.some((v) => v.includes(tk.name)))
      .map((tk) => ({ name: tk.name, value: tk.value }));

    const styleElements = args.mergeCurrent
      ? mergeStyleElements(args.bufferedElements ?? [], {
          ...args.mergeCurrent,
          before: null,
          after: null,
        })
      : undefined;

    return {
      ...base,
      selector: selection.selector,
      tagName: selection.tagName,
      classListBefore: selection.classList,
      classListAfter: args.styleEditsClassList ?? [],
      specifiedStyles: selection.specifiedStyles,
      tokens: relevantTokens,
      viewport: selection.viewport,
      capturedAt: selection.capturedAt,
      diffs,
      styleElements,
    };
  }

  return {
    ...base,
    captureMode: args.captureMode,
    selector: args.selector ?? "",
    tagName: args.tagName ?? "",
    classListBefore: [],
    classListAfter: [],
    specifiedStyles: {},
    tokens: [],
    viewport: args.viewport ?? null,
    capturedAt: args.capturedAt ?? 0,
    diffs: [],
    networkLogSummary: args.networkLogSummary,
    consoleLogSummary: args.consoleLogSummary,
    actionLogCaptured: args.actionLogCaptured,
  };
}
