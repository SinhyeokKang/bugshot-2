// 스프린트 유효 판정의 단일 출처. 지금 런타임 소비처는 사이드패널의 sticky 검증 하나뿐이고
// (background는 서버 `state=active,future` 파라미터로 거른다) leaf 모듈로 둔 건 순전히 번들
// 때문이다 — jira-api.ts를 사이드패널로 끌어오면 OAuth·설정 저장소까지 그래프에 딸려온다
// (buildIssueAdf ↔ adf-logs-link와 같은 형태).
//
// 유효 상태를 화이트리스트로 통과시킨다. 닫힌 상태를 열거해 거르면 다음에 추가되는 상태
// 문자열이 유효로 새고, 그때 증상은 "이미 끝난 스프린트로 제출됨"이다.
export function isActiveSprint(state: string): boolean {
  return state === "active" || state === "future";
}
