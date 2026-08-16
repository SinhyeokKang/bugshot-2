// 인라인 이미지 참조 마크다운의 단일 출처. 삭제 판정(blob-db의 GC)과 해석
// (sidepanel/lib/resolveInlineImages)이 반드시 같은 패턴을 써야 한다 — 삭제 쪽이 더 좁으면
// 해석되는 refId를 고아로 오판해 살아있는 이미지를 지운다. 캡처 그룹: 1=alt, 2=refId.
// 어느 한쪽 계층에 두면 다른 쪽이 그 모듈에 묶이므로(테스트 목킹 포함) 중립 위치에 둔다.
export const INLINE_REF_RE = /!\[([^\]]*)\]\(inline:([^)]+)\)/g;

// 위 파싱의 짝이 되는 생성기. alt 기본값이 빈 문자열이어야 현행 생성물(`![](inline:x)`)과 같다.
export function inlineRefUrl(refId: string): string {
  return `inline:${refId}`;
}

export function inlineRefMarkdown(refId: string, alt = ""): string {
  return `![${alt}](${inlineRefUrl(refId)})`;
}

// 업로드 파일명의 단일 출처. 생성 측(업로드 엔트리)과 조회 측(업로드 결과 맵)이 문자열을 따로
// 조립하면 갈리는 순간 이미지가 본문에서 무음으로 사라진다 — 양쪽이 이 함수를 부른다.
// ext 기본값은 캡처 기본 포맷이고, 원본 포맷을 보존하는 플랫폼만 넘긴다.
export function inlineUploadFilename(refId: string, ext = "webp"): string {
  return `${inlinePlaceholderId(refId)}.${ext}`;
}

// 확장자 없는 참조 id. 위 파일명과 접두사를 공유하므로 접두사 정의는 여기 한 곳뿐이다.
export function inlinePlaceholderId(refId: string): string {
  return `inline-${refId}`;
}
