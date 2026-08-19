import MarkdownIt from "markdown-it";
import type { Options } from "markdown-it";

// 네 소비처(ADF·Notion blocks·Asana HTML·프리뷰)가 같은 옵션 3종 + strikethrough 활성화를
// 복제하고 있었다. 인스턴스는 공유하지 않는다 — 한 파일의 md.use()가 나머지 셋에 샌다.
export function createMarkdownIt(options: Options = {}): MarkdownIt {
  const md = MarkdownIt({ html: false, breaks: true, linkify: true, ...options });
  md.enable("strikethrough");
  return md;
}
