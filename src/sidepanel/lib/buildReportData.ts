import { t, withLocale } from "@/i18n";
import { sectionLabelKey, type IssueSection } from "@/store/settings-ui-store";
import type { LogViewerReport, LogViewerReportSection } from "@/types/log-viewer";
import { buildIssueHtml, buildIssueMarkdown, type MarkdownContext } from "./buildIssueMarkdown";
import { filterEnvironmentRows } from "./environmentRows";
import { formatTimestamp } from "./formatTimestamp";
import { resolveSectionImages } from "./resolveInlineImages";

// MarkdownContext의 환경 필드를 buildIssueMarkdown의 env 섹션과 동일 규칙으로 평탄화.
// Report 탭 표시 env == copy(markdown) env를 보장한다.
export function deriveContextEnvRows(
  ctx: MarkdownContext,
): { label: string; value: string }[] {
  // 동기 함수라 전체를 감싼다 — formatTimestamp가 dateBcp47()를 타므로 Captured 값도 본문 언어를 따라간다.
  return withLocale(ctx.bodyLocale, () => deriveContextEnvRowsInner(ctx));
}

function deriveContextEnvRowsInner(
  ctx: MarkdownContext,
): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  if (ctx.os) rows.push({ label: "OS", value: ctx.os });
  if (ctx.browser) rows.push({ label: "Browser", value: ctx.browser });
  rows.push({ label: "Page", value: ctx.url });
  if (ctx.selector) {
    rows.push({ label: "DOM", value: ctx.selector });
  }
  // 비-element 폴백으로 viewport {0,0}·capturedAt 0이 들어올 수 있다 — Preview와 동일하게 가드해 0×0·1970 표시를 막는다.
  if (ctx.viewport && ctx.viewport.width > 0 && ctx.viewport.height > 0) {
    rows.push({ label: "Viewport", value: `${ctx.viewport.width}×${ctx.viewport.height}` });
  }
  if (ctx.capturedAt) {
    rows.push({ label: "Captured", value: formatTimestamp(ctx.capturedAt) });
  }
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
  // logs.html Report 탭은 텍스트 섹션만 렌더한다 — media 엔트리는 본문 슬롯이라 제외.
  // 좁히기를 타입 가드로 두면 이 필터가 사라질 때 renderAs 대입이 컴파일 에러로 잡힌다.
  const enabled = input.sectionConfig.filter(
    (s): s is IssueSection & { renderAs: "paragraph" | "orderedList" } =>
      s.enabled && s.renderAs !== "meta",
  );
  // inline 이미지를 dataURL로 resolve한 섹션 맵 — 표시(sections)와 copy 양쪽에 공용으로 쓴다.
  // 호출처가 넘긴 markdownContext.sections는 플랫폼 제출과 공유돼 raw(inline: 마커) 상태이므로,
  // copy는 여기서 resolve한 섹션으로 빌드해야 클립보드에 깨진 마커가 안 남는다(PreviewPanel copy와 동일).
  const resolvedSections = await resolveSectionImages(input.sections, input.sectionConfig);

  // await 이후는 단절 없는 동기 tail이라 여기만 감싼다 — async 함수 전체는 감쌀 수 없다.
  // 여기서 박제한 문자열이 제출 본문과 일치해야 logs.html Report 탭이 같은 리포트가 된다.
  return withLocale(input.markdownContext.bodyLocale, () => {
    const sections: LogViewerReportSection[] = enabled.map((s) => ({
      id: s.id,
      label: s.labelOverride?.trim() || t(sectionLabelKey(s.id)),
      renderAs: s.renderAs,
      value: resolvedSections[s.id] ?? "",
    }));

    const copyCtx = { ...input.markdownContext, sections: resolvedSections };

    return {
      title: input.title,
      // 이슈 본문(buildIssueMarkdown)과 같은 키로 박제 — 제출물과 logs.html 리포트 탭 제목 일치.
      envTitle: t("md.section.env"),
      env: input.envRows,
      sections,
      copy: {
        markdown: buildIssueMarkdown(copyCtx),
        html: buildIssueHtml(copyCtx),
      },
    };
  });
}
