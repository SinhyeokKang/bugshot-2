import { useEditorStore } from "@/store/editor-store";
import { useSettingsUiStore } from "@/store/settings-ui-store";
import { buildStyleDiff } from "@/sidepanel/components/StyleChangesTable";
import { mergeStyleElements, type MarkdownContext } from "@/sidepanel/lib/buildIssueMarkdown";
import { buildNetworkLogSummary, buildConsoleLogSummary } from "@/sidepanel/lib/buildLogSummary";
import { supportsActionLog } from "@/sidepanel/lib/captureLogSupport";
import { deriveContextEnvRows } from "@/sidepanel/lib/buildReportData";
import { parseChromeVersion } from "@/sidepanel/lib/environmentRows";
import { getOsInfo } from "@/sidepanel/lib/osInfo";
import {
  buildCaptureFiles,
  type BuildCaptureFilesInput,
} from "@/sidepanel/lib/buildCaptureFiles";
import { triggerDownload } from "@/sidepanel/lib/downloadCapture";
import { dataUrlToBlob } from "@/store/blob-db";

// 이슈 제출(IssueCreateModal)과 패널 로그 다운로드가 동일한 logs.html을 만들도록 ctx·캡처 입력을
// 단일 출처로 둔다. editor/settings store에서 직접 읽는다(제출 다이얼로그가 쓰던 buildCtx 이관).
export function buildEditorMarkdownContext(): MarkdownContext | null {
  const s = useEditorStore.getState();
  const sectionConfig = useSettingsUiStore.getState().issueSections;
  const {
    captureMode,
    draft,
    target,
    networkLog,
    networkLogAttach,
    consoleLog,
    consoleLogAttach,
    actionLog,
    actionLogAttach,
  } = s;
  if (!draft || !target) return null;

  const os = getOsInfo();
  const browser = parseChromeVersion(navigator.userAgent);
  const hasNetworkLog = networkLogAttach && !!networkLog && networkLog.captured > 0;
  const hasConsoleLog = consoleLogAttach && !!consoleLog && consoleLog.captured > 0;
  // 본문 요약엔 캡처 건수만 노출(엔트리는 logs.html).
  const hasActionLog = supportsActionLog(captureMode) && actionLogAttach && !!actionLog && actionLog.captured > 0;
  // 로그 요약은 console/network 지원 모드(screenshot/video/freeform)에만 붙는다 — element 분기는 제외(원본 buildCtx와 동일).
  const logSummaries = {
    networkLogSummary: hasNetworkLog ? buildNetworkLogSummary(networkLog!) : undefined,
    consoleLogSummary: hasConsoleLog ? buildConsoleLogSummary(consoleLog!) : undefined,
    actionLogCaptured: hasActionLog ? actionLog!.captured : undefined,
  };
  const common = {
    os,
    browser,
    title: draft.title,
    sections: draft.sections,
    sectionConfig,
    url: target.url,
    environment: draft.environment ?? [],
  };

  if (captureMode === "freeform") {
    return {
      ...common,
      ...logSummaries,
      captureMode: "freeform",
      selector: "",
      tagName: "",
      classListBefore: [],
      classListAfter: [],
      specifiedStyles: {},
      tokens: [],
      viewport: s.freeformViewport,
      capturedAt: s.freeformCapturedAt ?? Date.now(),
      diffs: [],
    };
  }
  if (captureMode === "video") {
    return {
      ...common,
      ...logSummaries,
      captureMode: "video",
      selector: "",
      tagName: "",
      classListBefore: [],
      classListAfter: [],
      specifiedStyles: {},
      tokens: [],
      viewport: s.videoViewport ?? { width: 0, height: 0 },
      capturedAt: s.videoCapturedAt ?? Date.now(),
      diffs: [],
    };
  }
  if (captureMode === "screenshot") {
    return {
      ...common,
      ...logSummaries,
      captureMode: "screenshot",
      selector: s.shotSelector?.selector ?? "",
      tagName: s.shotSelector?.tagName ?? "",
      classListBefore: [],
      classListAfter: [],
      specifiedStyles: {},
      tokens: [],
      viewport: s.screenshotViewport ?? { width: 0, height: 0 },
      capturedAt: s.screenshotCapturedAt ?? Date.now(),
      diffs: [],
    };
  }
  // element
  const { selection, styleEdits, bufferedElements, beforeImage, afterImage, tokens } = s;
  if (!selection) return null;
  const styleElements = mergeStyleElements(bufferedElements, {
    selection,
    styleEdits,
    before: beforeImage,
    after: afterImage,
  });
  return {
    ...common,
    captureMode: "element",
    selector: selection.selector,
    tagName: selection.tagName,
    classListBefore: selection.classList,
    classListAfter: styleEdits.classList,
    specifiedStyles: selection.specifiedStyles,
    tokens: tokens.map((tk) => ({ name: tk.name, value: tk.value })),
    viewport: selection.viewport,
    capturedAt: selection.capturedAt,
    diffs: buildStyleDiff(selection, styleEdits),
    styleElements,
  };
}

// buildCaptureFiles 입력 중 userAttachments를 제외한 부분(logs.html은 userAttachments와 무관) —
// 제출 첨부와 동일한 logs.html을 보장하는 단일 출처. IssueCreateModal은 여기에 userAttachments만 더한다.
export function buildEditorLogsCaptureInput(ctx: MarkdownContext): BuildCaptureFilesInput {
  const s = useEditorStore.getState();
  const sectionConfig = useSettingsUiStore.getState().issueSections;
  const {
    captureMode,
    draft,
    target,
    videoBlob,
    screenshotAnnotated,
    screenshotRaw,
    videoStartedAt,
    videoEndedAt,
    videoThumbnail,
    networkLog,
    networkLogAttach,
    consoleLog,
    consoleLogAttach,
    actionLog,
    actionLogAttach,
  } = s;
  const hasNet = networkLogAttach && !!networkLog && networkLog.captured > 0;
  const hasCon = consoleLogAttach && !!consoleLog && consoleLog.captured > 0;
  const hasAct = actionLogAttach && !!actionLog && actionLog.captured > 0;
  const isElement = captureMode === "element";
  const styleElements = ctx.styleElements ?? [];
  return {
    captureMode,
    videoBlob,
    screenshotImage: captureMode === "screenshot" ? (screenshotAnnotated ?? screenshotRaw) : null,
    beforeImages: isElement ? styleElements.map((e) => e.beforeImage ?? null) : undefined,
    afterImages: isElement ? styleElements.map((e) => e.afterImage ?? null) : undefined,
    networkLog: hasNet ? networkLog : null,
    consoleLog: hasCon ? consoleLog : null,
    actionLog: hasAct ? actionLog : null,
    videoStartedAt: videoStartedAt ?? undefined,
    videoEndedAt: videoEndedAt ?? undefined,
    videoThumbnail,
    pageUrl: target?.url ?? "",
    issueTitle: draft?.title?.trim() || undefined,
    report: draft
      ? {
          title: draft.title,
          sections: draft.sections,
          sectionConfig,
          envRows: deriveContextEnvRows(ctx),
          markdownContext: ctx,
        }
      : null,
  };
}

// 로그 섹션 다운로드 = 이슈 첨부 logs.html과 동일 빌드(영상/이미지 임베드 + report 포함).
// 첨부할 로그가 없으면 false.
export async function downloadEditorLogsHtml(): Promise<boolean> {
  const ctx = buildEditorMarkdownContext();
  if (!ctx) return false;
  const files = await buildCaptureFiles(buildEditorLogsCaptureInput(ctx));
  const logs = files.logs[0];
  if (!logs) return false;
  // logs.dataUrl은 data:text/html;base64,... — blob으로 풀어 다운로드(blob URL이라 download 이벤트 안정).
  triggerDownload(dataUrlToBlob(logs.dataUrl), logs.filename);
  return true;
}
