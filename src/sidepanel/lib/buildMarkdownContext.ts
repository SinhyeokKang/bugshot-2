import type { IssueSection } from "@/store/settings-ui-store";
import type { StyleDiffRow } from "@/sidepanel/components/StyleChangesTable";
import type { MarkdownContext } from "./buildIssueMarkdown";
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
  // 비-element 캡처 메타 (호출처가 `?? Date.now()` 등 폴백 적용 후 주입)
  viewport?: { width: number; height: number } | null;
  capturedAt?: number;
  // freeform/video 한정 로그 요약
  networkLogSummary?: NetworkLogSummary;
  consoleLogSummary?: ConsoleLogSummary;
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
    };
  }

  return {
    ...base,
    captureMode: args.captureMode,
    selector: "",
    tagName: "",
    classListBefore: [],
    classListAfter: [],
    specifiedStyles: {},
    tokens: [],
    viewport: args.viewport ?? null,
    capturedAt: args.capturedAt ?? 0,
    diffs: [],
    networkLogSummary: args.networkLogSummary,
    consoleLogSummary: args.consoleLogSummary,
  };
}
