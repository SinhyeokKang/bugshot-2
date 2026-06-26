// 마크다운 본문의 로그 안내 줄에 박힌 평문 "logs.html"을 첨부 URL로 거는 후처리.
// Linear는 이슈 생성 후 logs.html을 업로드하므로 본문 빌드 시점엔 assetUrl을 몰라
// 평문으로 두고, 업로드가 끝나면 이 함수로 description을 패치한다(Jira의 injectLogsLink
// 마크다운 버전). 토큰이 없거나 url이 비면 본문을 그대로 둔다(graceful).
export const LOGS_FILENAME = "logs.html";

// 앞에 '[' (이미 링크 텍스트) 또는 '/' (URL 경로 일부)가 오면 건드리지 않고,
// 뒤에 ']' (이미 링크)가 오는 경우도 제외한다. 첫 평문 토큰만 치환.
const BARE_LOGS_RE = /(?<![[/])logs\.html(?!\])/;

export function injectLogsMarkdownLink(body: string, url: string): string {
  if (!url || !BARE_LOGS_RE.test(body)) return body;
  return body.replace(BARE_LOGS_RE, `[${LOGS_FILENAME}](${url})`);
}
