import MarkdownIt from "markdown-it";
import type { Options } from "markdown-it";

// 네 소비처(ADF·Notion blocks·Asana HTML·프리뷰)가 같은 옵션 3종 + strikethrough 활성화를
// 복제하고 있었다. 인스턴스는 공유하지 않는다 — 한 파일의 md.use()가 나머지 셋에 샌다.
export function createMarkdownIt(options: Options = {}): MarkdownIt {
  // html:false를 **뒤에** 둔다 — 렌더 결과가 dangerouslySetInnerHTML로 직행하므로
  // 호출부가 raw HTML 게이트를 덮을 수 있으면 안 된다(4벌 시절엔 덮을 자리가 없었다).
  const md = MarkdownIt({ ...options, html: false, breaks: true, linkify: true });
  md.enable("strikethrough");
  return md;
}
