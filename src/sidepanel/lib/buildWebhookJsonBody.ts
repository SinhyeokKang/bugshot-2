import { t, withLocale } from "@/i18n";
import { buildMarkdownIssueBody } from "./buildMarkdownIssueBody";
import type { MarkdownContext } from "./buildIssueMarkdown";
import { placeholderSectionImages } from "./resolveInlineImages";

// json 템플릿 모드 전용 본문. 이 경로는 미디어를 아예 싣지 않아 인라인 이미지의 호스팅
// URL을 만들 수 없다 — 내부 마커(inline:<refId>)를 그대로 내보내면 수신 서버가 못 푸는
// 문자열이 본문에 남으므로, 복사 경로와 같은 관용구로 흔적을 남기고 지운다(무음 유실 금지).
// 다른 플랫폼과 달리 빌더가 하나 더 있는 건 그 대체 문구가 **본문에 실려 나가서**다 —
// 화면 언어가 아니라 본문 언어를 따라야 하고, 그러려면 래핑 안에서 t()를 불러야 한다.
// sections도 함께 돌려준다 — 템플릿이 {{sections.<id>}}로 같은 값을 직접 참조할 수 있어,
// body만 정리하면 그쪽 경로로 내부 마커가 그대로 새어 나간다.
// 그 맵도 body와 같은 sectionConfig를 따라야 한다 — 안 그러면 사용자가 끈 섹션이
// {{sections.<id>}}로 직행하고, 그 섹션은 치환도 안 돼 내부 마커까지 실려 나간다.
export function buildWebhookJsonBody(
  ctx: MarkdownContext,
): { body: string; sections: Record<string, string> } {
  return withLocale(ctx.bodyLocale, () => {
    // ctx.sections는 draft에서 무필터로 온다(buildEditorCapture) — config에 없는 잔재도
    // 사용자가 의도한 전송 대상이 아니므로 config를 화이트리스트로 쓴다.
    const enabled = new Set<string>(ctx.sectionConfig.filter((s) => s.enabled).map((s) => s.id));
    const sections = Object.fromEntries(
      Object.entries(
        placeholderSectionImages(ctx.sections, ctx.sectionConfig, t("webhook.attachmentNotInline")),
      ).filter(([id]) => enabled.has(id)),
    );
    // 이 경로는 바디 하나만 POST한다 — logs.html도 안 간다. 로그 요약의 첨부 리드를 끄지 않으면
    // 수신처(Slack·Discord)에 없는 파일을 가리키는 문장이 그대로 실린다.
    const { body } = buildMarkdownIssueBody(
      { ctx: { ...ctx, sections, logsNotAttached: true } },
      { platform: "webhook" },
    );
    return { body, sections };
  });
}
