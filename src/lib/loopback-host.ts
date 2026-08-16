// 평문 http를 허용해도 되는 호스트인지 — 자격증명(GitLab PAT·LLM API 키)이 나가는 엔드포인트
// 주소 검증에서 쓴다. 트래픽이 기기 밖으로 나가지 않는 loopback만 예외로 인정한다.
//
// ssrf-guard와 반대 방향이다: 저쪽은 background가 페이지 제어 href를 fetch하기 전 loopback을
// **차단**하고, 여기는 사용자가 직접 입력한 로컬 엔드포인트(ollama `http://localhost:11434/v1`)를
// **허용**한다. 목적이 달라 판정을 공유하지 않는다.
// 테스트 전용 export — 프로덕션 소비처는 같은 파일의 isCredentialSafeUrl뿐이다.
export function isLoopbackHost(hostname: string): boolean {
  let host = hostname.toLowerCase();
  if (host.endsWith(".")) host = host.slice(0, -1); // FQDN 후행 점 (localhost.)
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "[::1]" || host === "::1") return true;
  // 127.0.0.0/8 전체 — 127.1 같은 축약 표기는 URL 파서가 127.0.0.1로 정규화해 넘겨준다.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

// 자격증명을 실어 보낼 엔드포인트로 이 URL을 허용할지. https이거나 loopback http만 통과.
export function isCredentialSafeUrl(url: URL): boolean {
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && isLoopbackHost(url.hostname);
}
