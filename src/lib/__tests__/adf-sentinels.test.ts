import { describe, expect, it } from "vitest";
import {
  IMAGE_PLACEHOLDER,
  INLINE_IMAGE_PREFIX,
  VIDEO_PLACEHOLDER,
  adfHasSentinel,
  inlineImagePlaceholder,
  parseInlinePlaceholder,
} from "../adf-sentinels";

describe("inlineImagePlaceholder / parseInlinePlaceholder", () => {
  it("placeholder 생성 → 파싱 라운드트립으로 refId가 복원된다", () => {
    const refId = "ab12cd34";
    const placeholder = inlineImagePlaceholder(refId);
    expect(placeholder.startsWith(INLINE_IMAGE_PREFIX)).toBe(true);
    expect(parseInlinePlaceholder(placeholder)).toBe(refId);
  });

  it("prefix가 다르면 null", () => {
    expect(parseInlinePlaceholder("__OTHER:abc__")).toBe(null);
    expect(parseInlinePlaceholder("plain text")).toBe(null);
  });

  it("suffix(__)가 없으면 null", () => {
    expect(parseInlinePlaceholder(`${INLINE_IMAGE_PREFIX}abc`)).toBe(null);
  });

  it("빈 refId도 라운드트립된다", () => {
    expect(parseInlinePlaceholder(inlineImagePlaceholder(""))).toBe("");
  });
});

// 2차 본문 갱신을 걸지 말지의 게이트. 업로드가 전부 실패하면 uploadMap이 비는데, 그때
// 갱신을 건너뛰면 생성 본문에 박힌 sentinel 리터럴이 이슈에 그대로 남는다.
// 판정 스코프는 치환 로직과 같은 **top-level content**여야 한다 — 더 깊이 보면 치환할 수
// 없는 자리를 찾아내 빈 PUT을 한 번 더 부른다.
describe("adfHasSentinel", () => {
  const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

  it("영상 placeholder 문단이 있으면 true", () => {
    expect(adfHasSentinel([para(VIDEO_PLACEHOLDER)])).toBe(true);
  });

  it("이미지 placeholder 문단이 있으면 true", () => {
    expect(adfHasSentinel([para(IMAGE_PLACEHOLDER)])).toBe(true);
  });

  it("인라인 이미지 placeholder 문단이 있으면 true", () => {
    expect(adfHasSentinel([para(inlineImagePlaceholder("ab12"))])).toBe(true);
  });

  it("sentinel이 없으면 false", () => {
    expect(adfHasSentinel([para("일반 본문"), { type: "rule" }])).toBe(false);
  });

  it("빈 본문은 false", () => {
    expect(adfHasSentinel([])).toBe(false);
  });

  it("sentinel 문자열이 다른 텍스트에 섞여 있으면 false — 치환도 정확 일치로만 한다", () => {
    expect(adfHasSentinel([para(`앞 ${VIDEO_PLACEHOLDER} 뒤`)])).toBe(false);
  });

  it("paragraph가 아닌 노드의 텍스트는 보지 않는다", () => {
    expect(
      adfHasSentinel([{ type: "heading", content: [{ type: "text", text: IMAGE_PLACEHOLDER }] }]),
    ).toBe(false);
  });

  it("content가 없는 문단에서 죽지 않는다", () => {
    expect(adfHasSentinel([{ type: "paragraph" }, para(INLINE_IMAGE_PREFIX)])).toBe(false);
  });
});
