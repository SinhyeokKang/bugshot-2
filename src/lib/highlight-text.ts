export interface HighlightSegment {
  text: string;
  match: boolean;
}

// 대소문자 무시 문자열(비정규식) 매칭. 좌→우 비중첩으로 세그먼트를 쪼갠다.
// 빈 쿼리·무매칭이면 원문 단일 비매칭 세그먼트. 세그먼트를 이어붙이면 항상 원문.
export function splitHighlight(text: string, query: string): HighlightSegment[] {
  if (!query) return [{ text, match: false }];
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const qlen = lowerQuery.length;

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  let idx = lowerText.indexOf(lowerQuery, cursor);
  while (idx !== -1) {
    if (idx > cursor) segments.push({ text: text.slice(cursor, idx), match: false });
    segments.push({ text: text.slice(idx, idx + qlen), match: true });
    cursor = idx + qlen;
    idx = lowerText.indexOf(lowerQuery, cursor);
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments.length > 0 ? segments : [{ text, match: false }];
}
