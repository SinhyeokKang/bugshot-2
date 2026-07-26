// HTML 이스케이프 단일 출처. 세 벌로 흩어져 있었고 그중 Asana용 한 벌만 `"`를 빠뜨려,
// 같은 문자열이 경로에 따라 다르게 이스케이프됐다(속성 문맥으로 흘러가면 곧 주입).
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
