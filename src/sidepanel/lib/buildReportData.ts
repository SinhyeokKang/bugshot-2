import { t } from "@/i18n";
import { sectionLabelKey, type IssueSection } from "@/store/settings-ui-store";
import type { LogViewerReport, LogViewerReportSection } from "@/types/log-viewer";
import { buildIssueHtml, buildIssueMarkdown, type MarkdownContext } from "./buildIssueMarkdown";
import { filterEnvironmentRows } from "./environmentRows";
import { formatTimestamp } from "./formatTimestamp";
import { resolveInlineImages } from "./resolveInlineImages";

// MarkdownContext의 환경 필드를 buildIssueMarkdown의 env 섹션과 동일 규칙으로 평탄화.
// Report 탭 표시 env == copy(markdown) env를 보장한다.
export function deriveContextEnvRows(
  ctx: MarkdownContext,
): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  if (ctx.os) rows.push({ label: "OS", value: ctx.os });
  if (ctx.browser) rows.push({ label: "Browser", value: ctx.browser });
  rows.push({ label: "Page", value: ctx.url });
  if (
    ctx.captureMode !== "screenshot" &&
    ctx.captureMode !== "video" &&
    ctx.captureMode !== "freeform" &&
    ctx.selector
  ) {
    rows.push({ label: "DOM", value: ctx.selector });
  }
  if (ctx.viewport) {
    rows.push({ label: "Viewport", value: `${ctx.viewport.width}×${ctx.viewport.height}` });
  }
  rows.push({ label: "Captured", value: formatTimestamp(ctx.capturedAt) });
  rows.push(...filterEnvironmentRows(ctx.environment));
  return rows;
}

export interface BuildReportDataInput {
  title: string;
  sections: Record<string, string>;
  sectionConfig: IssueSection[];
  envRows: { label: string; value: string }[];
  markdownContext: MarkdownContext;
}

export async function buildReportData(
  input: BuildReportDataInput,
): Promise<LogViewerReport> {
  const enabled = input.sectionConfig.filter((s) => s.enabled);
  // inline 이미지를 dataURL로 resolve한 섹션 맵 — 표시(sections)와 copy 양쪽에 공용으로 쓴다.
  // 호출처가 넘긴 markdownContext.sections는 플랫폼 제출과 공유돼 raw(inline: 마커) 상태이므로,
  // copy는 여기서 resolve한 섹션으로 빌드해야 클립보드에 깨진 마커가 안 남는다(PreviewPanel copy와 동일).
  // resolve는 paragraph 섹션만 — orderedList엔 inline 입력 경로가 없다.
  const resolvedSections: Record<string, string> = { ...input.sections };
  await Promise.all(
    enabled
      .filter((s) => s.renderAs === "paragraph")
      .map(async (s) => {
        const raw = resolvedSections[s.id] ?? "";
        if (!raw.includes("inline:")) return;
        resolvedSections[s.id] = (await resolveInlineImages(raw)).resolved;
      }),
  );

  const sections: LogViewerReportSection[] = enabled.map((s) => ({
    id: s.id,
    label: s.labelOverride?.trim() || t(sectionLabelKey(s.id)),
    renderAs: s.renderAs,
    value: resolvedSections[s.id] ?? "",
  }));

  const copyCtx = { ...input.markdownContext, sections: resolvedSections };

  return {
    title: input.title,
    env: input.envRows,
    sections,
    copy: {
      markdown: buildIssueMarkdown(copyCtx),
      html: buildIssueHtml(copyCtx),
    },
  };
}
