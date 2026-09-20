import { t, withLocale } from "@/i18n";
import { buildMarkdownIssueBody } from "./buildMarkdownIssueBody";
import type { MarkdownContext } from "./buildIssueMarkdown";
import { placeholderSectionImages } from "./resolveInlineImages";

// json 템플릿 모드 전용 본문. 이 경로는 미디어를 아예 싣지 않아 인라인 이미지의 호스팅
// URL을 만들 수 없다 — 내부 마커(inline:<refId>)를 그대로 내보내면 수신 서버가 못 푸는
// 문자열이 본문에 남으므로, 복사 경로와 같은 관용구로 흔적을 남기고 지운다(무음 유실 금지).
// 다른 플랫폼과 달리 빌더가 하나 더 있는 건 그 대체 문구가 **본문에 실려 나가서**다 —
// 화면 언어가 아니라 본문 언어를 따라야 하고, 그러려면 래핑 안에서 t()를 불러야 한다.
export function buildWebhookJsonBody(ctx: MarkdownContext, cc?: string[]): string {
  return withLocale(ctx.bodyLocale, () => {
    const sections = placeholderSectionImages(
      ctx.sections,
      ctx.sectionConfig,
      t("webhook.attachmentNotInline"),
    );
    return buildMarkdownIssueBody({ ctx: { ...ctx, sections }, cc }, { platform: "webhook" }).body;
  });
}
