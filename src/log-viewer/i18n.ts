export type TranslationFn = (
  key: string,
  params?: Record<string, string | number>,
) => string;

export const koDict: Record<string, string> = {
  "networkLog.search": "URL 검색…",
  "networkLog.filter.all": "전체",
  "networkLog.filter.json": "JSON",
  "networkLog.filter.js": "JS",
  "networkLog.filter.css": "CSS",
  "networkLog.filter.img": "Img",
  "networkLog.filter.font": "Font",
  "networkLog.filter.doc": "Doc",
  "networkLog.filter.other": "기타",
  "networkLog.dialog.selectRequest": "요청을 선택하세요",
  "networkLog.detail.general": "일반",
  "networkLog.detail.url": "URL",
  "networkLog.detail.method": "Method",
  "networkLog.detail.status": "Status",
  "networkLog.detail.time": "Time",
  "networkLog.detail.contentType": "Content-Type",
  "networkLog.detail.requestHeaders": "요청 헤더",
  "networkLog.detail.responseHeaders": "응답 헤더",
  "networkLog.detail.copyCurl": "cURL 복사",
  "networkLog.detail.noBody": "본문 없음",
  "networkLog.tab.headers": "헤더",
  "networkLog.tab.request": "요청 본문",
  "networkLog.tab.response": "응답 본문",
  "networkLog.display.binary": "바이너리 응답 ({type} · {size}) · 본문 미저장",
  "networkLog.display.stream": "스트리밍 응답 ({type}) · 본문 캡처 안 됨",
  "networkLog.display.bodyTruncated": "본문 잘림 ({size} · 한도 {limit})",
  "networkLog.display.bodyOmitted": "본문 생략 (메모리 한도)",
  "networkLog.display.pending": "응답 대기 중",
  "networkLog.counter.captured": "{n}건 캡처",

  "consoleLog.search": "메시지 검색…",
  "consoleLog.detail.stackTrace": "스택 트레이스",
  "consoleLog.filter.all": "전체",
  "consoleLog.filter.error": "Error",
  "consoleLog.filter.warn": "Warn",
  "consoleLog.filter.info": "Info",
  "consoleLog.filter.debug": "Debug",
  "consoleLog.filter.log": "Log",

  "actionLog.search": "액션 검색…",
  "actionLog.filter.all": "전체",
  "actionLog.filter.click": "클릭",
  "actionLog.filter.navigation": "이동",
  "actionLog.filter.input": "입력",
  "actionLog.empty": "캡처된 액션이 없습니다",
  "actionLog.verb.click": "{target} 클릭",
  "actionLog.verb.input": "{field}에 {value} 입력",
  "actionLog.verb.navigate": "{target}(으)로 이동",
  "actionLog.role.button": "버튼",
  "actionLog.role.link": "링크",
  "actionLog.role.checkbox": "체크박스",
  "actionLog.role.radio": "라디오 버튼",
  "actionLog.role.tab": "탭",
  "actionLog.role.menuitem": "메뉴 항목",
  "actionLog.role.textbox": "입력란",

  "debug.network.empty": "네트워크 요청이 없습니다",
  "debug.console.empty": "콘솔 로그가 없습니다",

  "logViewer.footer.issueLink": "이슈 바로가기",

  "json.showAll": "전체 보기",
  "json.moreItems": "… {n}개 더",
};

export const enDict: Record<string, string> = {
  "networkLog.search": "Search URL…",
  "networkLog.filter.all": "All",
  "networkLog.filter.json": "JSON",
  "networkLog.filter.js": "JS",
  "networkLog.filter.css": "CSS",
  "networkLog.filter.img": "Img",
  "networkLog.filter.font": "Font",
  "networkLog.filter.doc": "Doc",
  "networkLog.filter.other": "Other",
  "networkLog.dialog.selectRequest": "Select a request",
  "networkLog.detail.general": "General",
  "networkLog.detail.url": "URL",
  "networkLog.detail.method": "Method",
  "networkLog.detail.status": "Status",
  "networkLog.detail.time": "Time",
  "networkLog.detail.contentType": "Content-Type",
  "networkLog.detail.requestHeaders": "Request Headers",
  "networkLog.detail.responseHeaders": "Response Headers",
  "networkLog.detail.copyCurl": "Copy as cURL",
  "networkLog.detail.noBody": "No body",
  "networkLog.tab.headers": "Headers",
  "networkLog.tab.request": "Request",
  "networkLog.tab.response": "Response",
  "networkLog.display.binary": "Binary response ({type} · {size}) · Body not saved",
  "networkLog.display.stream": "Streaming response ({type}) · Body not captured",
  "networkLog.display.bodyTruncated": "Body truncated ({size} · cap {limit})",
  "networkLog.display.bodyOmitted": "Body omitted (memory cap)",
  "networkLog.display.pending": "Waiting for response",
  "networkLog.counter.captured": "{n} captured",

  "consoleLog.search": "Search messages…",
  "consoleLog.detail.stackTrace": "Stack Trace",
  "consoleLog.filter.all": "All",
  "consoleLog.filter.error": "Error",
  "consoleLog.filter.warn": "Warn",
  "consoleLog.filter.info": "Info",
  "consoleLog.filter.debug": "Debug",
  "consoleLog.filter.log": "Log",

  "actionLog.search": "Search actions…",
  "actionLog.filter.all": "All",
  "actionLog.filter.click": "Click",
  "actionLog.filter.navigation": "Navigation",
  "actionLog.filter.input": "Input",
  "actionLog.empty": "No actions captured",
  "actionLog.verb.click": "Clicked {target}",
  "actionLog.verb.input": "Entered {value} in {field}",
  "actionLog.verb.navigate": "Navigated to {target}",
  "actionLog.role.button": "button",
  "actionLog.role.link": "link",
  "actionLog.role.checkbox": "checkbox",
  "actionLog.role.radio": "radio button",
  "actionLog.role.tab": "tab",
  "actionLog.role.menuitem": "menu item",
  "actionLog.role.textbox": "text field",

  "debug.network.empty": "No network requests",
  "debug.console.empty": "No console logs",

  "logViewer.footer.issueLink": "Go to Issue",

  "json.showAll": "show all",
  "json.moreItems": "… {n} more items",
};

const dict = navigator.language.startsWith("ko") ? koDict : enDict;

export function t(key: string, params?: Record<string, string | number>): string {
  let text = dict[key];
  if (!text) return key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

export function useT(): TranslationFn {
  return t;
}
