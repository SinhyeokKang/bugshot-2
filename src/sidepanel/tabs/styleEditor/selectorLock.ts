// CSS 코드 뷰의 doc는 `selector {\n…\n}` 포맷이라 1행(선택자 줄)엔 가려진 `{`가 있다.
// 1행을 편집하면 그 `{`가 훼손돼 parseCssBlock이 fallback(inline)으로 떨어져 모델을 깨뜨린다.
// changeFilter가 [0, firstLineTo]를 protected range로 돌려주면 1행에 걸친 변경만 드롭되고
// 본문 변경은 통과한다 — 전체 select-all 삭제 시 선택자는 남고 선언만 비워져 "삭제=원복"이 유지된다.
export function selectorLineProtectedRange(
  firstLineTo: number,
): readonly number[] {
  return [0, firstLineTo];
}

// protected range는 "겹치는 변경 조각"을 통째로 드롭한다. uiw가 value prop 동기화에 쓰는
// 전체 doc 교체({from:0,to:len,insert})는 1행과 겹쳐 삽입분까지 날아가고 삭제만 남아 doc이
// 선택자 1행으로 붕괴한다(AI 스타일링·전체 리셋 직후 본문 전멸). 사용자 입력엔 userEvent가
// 실리고 프로그램적 dispatch엔 없으므로, 보호는 userEvent 있는 변경에만 건다.
export function selectorLineChangeFilter(opts: {
  hasUserEvent: boolean;
  firstLineTo: number;
}): true | readonly number[] {
  if (!opts.hasUserEvent) return true;
  return selectorLineProtectedRange(opts.firstLineTo);
}
