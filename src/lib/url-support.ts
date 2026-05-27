const SUPPORTED_SCHEMES = new Set(["http:", "https:", "file:"]);

// Chrome이 content script 주입을 차단하는 호스트/경로.
// 스킴은 http(s)지만 chrome.scripting.executeScript 호출 시
// "The extensions gallery cannot be scripted." 등의 에러가 발생.
// 그 외 chrome://, chrome-extension://, devtools://, view-source: 등은
// SUPPORTED_SCHEMES에서 이미 걸러진다.
const BLOCKED_HOSTS = new Set<string>([
  "chromewebstore.google.com",
]);

function isBlockedPath(hostname: string, pathname: string): boolean {
  // 신 도메인은 호스트 통째로 차단됨
  if (BLOCKED_HOSTS.has(hostname)) return true;
  // 구 도메인은 /webstore 트리만 차단됨 (/webstoreAdmin 같은 가상 경로는 매칭 안 함)
  if (
    hostname === "chrome.google.com" &&
    (pathname === "/webstore" || pathname.startsWith("/webstore/"))
  ) {
    return true;
  }
  return false;
}

export function isSupportedUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (!SUPPORTED_SCHEMES.has(u.protocol)) return false;
    if (isBlockedPath(u.hostname, u.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

export type TabSupport = "supported" | "permission-expired" | "unsupported";

// tab.url이 비어 있으면 activeTab grant가 만료돼 URL을 못 읽는 상태다 (미지원 페이지와 구분 불가).
// 이때 content script가 보고한 실제 location.href로 판정한다: 지원 페이지면 권한만 풀린
// permission-expired, 그 외(응답 없음·미지원 스킴)는 unsupported.
export function classifyTabSupport(input: {
  url: string | undefined;
  contentUrl: string | undefined;
}): TabSupport {
  if (input.url) return isSupportedUrl(input.url) ? "supported" : "unsupported";
  if (input.contentUrl && isSupportedUrl(input.contentUrl)) {
    return "permission-expired";
  }
  return "unsupported";
}
