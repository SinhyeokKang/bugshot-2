// CSS 코드 뷰의 doc는 `selector {\n…\n}` 포맷이라 1행(선택자 줄)엔 가려진 `{`가 있다.
// 1행을 편집하면 그 `{`가 훼손돼 parseCssBlock이 fallback(inline)으로 떨어져 모델을 깨뜨린다.
// changeFilter가 [0, firstLineTo]를 protected range로 돌려주면 1행에 걸친 변경만 드롭되고
// 본문 변경은 통과한다 — 전체 select-all 삭제 시 선택자는 남고 선언만 비워져 "삭제=원복"이 유지된다.
export function selectorLineProtectedRange(
  firstLineTo: number,
): readonly number[] {
  return [0, firstLineTo];
}
