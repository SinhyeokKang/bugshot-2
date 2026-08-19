// HTML 이스케이프 단일 출처. 사본이 셋으로 흩어졌던 이력이 있고 그중 하나가 `"`를
// 빠뜨려, 같은 문자열이 경로에 따라 다르게 이스케이프됐다(속성 문맥으로 흘러가면 곧 주입).
// `'`는 다루지 않는다 — 소비처에 단일인용 속성이 0건이고, 넓히면 클립보드 text/html·
// logs.html·Asana html_notes·라이브 프리뷰의 출력이 모든 아포스트로피에서 바뀐다.
// 이 근거는 **HTML 속성 축만** 센다. CSS 문맥(overlay swatch의 `style="background:…"`)은
// 인용 우주가 달라 애초에 이 함수가 막는 범위가 아니다 — `;`·`:`도 그대로 통과한다.
// 그 자리에 신뢰할 수 없는 값을 넣으려면 CSS 값 검증이 별도로 필요하다(현재 소비처는
// getComputedStyle 정규화 결과라 도달 불가).
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
